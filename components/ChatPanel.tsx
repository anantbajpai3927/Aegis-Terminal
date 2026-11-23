'use client';

import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import {
  AlertTriangle,
  ArrowUp,
  ExternalLink,
  Eye,
  Mic,
  MicOff,
  Radio,
  ShieldCheck,
} from 'lucide-react';
import type { ChatMessage, GroundingResource } from '@/lib/types';
import GroundingBar from './GroundingBar';

interface ChatPanelProps {
  messages: ChatMessage[];
  isRunning: boolean;
  voiceActive: boolean;
  voiceConnecting: boolean;
  voiceStatusText: string;
  liveUserTranscript: string;
  liveAssistantTranscript: string;
  resources: GroundingResource[];
  onAddResource: (res: GroundingResource) => void;
  onToggleResource: (id: string) => void;
  onRemoveResource: (id: string) => void;
  onSubmitQuery: (query: string) => void;
  onToggleVoice: () => void;
  onInspectRun: (msg: ChatMessage) => void;
  activeInspectedRunId: string | null;
}

const STARTER_PROMPTS = [
  'Compare current global fusion net energy milestones and list verified primary sources.',
  'Explain the structural trade-offs between LFP and NMC battery chemistries with cited figures.',
  'Audit my attached grounding documents and summarize key verifiable obligations.',
];

export default function ChatPanel({
  messages,
  isRunning,
  voiceActive,
  voiceConnecting,
  voiceStatusText,
  liveUserTranscript,
  liveAssistantTranscript,
  resources,
  onAddResource,
  onToggleResource,
  onRemoveResource,
  onSubmitQuery,
  onToggleVoice,
  onInspectRun,
  activeInspectedRunId,
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, liveUserTranscript, liveAssistantTranscript, isRunning]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isRunning) return;
    setInput('');
    onSubmitQuery(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <section
      aria-label="Conversation and grounding console"
      className="matte-panel rounded-2xl flex flex-col min-h-0 h-full overflow-hidden"
    >
      <GroundingBar
        resources={resources}
        onAddResource={onAddResource}
        onToggleResource={onToggleResource}
        onRemoveResource={onRemoveResource}
      />

      {voiceActive && (
        <div className="px-4 py-2 border-b border-[#232832] bg-[#141922] flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-[#eef1f6]">
            <Radio className="w-3.5 h-3.5 text-[#10b981] shrink-0" aria-hidden="true" />
            <span className="font-medium">Full-Duplex Voice Active</span>
            <span aria-hidden="true" className="text-[#646e7e]">·</span>
            <span className="text-[#9aa3b2] truncate">{voiceStatusText}</span>
          </div>
          <span className="font-mono-tabular text-[11px] text-[#9aa3b2] shrink-0">
            16kHz / 24kHz PCM
          </span>
        </div>
      )}

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-5 min-h-0"
      >
        {messages.length === 0 && !liveUserTranscript && !liveAssistantTranscript ? (
          <div className="min-h-full flex flex-col justify-center max-w-lg mx-auto py-4 space-y-5">
            <div className="space-y-2">
              <h1 className="font-display text-xl font-semibold tracking-tight text-[#eef1f6] text-balance">
                Tri-Agent Grounded Verification
              </h1>
              <p className="text-sm text-[#9aa3b2] leading-relaxed">
                Every query is decomposed, solved via live search and your grounding files, cross-referenced sentence-by-sentence, and audited for reasoning compatibility across all three synced agents.
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-[#646e7e]">
                Quick Verification Prompts
              </p>
              <div className="space-y-2">
                {STARTER_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => onSubmitQuery(prompt)}
                    className="w-full text-left px-3.5 py-2.5 rounded-xl bg-[#161a21] hover:bg-[#1c212a] border border-[#232832] hover:border-[#343b49] text-xs text-[#d6dce6] transition-colors cursor-pointer"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg) => {
              const isUser = msg.role === 'user';
              const isInspected =
                msg.runSnapshot && activeInspectedRunId === msg.runSnapshot.runId;

              return (
                <article
                  key={msg.id}
                  className={`flex flex-col gap-2 ${isUser ? 'items-end' : 'items-start'}`}
                >
                  <div className="flex items-center gap-2 text-[11px] text-[#646e7e]">
                    <span className="font-medium text-[#9aa3b2]">
                      {isUser ? 'Operator' : 'Aegis Verified Output'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-tabular">
                      {msg.source === 'voice' ? 'Voice Live' : 'Text'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-tabular">
                      {new Date(msg.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                  </div>

                  <div
                    className={`rounded-xl px-4 py-3 text-sm leading-relaxed max-w-[92%] ${
                      isUser
                        ? 'bg-[#1c222d] border border-[#2c3444] text-[#eef1f6]'
                        : 'matte-inset text-[#e3e7ee] w-full'
                    }`}
                  >
                    {isUser ? (
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    ) : (
                      <div className="space-y-3">
                        <div className="prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-a:text-[#93c5fd] prose-code:text-[#e2e8f0] prose-pre:bg-[#0b0d10] prose-pre:border prose-pre:border-[#232832]">
                          <Markdown>{msg.content}</Markdown>
                        </div>

                        {msg.bottlenecks && msg.bottlenecks.length > 0 && (
                          <div className="rounded-lg border border-[#f59e0b]/35 bg-[#f59e0b]/10 p-3 space-y-1.5">
                            <div className="flex items-center gap-1.5 text-xs font-medium text-[#fcd34d]">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                              <span>Verification Bottleneck Disclosed</span>
                            </div>
                            <ul className="space-y-1 text-xs text-[#fde68a]/90 list-disc pl-4">
                              {msg.bottlenecks.map((b, idx) => (
                                <li key={idx}>{b}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {msg.citations && msg.citations.length > 0 && (
                          <div className="pt-2 border-t border-[#1e232c] space-y-1.5">
                            <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#9aa3b2]">
                              <ShieldCheck className="w-3.5 h-3.5 text-[#10b981]" aria-hidden="true" />
                              <span>Verified Sources ({msg.citations.length})</span>
                            </div>
                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                              {msg.citations.slice(0, 6).map((cit) => (
                                <a
                                  key={cit.url}
                                  href={cit.url.startsWith('http') ? cit.url : undefined}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-[#93c5fd] hover:underline truncate max-w-[240px]"
                                >
                                  <span className="truncate">{cit.title}</span>
                                  {cit.url.startsWith('http') && (
                                    <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                                  )}
                                </a>
                              ))}
                            </div>
                          </div>
                        )}

                        {msg.runSnapshot && (
                          <div className="pt-2 border-t border-[#1e232c] flex flex-wrap items-center justify-between gap-2 text-xs">
                            <div className="flex items-center gap-2 text-[#9aa3b2] font-mono-tabular text-[11px]">
                              <span>{msg.runSnapshot.partsCount} parts</span>
                              <span aria-hidden="true">·</span>
                              <span>{msg.runSnapshot.mistakesCount} flagged</span>
                              <span aria-hidden="true">·</span>
                              <span>{msg.runSnapshot.modelTier}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => onInspectRun(msg)}
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                                isInspected
                                  ? 'bg-[#eef1f6] text-[#0b0d10]'
                                  : 'bg-[#181c23] text-[#d6dce6] border border-[#282e39] hover:border-[#3c4556]'
                              }`}
                            >
                              <Eye className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                              <span>{isInspected ? 'Inspecting Run' : 'Inspect 3-Agent Sync'}</span>
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}

            {liveUserTranscript && (
              <div className="flex flex-col items-end gap-1">
                <span className="text-[11px] font-mono-tabular text-[#9aa3b2]">
                  Operator · Voice Live (transcribing)
                </span>
                <div className="rounded-xl px-4 py-2.5 text-sm bg-[#1c222d]/80 border border-[#2c3444] text-[#eef1f6] max-w-[90%]">
                  {liveUserTranscript}
                </div>
              </div>
            )}

            {liveAssistantTranscript && (
              <div className="flex flex-col items-start gap-1">
                <span className="text-[11px] font-mono-tabular text-[#10b981]">
                  Aegis Live Voice · Speaking
                </span>
                <div className="rounded-xl px-4 py-2.5 text-sm matte-inset text-[#e3e7ee] w-full">
                  {liveAssistantTranscript}
                </div>
              </div>
            )}

            {isRunning && (
              <div className="rounded-xl px-4 py-3 matte-inset border border-[#2a313e] text-xs text-[#9aa3b2] flex items-center justify-between gap-2">
                <span>Synchronizing Agent 1, Agent 2, and Agent 3 in real time...</span>
                <span className="font-mono-tabular text-[#10b981]">Live Pipeline</span>
              </div>
            )}
          </>
        )}
      </div>

      <div className="p-3 border-t border-[#232832] bg-[#0f1217]">
        <div className="flex items-end gap-2 bg-[#0b0d10] border border-[#252b36] focus-within:border-[#424b5d] rounded-xl p-2">
          <label htmlFor="terminal-query-input" className="sr-only">
            Enter query for 3-agent verification
          </label>
          <textarea
            id="terminal-query-input"
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter query for 3-agent verification, or toggle Voice Talk for hands-free full-duplex conversation..."
            className="flex-1 bg-transparent text-sm text-[#eef1f6] placeholder:text-[#646e7e] resize-none focus:outline-none px-2 py-1 min-h-[44px] max-h-[140px]"
          />

          <div className="flex items-center gap-1.5 shrink-0 pb-0.5">
            <button
              type="button"
              onClick={onToggleVoice}
              disabled={voiceConnecting}
              aria-label={voiceActive ? 'Turn off Voice Talk' : 'Turn on Voice Talk'}
              title={voiceActive ? 'Turn off Voice Talk' : 'Turn on Voice Talk'}
              className={`p-2.5 rounded-lg transition-colors cursor-pointer shrink-0 ${
                voiceActive
                  ? 'bg-[#ef4444]/20 text-[#fca5a5] border border-[#ef4444]/40 hover:bg-[#ef4444]/30'
                  : 'bg-[#181c23] text-[#9aa3b2] border border-[#282e39] hover:text-[#eef1f6] hover:border-[#3c4556]'
              }`}
            >
              {voiceActive ? (
                <MicOff className="w-4 h-4" aria-hidden="true" />
              ) : (
                <Mic className="w-4 h-4" aria-hidden="true" />
              )}
            </button>

            <button
              type="button"
              onClick={handleSend}
              disabled={isRunning || !input.trim()}
              aria-label="Run 3-agent verified query"
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg text-xs font-medium bg-[#eef1f6] text-[#0b0d10] hover:bg-[#d8dee9] disabled:opacity-40 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <ArrowUp className="w-4 h-4" aria-hidden="true" />
              <span>Verify</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
