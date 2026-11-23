'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Columns3,
  ExternalLink,
  Layers,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import type { PipelineRunState, StepStatus, SyncedStepRecord } from '@/lib/types';

interface AgentSyncBayProps {
  runState: PipelineRunState;
  autoSync: boolean;
  onToggleAutoSync: () => void;
  onSelectStep: (stepId: string) => void;
}

function StatusLabel({ status }: { status: StepStatus }) {
  if (status === 'verified') {
    return (
      <span className="inline-flex items-center gap-1 text-[#34d399]">
        <CheckCircle2 className="w-3 h-3 shrink-0" aria-hidden="true" />
        <span>Verified</span>
      </span>
    );
  }
  if (status === 'retrying') {
    return (
      <span className="inline-flex items-center gap-1 text-[#fbbf24]">
        <RefreshCw className="w-3 h-3 animate-spin shrink-0" aria-hidden="true" />
        <span>Retrying</span>
      </span>
    );
  }
  if (status === 'running') {
    return (
      <span className="inline-flex items-center gap-1 text-[#93c5fd]">
        <RefreshCw className="w-3 h-3 animate-spin shrink-0" aria-hidden="true" />
        <span>Active</span>
      </span>
    );
  }
  if (status === 'bottleneck') {
    return (
      <span className="inline-flex items-center gap-1 text-[#fca5a5]">
        <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
        <span>Bottleneck</span>
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-1 text-[#fca5a5]">
        <XCircle className="w-3 h-3 shrink-0" aria-hidden="true" />
        <span>Stopped</span>
      </span>
    );
  }
  return <span className="text-[#646e7e]">Pending</span>;
}

function Agent1Card({ step, runStatus }: { step: SyncedStepRecord; runStatus: PipelineRunState['status'] }) {
  const data = step.agent1;
  return (
    <div className="matte-inset rounded-xl p-4 flex flex-col gap-3 min-w-0 h-full overflow-y-auto">
      <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-[#1f242e]">
        <div>
          <h3 className="font-display text-sm font-semibold text-[#eef1f6]">
            Agent 1 · Solver
          </h3>
          <p className="text-[11px] text-[#9aa3b2]">
            Internet Search → Grounded Reasoning
          </p>
        </div>
        {data && (
          <span className="font-mono-tabular text-[11px] text-[#9aa3b2] shrink-0">
            Attempt {data.attempt}/{step.maxAttempts}
          </span>
        )}
      </div>

      {!data ? (
        <div className="text-xs text-[#646e7e] py-6 text-center">
          {runStatus === 'error' || step.status === 'error'
            ? 'Execution stopped due to an upstream error.'
            : step.status === 'running' || step.status === 'retrying'
              ? 'Searching credible sources and synthesizing step...'
              : 'Awaiting step execution.'}
        </div>
      ) : (
        <div className="space-y-3 text-xs">
          <div className="text-[11px] font-mono-tabular text-[#646e7e] flex flex-wrap gap-x-2">
            <span>Model: {data.modelUsed}</span>
            <span aria-hidden="true">·</span>
            <span>Phase: {data.phase}</span>
          </div>

          <div className="space-y-1">
            <div className="text-[11px] font-medium text-[#9aa3b2]">
              Short Concrete Reasoning
            </div>
            <p className="text-[#e3e7ee] leading-relaxed bg-[#13171e] border border-[#222834] rounded-lg p-2.5">
              {data.reasoning}
            </p>
          </div>

          <div className="space-y-1">
            <div className="text-[11px] font-medium text-[#9aa3b2]">
              Step Output
            </div>
            <p className="text-[#cbd5e1] leading-relaxed whitespace-pre-wrap">
              {data.answer}
            </p>
          </div>

          {data.searchQueries.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] font-medium text-[#9aa3b2]">
                Search Queries Executed
              </div>
              <div className="font-mono-tabular text-[11px] text-[#9aa3b2] space-y-0.5">
                {data.searchQueries.map((q, i) => (
                  <div key={i} className="truncate">
                    {i + 1}. {q}
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.credibleSources.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] font-medium text-[#9aa3b2]">
                Credible Sources ({data.credibleSources.length})
              </div>
              <ul className="space-y-1">
                {data.credibleSources.slice(0, 5).map((src, idx) => (
                  <li key={idx} className="truncate">
                    <a
                      href={src.url.startsWith('http') ? src.url : undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[#93c5fd] hover:underline max-w-full"
                    >
                      <span className="truncate">{src.title}</span>
                      {src.url.startsWith('http') && (
                        <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                      )}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Agent2Card({ step, runStatus }: { step: SyncedStepRecord; runStatus: PipelineRunState['status'] }) {
  const data = step.agent2;
  return (
    <div className="matte-inset rounded-xl p-4 flex flex-col gap-3 min-w-0 h-full overflow-y-auto">
      <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-[#1f242e]">
        <div>
          <h3 className="font-display text-sm font-semibold text-[#eef1f6]">
            Agent 2 · Cross-Check
          </h3>
          <p className="text-[11px] text-[#9aa3b2]">
            Keyword Match → Hallucination Audit
          </p>
        </div>
        {data && (
          <span className="font-mono-tabular text-[11px] text-[#9aa3b2] shrink-0">
            Attempt {data.attempt}/{step.maxAttempts}
          </span>
        )}
      </div>

      {!data ? (
        <div className="text-xs text-[#646e7e] py-6 text-center">
          {runStatus === 'error' || step.status === 'error'
            ? 'Execution stopped due to an upstream error.'
            : step.status === 'running' || step.status === 'retrying'
              ? 'Cross-referencing claims and keywords against sources...'
              : 'Awaiting Agent 1 candidate.'}
        </div>
      ) : (
        <div className="space-y-3 text-xs">
          <div className="flex items-center justify-between gap-2 text-[11px] font-mono-tabular">
            <span className="text-[#646e7e] truncate">Model: {data.modelUsed}</span>
            <span
              className={`font-medium shrink-0 ${
                data.anomalyFlagged ? 'text-[#fca5a5]' : 'text-[#34d399]'
              }`}
            >
              {data.anomalyFlagged ? 'Anomaly Flagged' : 'Clean Grounding'}
            </span>
          </div>

          <div className="space-y-1">
            <div className="text-[11px] font-medium text-[#9aa3b2]">
              Short Concrete Reasoning
            </div>
            <p className="text-[#e3e7ee] leading-relaxed bg-[#13171e] border border-[#222834] rounded-lg p-2.5">
              {data.reasoning}
            </p>
          </div>

          {data.anomalyFlagged && data.anomalyDetail && (
            <div className="rounded-lg border border-[#ef4444]/40 bg-[#ef4444]/10 p-2.5 text-[#fca5a5] flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{data.anomalyDetail}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-[#9aa3b2]">
              <span className="font-medium">Keyword & Claim Sentence Match</span>
              <span className="font-mono-tabular">
                Lexical: {Math.round(data.lexicalMatchRatio * 100)}%
              </span>
            </div>
            {data.keywordChecks.length > 0 && (
              <div className="space-y-1">
                {data.keywordChecks.map((kw, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-[#13171e] border border-[#1f242e]"
                  >
                    <span className="truncate text-[#d6dce6]">{kw.phrase}</span>
                    <span
                      className={`font-mono-tabular text-[11px] shrink-0 ${
                        kw.foundInSource ? 'text-[#34d399]' : 'text-[#fbbf24]'
                      }`}
                    >
                      {kw.foundInSource ? 'Matched' : 'Unmatched'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {data.claimChecks.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-[#9aa3b2]">
                Claim Cross-Verification
              </div>
              <div className="space-y-1.5">
                {data.claimChecks.map((chk, i) => (
                  <div
                    key={i}
                    className="p-2 rounded bg-[#13171e] border border-[#1f242e] space-y-1"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[#e3e7ee]">{chk.claim}</span>
                      <span
                        className={`font-mono-tabular text-[11px] shrink-0 ${
                          chk.verdict === 'supported'
                            ? 'text-[#34d399]'
                            : chk.verdict === 'partial'
                              ? 'text-[#fbbf24]'
                              : 'text-[#fca5a5]'
                        }`}
                      >
                        {chk.verdict}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#9aa3b2]">{chk.evidence}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Agent3Card({ step, runStatus }: { step: SyncedStepRecord; runStatus: PipelineRunState['status'] }) {
  const data = step.agent3;
  return (
    <div className="matte-inset rounded-xl p-4 flex flex-col gap-3 min-w-0 h-full overflow-y-auto">
      <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-[#1f242e]">
        <div>
          <h3 className="font-display text-sm font-semibold text-[#eef1f6]">
            Agent 3 · Auditor
          </h3>
          <p className="text-[11px] text-[#9aa3b2]">
            A1 & A2 Reasoning Compatibility Match
          </p>
        </div>
        {data && (
          <span className="font-mono-tabular text-[11px] text-[#9aa3b2] shrink-0">
            Attempt {data.attempt}/{step.maxAttempts}
          </span>
        )}
      </div>

      {!data ? (
        <div className="text-xs text-[#646e7e] py-6 text-center">
          {runStatus === 'error' || step.status === 'error'
            ? 'Execution stopped due to an upstream error.'
            : step.status === 'running' || step.status === 'retrying'
              ? 'Auditing reasoning sentences and compatibility...'
              : 'Awaiting Agent 1 & Agent 2 reasoning.'}
        </div>
      ) : (
        <div className="space-y-3 text-xs">
          <div className="flex items-center justify-between gap-2 text-[11px] font-mono-tabular">
            <span className="text-[#646e7e] truncate">Model: {data.modelUsed}</span>
            <span
              className={`font-medium shrink-0 ${
                data.anomalyFlagged ? 'text-[#fca5a5]' : 'text-[#34d399]'
              }`}
            >
              {data.anomalyFlagged ? `Fault: ${data.faultOwner}` : 'Compatible'}
            </span>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between px-2.5 py-1.5 rounded bg-[#13171e] border border-[#1f242e]">
              <span className="text-[#9aa3b2]">Agent 1 Reasoning</span>
              <span
                className={`font-mono-tabular ${
                  data.agent1ReasoningValid ? 'text-[#34d399]' : 'text-[#fca5a5]'
                }`}
              >
                {data.agent1ReasoningValid ? 'Valid' : 'Invalid'}
              </span>
            </div>
            <div className="flex items-center justify-between px-2.5 py-1.5 rounded bg-[#13171e] border border-[#1f242e]">
              <span className="text-[#9aa3b2]">Agent 2 Reasoning</span>
              <span
                className={`font-mono-tabular ${
                  data.agent2ReasoningValid ? 'text-[#34d399]' : 'text-[#fca5a5]'
                }`}
              >
                {data.agent2ReasoningValid ? 'Valid' : 'Invalid'}
              </span>
            </div>
            <div className="flex items-center justify-between px-2.5 py-1.5 rounded bg-[#13171e] border border-[#1f242e]">
              <span className="text-[#9aa3b2]">A1 ↔ A2 Match</span>
              <span
                className={`font-mono-tabular ${
                  data.compatibilityValid ? 'text-[#34d399]' : 'text-[#fca5a5]'
                }`}
              >
                {data.compatibilityValid ? 'Aligned' : 'Conflict'}
              </span>
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-[11px] font-medium text-[#9aa3b2]">
              Matched Reasoning Summary
            </div>
            <p className="text-[#cbd5e1] leading-relaxed">
              {data.matchedReasoningSummary}
            </p>
          </div>

          <div className="space-y-1">
            <div className="text-[11px] font-medium text-[#9aa3b2]">
              Short Concrete Reasoning
            </div>
            <p className="text-[#e3e7ee] leading-relaxed bg-[#13171e] border border-[#222834] rounded-lg p-2.5">
              {data.reasoning}
            </p>
          </div>

          {data.anomalyFlagged && data.anomalyDetail && (
            <div className="rounded-lg border border-[#ef4444]/40 bg-[#ef4444]/10 p-2.5 text-[#fca5a5] flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{data.anomalyDetail}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AgentSyncBay({
  runState,
  autoSync,
  onToggleAutoSync,
  onSelectStep,
}: AgentSyncBayProps) {
  const [layoutMode, setLayoutMode] = useState<'split' | 'tabs'>('split');
  const [activeAgentTab, setActiveAgentTab] = useState<'agent1' | 'agent2' | 'agent3'>('agent1');

  const activeStep =
    runState.steps.find((s) => s.stepId === runState.activeStepId) ?? runState.steps[0];

  return (
    <section
      aria-label="Synchronized 3-Agent Transparency Bay"
      className="matte-panel rounded-2xl flex flex-col min-h-0 h-full overflow-hidden"
    >
      <div className="px-4 py-3 border-b border-[#232832] bg-[#0f1217] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <ShieldCheck className="w-4 h-4 text-[#10b981] shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="font-display text-sm font-semibold text-[#eef1f6] truncate">
              3-Agent Real-Time Sync
            </h2>
            <p className="text-[11px] text-[#9aa3b2] font-mono-tabular truncate">
              {runState.status === 'idle'
                ? 'Ready for query verification'
                : `${runState.activeModelTier} · ${runState.mistakes.length} mistake(s) logged`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onToggleAutoSync}
            aria-pressed={autoSync}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              autoSync
                ? 'bg-[#10b981]/15 text-[#34d399] border border-[#10b981]/35'
                : 'bg-[#181c23] text-[#9aa3b2] border border-[#282e39]'
            }`}
          >
            {autoSync ? 'Lockstep Sync On' : 'Manual Step'}
          </button>

          <div className="hidden xl:flex items-center bg-[#181c23] border border-[#282e39] rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setLayoutMode('split')}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium cursor-pointer whitespace-nowrap shrink-0 ${
                layoutMode === 'split'
                  ? 'bg-[#252b36] text-[#eef1f6]'
                  : 'text-[#9aa3b2] hover:text-[#eef1f6]'
              }`}
            >
              <Columns3 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>3-Up</span>
            </button>
            <button
              type="button"
              onClick={() => setLayoutMode('tabs')}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium cursor-pointer whitespace-nowrap shrink-0 ${
                layoutMode === 'tabs'
                  ? 'bg-[#252b36] text-[#eef1f6]'
                  : 'text-[#9aa3b2] hover:text-[#eef1f6]'
              }`}
            >
              <Layers className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Tabs</span>
            </button>
          </div>
        </div>
      </div>

      {runState.steps.length > 0 ? (
        <>
          <div
            role="tablist"
            aria-label="Synchronized verification steps"
            className="px-4 py-2.5 border-b border-[#232832] flex items-center gap-2 overflow-x-auto bg-[#0c0f13]"
          >
            {runState.steps.map((step) => {
              const selected = activeStep?.stepId === step.stepId;
              return (
                <button
                  key={step.stepId}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => onSelectStep(step.stepId)}
                  className={`flex flex-col items-start px-3 py-1.5 rounded-lg border text-left transition-colors cursor-pointer shrink-0 min-w-[130px] ${
                    selected
                      ? 'bg-[#1a1f28] border-[#434d60] text-[#eef1f6]'
                      : 'bg-[#12151a] border-[#232832] text-[#9aa3b2] hover:border-[#343b49]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 w-full text-[11px] font-mono-tabular">
                    <span>Step {step.stepIndex}</span>
                    <StatusLabel status={step.status} />
                  </div>
                  <span className="text-xs font-medium truncate max-w-[170px] mt-0.5">
                    {step.stepLabel}
                  </span>
                </button>
              );
            })}
          </div>

          {activeStep && (
            <div className="px-4 py-2 border-b border-[#1f242e] bg-[#101318] flex items-center justify-between gap-3 text-xs">
              <div className="truncate text-[#9aa3b2]">
                <span className="font-medium text-[#eef1f6]">Synced Objective:</span>{' '}
                {activeStep.objective}
              </div>
              <span className="font-mono-tabular text-[11px] text-[#646e7e] shrink-0">
                Synced Step {activeStep.stepIndex}
              </span>
            </div>
          )}

          {/* Synced Tabs bar (visible in Tabs mode on xl, or always on < xl) */}
          <div className={`${layoutMode === 'split' ? 'xl:hidden' : ''} px-4 pt-3 flex items-center gap-1.5`}>
            {(
              [
                { id: 'agent1', label: 'Agent 1 · Solver' },
                { id: 'agent2', label: 'Agent 2 · Cross-Check' },
                { id: 'agent3', label: 'Agent 3 · Auditor' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveAgentTab(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                  activeAgentTab === tab.id
                    ? 'bg-[#eef1f6] text-[#0b0d10]'
                    : 'bg-[#181c23] text-[#9aa3b2] border border-[#282e39] hover:text-[#eef1f6]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {runState.status === 'error' && runState.errorMessage && (
            <div
              role="alert"
              className="mx-4 mt-3 px-3.5 py-2.5 rounded-xl border border-[#ef4444]/40 bg-[#ef4444]/10 text-xs text-[#fca5a5] flex items-start gap-2"
            >
              <XCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="space-y-0.5">
                <div className="font-medium">Pipeline Stopped</div>
                <p className="text-[#fca5a5]/90">{runState.errorMessage}</p>
              </div>
            </div>
          )}

          {activeStep && (
            <div className="flex-1 min-h-0 p-4 overflow-hidden">
              {layoutMode === 'split' ? (
                <>
                  {/* Desktop 3-column simultaneous lockstep view */}
                  <div className="hidden xl:grid xl:grid-cols-3 gap-3 h-full min-h-0">
                    <Agent1Card step={activeStep} runStatus={runState.status} />
                    <Agent2Card step={activeStep} runStatus={runState.status} />
                    <Agent3Card step={activeStep} runStatus={runState.status} />
                  </div>
                  {/* Narrower viewports synced tab view */}
                  <div className="xl:hidden h-full min-h-0">
                    {activeAgentTab === 'agent1' && <Agent1Card step={activeStep} runStatus={runState.status} />}
                    {activeAgentTab === 'agent2' && <Agent2Card step={activeStep} runStatus={runState.status} />}
                    {activeAgentTab === 'agent3' && <Agent3Card step={activeStep} runStatus={runState.status} />}
                  </div>
                </>
              ) : (
                <div className="h-full min-h-0">
                  {activeAgentTab === 'agent1' && <Agent1Card step={activeStep} runStatus={runState.status} />}
                  {activeAgentTab === 'agent2' && <Agent2Card step={activeStep} runStatus={runState.status} />}
                  {activeAgentTab === 'agent3' && <Agent3Card step={activeStep} runStatus={runState.status} />}
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 w-full max-w-2xl text-left">
            <div className="matte-inset rounded-xl p-4 space-y-1.5">
              <div className="font-display text-xs font-semibold text-[#eef1f6]">
                1. Agent 1 · Solver
              </div>
              <p className="text-xs text-[#9aa3b2] leading-relaxed">
                Decomposes query, searches credible internet sources + grounding files first, then reasons over evidence.
              </p>
            </div>
            <div className="matte-inset rounded-xl p-4 space-y-1.5">
              <div className="font-display text-xs font-semibold text-[#eef1f6]">
                2. Agent 2 · Cross-Check
              </div>
              <p className="text-xs text-[#9aa3b2] leading-relaxed">
                Matches claiming sentences and keywords against sources first, then cross-verifies via reasoning.
              </p>
            </div>
            <div className="matte-inset rounded-xl p-4 space-y-1.5">
              <div className="font-display text-xs font-semibold text-[#eef1f6]">
                3. Agent 3 · Auditor
              </div>
              <p className="text-xs text-[#9aa3b2] leading-relaxed">
                Verifies every reasoning step of Agent 1 and Agent 2, matches compatibility, and triggers selective retries.
              </p>
            </div>
          </div>
          <p className="text-xs text-[#646e7e]">
            Submit a text query or activate Voice Talk to observe all three agents execute in lockstep.
          </p>
        </div>
      )}
    </section>
  );
}
