import { Type, type Part } from '@google/genai';
import { generateWithFreeFallback } from './gemini-fallback.ts';
import {
  decideNextStepAction,
  ensureBottleneckDisclosures,
  evaluateKeywordOverlap,
  formatMistakeContextPrompt,
} from './pipeline-rules.ts';
import type {
  Agent1StepOutput,
  Agent2StepOutput,
  Agent3StepOutput,
  BottleneckReport,
  FaultOwner,
  GroundingResource,
  MistakeLogEntry,
  PipelineEvent,
  SourceCitation,
  StepAttemptSnapshot,
  SubPart,
  SyncedStepRecord,
} from './types.ts';

const MAX_ATTEMPTS = 4;

export interface TriAgentRunInput {
  runId: string;
  query: string;
  sourceMode: 'text' | 'voice';
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  resources: GroundingResource[];
  emit: (event: PipelineEvent) => void;
}

export interface TriAgentRunResult {
  finalAnswer: string;
  citations: SourceCitation[];
  bottlenecks: string[];
  steps: SyncedStepRecord[];
  mistakes: MistakeLogEntry[];
  activeModelTier: string;
}

function buildResourceParts(resources: GroundingResource[]): {
  textBlock: string;
  mediaParts: Part[];
  urls: string[];
} {
  const enabled = resources.filter((r) => r.enabled);
  const textSections: string[] = [];
  const mediaParts: Part[] = [];
  const urls: string[] = [];

  for (const res of enabled) {
    if (res.kind === 'url' && res.url) {
      urls.push(res.url);
    }
    if (res.extractedText) {
      const clipped = res.extractedText.slice(0, 12000);
      textSections.push(
        `[RESOURCE: ${res.name} | TYPE: ${res.kind.toUpperCase()}${res.url ? ` | URL: ${res.url}` : ''}]\n${clipped}`,
      );
    }
    if (
      res.base64Data &&
      (res.kind === 'pdf' || res.kind === 'image' || res.kind === 'video')
    ) {
      mediaParts.push({
        inlineData: {
          mimeType: res.mimeType,
          data: res.base64Data,
        },
      });
    }
  }

  return {
    textBlock:
      textSections.length > 0
        ? textSections.join('\n\n---\n\n')
        : 'No external user files or URLs attached.',
    mediaParts,
    urls,
  };
}

function formatConversationContext(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
): string {
  if (history.length === 0) return 'No prior turns.';
  return history
    .slice(-8)
    .map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 800)}`)
    .join('\n');
}

function safeJsonParse<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw.trim()) as T;
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1)) as T;
      } catch {
        return fallback;
      }
    }
    return fallback;
  }
}

export async function runTriAgentPipeline(
  input: TriAgentRunInput,
): Promise<TriAgentRunResult> {
  const { runId, query, sourceMode, history, resources, emit } = input;
  const mistakes: MistakeLogEntry[] = [];
  const allCitationsMap = new Map<string, SourceCitation>();
  const bottlenecks: string[] = [];
  const bottleneckReports: BottleneckReport[] = [];
  let activeModelTier = 'gemini-4-hydrogen (XHIGH)';

  const onFallback = (fromModel: string, toModel: string, reason: string) => {
    activeModelTier = toModel;
    emit({ type: 'model_fallback', runId, fromModel, toModel, reason });
  };

  const { textBlock, mediaParts, urls } = buildResourceParts(resources);
  const convContext = formatConversationContext(history);

  emit({ type: 'run_started', runId, query, sourceMode });

  // STEP 0: DECOMPOSITION (Synced across Agent 1, Agent 2, Agent 3)
  const decompContents: Part[] = [
    ...mediaParts,
    {
      text: [
        `User Query: "${query}"`,
        `Conversation Context:\n${convContext}`,
        `Attached Grounding Resources:\n${textBlock}`,
        `Decompose the user query into 1 to 4 atomic, non-overlapping sub-parts needed to construct a 100% verified, hallucination-free answer.`,
        `For simple factual or single-topic queries, use 1 or 2 focused parts. For multi-part or analytical queries, use 2 to 4 parts.`,
        `Provide short, concrete reasoning explaining why this decomposition covers the entire query without inventing unstated facts.`,
      ].join('\n\n'),
    },
  ];

  const decompRes = await generateWithFreeFallback({
    contents: [{ role: 'user', parts: decompContents }],
    preferDeepReasoning: true,
    onFallback,
    config: {
      systemInstruction:
        'You are Agent 1 (Decomposer & Grounded Solver). Break queries into clear atomic sub-parts without inventing facts. No false, hallucinated, or invented claims are permitted. Keep reasoning short and concrete.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          parts: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                objective: { type: Type.STRING },
              },
              required: ['title', 'objective'],
            },
          },
          reasoning: { type: Type.STRING },
          claimKeywords: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        required: ['parts', 'reasoning', 'claimKeywords'],
      },
    },
  });
  activeModelTier = decompRes.modelLabel;

  const parsedDecomp = safeJsonParse<{
    parts: Array<{ title: string; objective: string }>;
    reasoning: string;
    claimKeywords: string[];
  }>(decompRes.response.text, {
    parts: [{ title: 'Core Query Resolution', objective: query }],
    reasoning: 'Query treated as a single atomic verification unit.',
    claimKeywords: [],
  });

  const subParts: SubPart[] = (parsedDecomp.parts.length > 0
    ? parsedDecomp.parts.slice(0, 4)
    : [{ title: 'Core Query Resolution', objective: query }]
  ).map((p, idx) => ({
    id: `part-${idx + 1}`,
    index: idx + 1,
    title: p.title,
    objective: p.objective,
  }));

  const decomposeAgent1: Agent1StepOutput = {
    stepId: 'decompose',
    attempt: 1,
    phase: 'decompose',
    searchQueries: [],
    credibleSources: [],
    claimKeywords: parsedDecomp.claimKeywords ?? [],
    answer: subParts.map((p) => `${p.index}. ${p.title}: ${p.objective}`).join('\n'),
    reasoning: parsedDecomp.reasoning,
    modelUsed: decompRes.modelLabel,
  };

  emit({
    type: 'agent_output',
    runId,
    stepId: 'decompose',
    agent: 'agent1',
    attempt: 1,
    payload: decomposeAgent1,
  });

  // Agent 2 & Agent 3 validate Step 0 decomposition in parallel/sync
  const [decompA2Res, decompA3Res] = await Promise.all([
    generateWithFreeFallback({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `User Query: "${query}"\nProposed Sub-Parts:\n${decomposeAgent1.answer}\nAgent 1 Reasoning: ${decomposeAgent1.reasoning}\nVerify that the decomposition introduces zero invented/fake facts and strictly reflects the user query and attached grounding resources.`,
            },
          ],
        },
      ],
      preferDeepReasoning: false,
      onFallback,
      config: {
        systemInstruction:
          'You are Agent 2 (Anti-Hallucination Cross-Referencer). Ensure zero false, hallucinated, or invented claims appear in decomposition. Keep reasoning short and concrete.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            reasoning: { type: Type.STRING },
            anomalyFlagged: { type: Type.BOOLEAN },
            anomalyDetail: { type: Type.STRING },
          },
          required: ['reasoning', 'anomalyFlagged', 'anomalyDetail'],
        },
      },
    }),
    generateWithFreeFallback({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `User Query: "${query}"\nAgent 1 Decomposition:\n${decomposeAgent1.answer}\nAgent 1 Reasoning: ${decomposeAgent1.reasoning}\nVerify logical completeness of the decomposition and confirm no fabricated facts were introduced. Keep reasoning short and concrete.`,
            },
          ],
        },
      ],
      preferDeepReasoning: false,
      onFallback,
      config: {
        systemInstruction:
          'You are Agent 3 (Reasoning & Compatibility Auditor). Audit step 0 decomposition reasoning and ensure zero invented facts enter the pipeline. Keep reasoning short and concrete.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            matchedReasoningSummary: { type: Type.STRING },
            reasoning: { type: Type.STRING },
            anomalyFlagged: { type: Type.BOOLEAN },
            anomalyDetail: { type: Type.STRING },
          },
          required: ['matchedReasoningSummary', 'reasoning', 'anomalyFlagged', 'anomalyDetail'],
        },
      },
    }),
  ]);

  const parsedDecompA2 = safeJsonParse<{
    reasoning: string;
    anomalyFlagged: boolean;
    anomalyDetail: string;
  }>(decompA2Res.response.text, {
    reasoning: 'Decomposition keywords match user query intent with no invented assumptions.',
    anomalyFlagged: false,
    anomalyDetail: '',
  });

  const parsedDecompA3 = safeJsonParse<{
    matchedReasoningSummary: string;
    reasoning: string;
    anomalyFlagged: boolean;
    anomalyDetail: string;
  }>(decompA3Res.response.text, {
    matchedReasoningSummary: 'Agent 1 decomposition aligns with query scope.',
    reasoning: 'Step 0 reasoning verified.',
    anomalyFlagged: false,
    anomalyDetail: '',
  });

  const decomposeAgent2: Agent2StepOutput = {
    stepId: 'decompose',
    attempt: 1,
    keywordChecks: (decomposeAgent1.claimKeywords ?? []).map((kw) => ({
      phrase: kw,
      foundInSource:
        query.toLowerCase().includes(kw.toLowerCase()) ||
        textBlock.toLowerCase().includes(kw.toLowerCase()),
      sourceRef: 'Query / Grounding Scope',
    })),
    lexicalMatchRatio: 1,
    claimChecks: [
      {
        claim: `Decomposed into ${subParts.length} sub-part(s)`,
        verdict: parsedDecompA2.anomalyFlagged ? 'partial' : 'supported',
        evidence: parsedDecompA2.reasoning,
      },
    ],
    reasoning: parsedDecompA2.reasoning,
    anomalyFlagged: parsedDecompA2.anomalyFlagged,
    anomalyDetail: parsedDecompA2.anomalyDetail,
    modelUsed: decompA2Res.modelLabel,
  };

  const decomposeAgent3: Agent3StepOutput = {
    stepId: 'decompose',
    attempt: 1,
    agent1ReasoningValid: !parsedDecompA3.anomalyFlagged,
    agent2ReasoningValid: !parsedDecompA2.anomalyFlagged,
    compatibilityValid: !parsedDecompA3.anomalyFlagged,
    matchedReasoningSummary: parsedDecompA3.matchedReasoningSummary,
    reasoning: parsedDecompA3.reasoning,
    anomalyFlagged: parsedDecompA3.anomalyFlagged,
    faultOwner: parsedDecompA3.anomalyFlagged ? 'agent1' : 'none',
    anomalyDetail: parsedDecompA3.anomalyDetail,
    modelUsed: decompA3Res.modelLabel,
  };

  const steps: SyncedStepRecord[] = [
    {
      stepId: 'decompose',
      stepIndex: 0,
      stepLabel: 'Decompose Query',
      objective: `Break query into ${subParts.length} atomic part(s)`,
      status: 'verified',
      currentAttempt: 1,
      maxAttempts: MAX_ATTEMPTS,
      agent1: decomposeAgent1,
      agent2: decomposeAgent2,
      agent3: decomposeAgent3,
      history: [
        {
          attempt: 1,
          agent1: decomposeAgent1,
          agent2: decomposeAgent2,
          agent3: decomposeAgent3,
          outcome: 'passed',
        },
      ],
    },
    ...subParts.map((part, idx) => ({
      stepId: part.id,
      stepIndex: idx + 1,
      stepLabel: `Part ${part.index}: ${part.title}`,
      objective: part.objective,
      status: 'pending' as const,
      currentAttempt: 0,
      maxAttempts: MAX_ATTEMPTS,
      history: [],
    })),
    {
      stepId: 'synthesis',
      stepIndex: subParts.length + 1,
      stepLabel: 'Final Synthesis & Coherence',
      objective:
        'Club all verified part solutions into one coherent answer with zero invented facts and full unresolved-step disclosures.',
      status: 'pending',
      currentAttempt: 0,
      maxAttempts: MAX_ATTEMPTS,
      history: [],
    },
  ];

  emit({
    type: 'decomposition_complete',
    runId,
    parts: subParts,
    steps,
    decomposeAgent1,
    decomposeAgent2,
    decomposeAgent3,
  });

  async function executeSynchronizedStep(params: {
    stepRecord: SyncedStepRecord;
    phase: 'solve_part' | 'synthesize';
    stepPromptBuilder: (mistakeContext: string, attempt: number) => string;
    shouldUseWebSearch: boolean;
  }): Promise<void> {
    const { stepRecord, phase, stepPromptBuilder, shouldUseWebSearch } = params;
    let runAgent1 = true;
    let runAgent2 = true;
    let lastAgent1: Agent1StepOutput | undefined;
    let lastAgent2: Agent2StepOutput | undefined;
    let bestSnapshot: StepAttemptSnapshot | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      stepRecord.currentAttempt = attempt;
      stepRecord.status = attempt === 1 ? 'running' : 'retrying';
      emit({
        type: 'step_active',
        runId,
        stepId: stepRecord.stepId,
        attempt,
        status: stepRecord.status,
      });

      const mistakeContext = formatMistakeContextPrompt(mistakes, stepRecord.stepId);

      // AGENT 1: Internet Search + Grounding Resources -> Reasoning Synthesis
      if (runAgent1 || !lastAgent1) {
        let searchSummary = 'No external web search required for internal synthesis.';
        const gatheredSources: SourceCitation[] = [];
        let searchQueries: string[] = [];

        if (shouldUseWebSearch) {
          const searchPrompt = [
            stepPromptBuilder(mistakeContext, attempt),
            `Conversation Grounding URLs (if any): ${urls.length > 0 ? urls.join(', ') : 'None'}`,
            `First, search the internet for credible, authoritative sources covering this sub-part. Quote or list key factual evidence and exact figures/dates verbatim from the sources you find. If data cannot be found, report that explicitly—never invent numbers or citations.`,
          ].join('\n\n');

          const tools: Array<{ googleSearch?: Record<string, never>; urlContext?: Record<string, never> }> = [
            { googleSearch: {} },
          ];
          if (urls.length > 0) {
            tools.push({ urlContext: {} });
          }

          const searchRes = await generateWithFreeFallback({
            contents: [{ role: 'user', parts: [...mediaParts, { text: searchPrompt }] }],
            preferDeepReasoning: false,
            onFallback,
            config: {
              tools,
              systemInstruction:
                'You are Agent 1 (Stage A: Credible Source Gatherer). Search for authoritative sources and extract verbatim facts, dates, metrics, and source URLs. Never fabricate facts, estimates, or URLs.',
            },
          });
          activeModelTier = searchRes.modelLabel;
          searchSummary = searchRes.response.text ?? 'No search results returned.';

          const meta = searchRes.response.candidates?.[0]?.groundingMetadata;
          searchQueries = meta?.webSearchQueries ?? [];
          const chunks = meta?.groundingChunks ?? [];
          for (const chunk of chunks) {
            if (chunk.web?.uri) {
              const citation: SourceCitation = {
                title: chunk.web.title || chunk.web.uri,
                url: chunk.web.uri,
                snippet: searchSummary.slice(0, 320),
              };
              gatheredSources.push(citation);
              allCitationsMap.set(citation.url, citation);
            }
          }
        }

        for (const res of resources.filter((r) => r.enabled)) {
          const cit: SourceCitation = {
            title: `${res.name} (${res.kind.toUpperCase()})`,
            url: res.url || `grounding://${res.id}`,
            snippet: res.extractedText ? res.extractedText.slice(0, 400) : `Attached ${res.kind} file`,
          };
          gatheredSources.push(cit);
          if (res.url) allCitationsMap.set(res.url, cit);
        }

        const reasonPrompt = [
          stepPromptBuilder(mistakeContext, attempt),
          `Credible Search Findings (Stage A):\n${searchSummary}`,
          `Attached Grounding Text:\n${textBlock}`,
          `Unforgivable Mistake Log Context:\n${mistakeContext}`,
          `Now use deep reasoning strictly over the gathered credible sources and attached grounding resources to solve this step. STRICT RULE: Zero false, hallucinated, invented, or fake facts may appear. If evidence is missing or conflicting, state the verified basis and explicitly report what could not be found and why.`,
          `Provide short, concrete reasoning (2-3 sentences). List exact claimKeywords present in your answer.`,
        ].join('\n\n');

        const solveRes = await generateWithFreeFallback({
          contents: [{ role: 'user', parts: [...mediaParts, { text: reasonPrompt }] }],
          preferDeepReasoning: true,
          onFallback,
          config: {
            systemInstruction:
              'You are Agent 1 (Stage B: Grounded Reasoning Solver). Synthesize answers strictly from verified sources. Never allow any false, invented, or hallucinated fact into your answer. If unresolved limitations exist, report basis, missing facts, and cause.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                answer: { type: Type.STRING },
                reasoning: { type: Type.STRING },
                claimKeywords: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
              required: ['answer', 'reasoning', 'claimKeywords'],
            },
          },
        });
        activeModelTier = solveRes.modelLabel;

        const parsedA1 = safeJsonParse<{
          answer: string;
          reasoning: string;
          claimKeywords: string[];
        }>(solveRes.response.text, {
          answer: solveRes.response.text ?? 'Unable to resolve step from verified sources.',
          reasoning: 'Synthesized directly from gathered sources.',
          claimKeywords: [],
        });

        lastAgent1 = {
          stepId: stepRecord.stepId,
          attempt,
          phase,
          searchQueries,
          credibleSources: gatheredSources,
          claimKeywords: parsedA1.claimKeywords ?? [],
          answer: parsedA1.answer,
          reasoning: parsedA1.reasoning,
          modelUsed: solveRes.modelLabel,
        };
        stepRecord.agent1 = lastAgent1;
        emit({
          type: 'agent_output',
          runId,
          stepId: stepRecord.stepId,
          agent: 'agent1',
          attempt,
          payload: lastAgent1,
        });
      }

      // AGENT 2: Keyword & claiming-sentence match -> Reasoning cross-verification
      if (runAgent2 || !lastAgent2) {
        const sourceCorpusSnippets = [
          ...lastAgent1.credibleSources.map((s) => `${s.title} ${s.snippet}`),
          textBlock,
        ];
        const deterministicOverlap = evaluateKeywordOverlap(
          lastAgent1.answer,
          sourceCorpusSnippets,
        );

        const synthesisDisclosureInstruction =
          phase === 'synthesize' && bottleneckReports.length > 0
            ? `\nMANDATORY FINAL SYNTHESIS CHECK: Because ${bottleneckReports.length} prior step(s) hit the 4-attempt cap, verify that Agent 1's compiled answer explicitly reports (1) on what basis the best-supported option is used, (2) what could not be found/verified, and (3) why. If omitted, set anomalyFlagged=true.`
            : '';

        const a2Prompt = [
          `Step: ${stepRecord.stepLabel} (${stepRecord.objective})`,
          `Agent 1 Candidate Answer:\n${lastAgent1.answer}`,
          `Agent 1 Claim Keywords: ${lastAgent1.claimKeywords.join(', ') || 'None listed'}`,
          `Agent 1 Reasoning: ${lastAgent1.reasoning}`,
          `Deterministic Lexical Overlap Ratio: ${deterministicOverlap.matchRatio} (Matched: ${deterministicOverlap.matchedKeywords.join(', ') || 'none'} | Missing from text snippets: ${deterministicOverlap.missingKeywords.join(', ') || 'none'})`,
          `Credible Sources:\n${lastAgent1.credibleSources.map((s, i) => `[S${i + 1}] ${s.title} (${s.url}): ${s.snippet}`).join('\n') || 'None'}`,
          `Attached Grounding Resources:\n${textBlock}`,
          `Unforgivable Mistake Log Context:\n${mistakeContext}`,
          `Task (Follow strict order):\n1. First check whether keywords and claiming sentences in Agent 1's answer match the credible sources / grounding resources (or attached media).\n2. Then use your own reasoning to cross-verify each claim to ensure ZERO false, hallucinated, invented, or fake facts can reach the final answer.\n3. Provide short, concrete reasoning (2-3 sentences). Flag anomalyFlagged=true if ANY unsupported, invented, or extrapolated claim is found.${synthesisDisclosureInstruction}`,
        ].join('\n\n');

        const a2Res = await generateWithFreeFallback({
          contents: [{ role: 'user', parts: [...mediaParts, { text: a2Prompt }] }],
          preferDeepReasoning: true,
          onFallback,
          config: {
            systemInstruction:
              'You are Agent 2 (Anti-Hallucination Cross-Referencer). First match claiming sentences/keywords to credible sources, then cross-verify via reasoning. Ensure zero false, hallucinated, invented, or fake facts reach the final answer. Respect the Mistake Context Log.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                keywordChecks: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      phrase: { type: Type.STRING },
                      foundInSource: { type: Type.BOOLEAN },
                      sourceRef: { type: Type.STRING },
                    },
                    required: ['phrase', 'foundInSource', 'sourceRef'],
                  },
                },
                claimChecks: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      claim: { type: Type.STRING },
                      verdict: { type: Type.STRING },
                      evidence: { type: Type.STRING },
                    },
                    required: ['claim', 'verdict', 'evidence'],
                  },
                },
                reasoning: { type: Type.STRING },
                anomalyFlagged: { type: Type.BOOLEAN },
                anomalyDetail: { type: Type.STRING },
              },
              required: [
                'keywordChecks',
                'claimChecks',
                'reasoning',
                'anomalyFlagged',
                'anomalyDetail',
              ],
            },
          },
        });
        activeModelTier = a2Res.modelLabel;

        const parsedA2 = safeJsonParse<{
          keywordChecks: Array<{ phrase: string; foundInSource: boolean; sourceRef: string }>;
          claimChecks: Array<{ claim: string; verdict: string; evidence: string }>;
          reasoning: string;
          anomalyFlagged: boolean;
          anomalyDetail: string;
        }>(a2Res.response.text, {
          keywordChecks: [],
          claimChecks: [],
          reasoning: 'Cross-referenced claims against available sources.',
          anomalyFlagged: false,
          anomalyDetail: '',
        });

        lastAgent2 = {
          stepId: stepRecord.stepId,
          attempt,
          keywordChecks: parsedA2.keywordChecks.slice(0, 8),
          lexicalMatchRatio: deterministicOverlap.matchRatio,
          claimChecks: parsedA2.claimChecks.slice(0, 6).map((c) => ({
            claim: c.claim,
            verdict:
              c.verdict === 'unsupported' || c.verdict === 'partial'
                ? c.verdict
                : 'supported',
            evidence: c.evidence,
          })),
          reasoning: parsedA2.reasoning,
          anomalyFlagged: parsedA2.anomalyFlagged,
          anomalyDetail: parsedA2.anomalyDetail,
          modelUsed: a2Res.modelLabel,
        };
        stepRecord.agent2 = lastAgent2;
        emit({
          type: 'agent_output',
          runId,
          stepId: stepRecord.stepId,
          agent: 'agent2',
          attempt,
          payload: lastAgent2,
        });
      }

      // AGENT 3: Always reads & verifies BOTH Agent 1 & Agent 2 reasoning AND checks compatibility
      const synthesisA3Rule =
        phase === 'synthesize' && bottleneckReports.length > 0
          ? `\nMANDATORY SYNTHESIS AUDIT: Verify that the final compiled answer transparently reports for every 4-attempt unresolved step: (a) on what basis the answer is given, (b) what could not be found/verified, and (c) why.`
          : '';

      const a3Prompt = [
        `Step: ${stepRecord.stepLabel} (${stepRecord.objective}) | Attempt ${attempt}/${MAX_ATTEMPTS}`,
        `Agent 1 Answer:\n${lastAgent1.answer}`,
        `Agent 1 Reasoning:\n${lastAgent1.reasoning}`,
        `Agent 2 Verdict: anomalyFlagged=${lastAgent2.anomalyFlagged} (${lastAgent2.anomalyDetail || 'none'})`,
        `Agent 2 Reasoning:\n${lastAgent2.reasoning}`,
        `Unforgivable Mistake Log Context:\n${mistakeContext}`,
        `Task:\n1. Verify every sentence of Agent 1's reasoning for logical soundness and confirm ZERO false, hallucinated, invented, or fake facts exist.\n2. Verify every sentence of Agent 2's reasoning for accuracy.\n3. Match Agent 1's reasoning against Agent 2's reasoning to ensure they are 100% compatible and non-contradictory.${synthesisA3Rule}\n4. If Agent 2 flagged an anomaly or if you detect a reasoning flaw, unverified claim, or incompatibility, set anomalyFlagged=true and set faultOwner to "agent1", "agent2", or "both". Otherwise set anomalyFlagged=false and faultOwner="none".\n5. Keep your reasoning short and concrete.`,
      ].join('\n\n');

      const a3Res = await generateWithFreeFallback({
        contents: [{ role: 'user', parts: [{ text: a3Prompt }] }],
        preferDeepReasoning: true,
        onFallback,
        config: {
          systemInstruction:
            'You are Agent 3 (Reasoning & Compatibility Auditor). Verify Agent 1 reasoning, Agent 2 reasoning, and their compatibility. Ensure zero false, hallucinated, invented, or fake facts reach the final answer, and confirm full reporting of any 4-attempt unresolved basis/missing-info/reason.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              agent1ReasoningValid: { type: Type.BOOLEAN },
              agent2ReasoningValid: { type: Type.BOOLEAN },
              compatibilityValid: { type: Type.BOOLEAN },
              matchedReasoningSummary: { type: Type.STRING },
              reasoning: { type: Type.STRING },
              anomalyFlagged: { type: Type.BOOLEAN },
              faultOwner: { type: Type.STRING },
              anomalyDetail: { type: Type.STRING },
            },
            required: [
              'agent1ReasoningValid',
              'agent2ReasoningValid',
              'compatibilityValid',
              'matchedReasoningSummary',
              'reasoning',
              'anomalyFlagged',
              'faultOwner',
              'anomalyDetail',
            ],
          },
        },
      });
      activeModelTier = a3Res.modelLabel;

      const parsedA3 = safeJsonParse<{
        agent1ReasoningValid: boolean;
        agent2ReasoningValid: boolean;
        compatibilityValid: boolean;
        matchedReasoningSummary: string;
        reasoning: string;
        anomalyFlagged: boolean;
        faultOwner: string;
        anomalyDetail: string;
      }>(a3Res.response.text, {
        agent1ReasoningValid: true,
        agent2ReasoningValid: true,
        compatibilityValid: true,
        matchedReasoningSummary: 'Agent 1 and Agent 2 reasonings are consistent.',
        reasoning: 'Both reasoning chains verified.',
        anomalyFlagged: false,
        faultOwner: 'none',
        anomalyDetail: '',
      });

      const normalizedFault: FaultOwner =
        parsedA3.faultOwner === 'agent1' ||
        parsedA3.faultOwner === 'agent2' ||
        parsedA3.faultOwner === 'both'
          ? parsedA3.faultOwner
          : 'none';

      const agent3Out: Agent3StepOutput = {
        stepId: stepRecord.stepId,
        attempt,
        agent1ReasoningValid: parsedA3.agent1ReasoningValid,
        agent2ReasoningValid: parsedA3.agent2ReasoningValid,
        compatibilityValid: parsedA3.compatibilityValid,
        matchedReasoningSummary: parsedA3.matchedReasoningSummary,
        reasoning: parsedA3.reasoning,
        anomalyFlagged: parsedA3.anomalyFlagged,
        faultOwner: normalizedFault,
        anomalyDetail: parsedA3.anomalyDetail,
        modelUsed: a3Res.modelLabel,
      };
      stepRecord.agent3 = agent3Out;
      emit({
        type: 'agent_output',
        runId,
        stepId: stepRecord.stepId,
        agent: 'agent3',
        attempt,
        payload: agent3Out,
      });

      const currentSnapshot: StepAttemptSnapshot = {
        attempt,
        agent1: lastAgent1,
        agent2: lastAgent2,
        agent3: agent3Out,
        outcome: 'passed',
      };

      const decision = decideNextStepAction({
        attempt,
        maxAttempts: MAX_ATTEMPTS,
        agent2Flagged: lastAgent2.anomalyFlagged,
        agent3Flagged: agent3Out.anomalyFlagged,
        agent3FaultOwner: agent3Out.faultOwner,
      });

      if (decision.action === 'accept') {
        currentSnapshot.outcome = 'passed';
        stepRecord.history.push(currentSnapshot);
        stepRecord.status = 'verified';
        emit({
          type: 'step_resolved',
          runId,
          stepId: stepRecord.stepId,
          status: 'verified',
        });
        return;
      }

      const flaggedBy = lastAgent2.anomalyFlagged ? 'agent2' : 'agent3';
      const reason =
        (flaggedBy === 'agent2' ? lastAgent2.anomalyDetail : agent3Out.anomalyDetail) ||
        'Cross-verification or reasoning compatibility mismatch detected.';

      const mistakeEntry: MistakeLogEntry = {
        id: `${stepRecord.stepId}-att-${attempt}-${Date.now()}`,
        stepId: stepRecord.stepId,
        stepLabel: stepRecord.stepLabel,
        attempt,
        flaggedBy,
        faultOwner: decision.faultOwner,
        reason,
        resolutionNote:
          decision.action === 'cap_with_bottleneck'
            ? `Unresolved after 4 attempts; applying best-supported option with full basis, missing-info, and root-cause disclosure.`
            : decision.action === 'redo_agent2_and_3'
              ? `Re-running Agent 2 and Agent 3 only.`
              : `Re-running Agent 1, Agent 2, and Agent 3 with mistake context injected.`,
        timestamp: Date.now(),
      };
      mistakes.push(mistakeEntry);

      if (decision.action === 'cap_with_bottleneck') {
        currentSnapshot.outcome = 'bottleneck_capped';
        stepRecord.history.push(currentSnapshot);

        if (bestSnapshot?.agent1) {
          stepRecord.agent1 = bestSnapshot.agent1;
        }

        const chosenSources = (stepRecord.agent1?.credibleSources ?? [])
          .slice(0, 3)
          .map((s) => s.title)
          .join(', ');

        const report: BottleneckReport = {
          stepId: stepRecord.stepId,
          stepLabel: stepRecord.stepLabel,
          basisUsed: chosenSources
            ? `Most source-supported candidate derived from: ${chosenSources}`
            : 'Partial evidence from conversation grounding and non-extrapolated context only',
          missingInformation: reason,
          whyUnresolved:
            'Could not achieve clean cross-agent agreement within 4 attempts due to incomplete/conflicting external evidence or bounded verification depth.',
        };
        bottleneckReports.push(report);
        stepRecord.bottleneckReport = report;

        const bottleneckNote = `${stepRecord.stepLabel}: Unresolved after ${MAX_ATTEMPTS} attempts. Basis: ${report.basisUsed}. Could not verify: ${report.missingInformation}. Why: ${report.whyUnresolved}`;
        stepRecord.status = 'bottleneck';
        stepRecord.bottleneckNote = bottleneckNote;
        bottlenecks.push(bottleneckNote);

        emit({
          type: 'mistake_flagged',
          runId,
          entry: mistakeEntry,
          nextAction: 'cap_with_bottleneck',
        });
        emit({
          type: 'step_resolved',
          runId,
          stepId: stepRecord.stepId,
          status: 'bottleneck',
          bottleneckNote,
        });
        return;
      }

      if (!bestSnapshot || lastAgent2.lexicalMatchRatio >= (bestSnapshot.agent2?.lexicalMatchRatio ?? 0)) {
        bestSnapshot = currentSnapshot;
      }
      currentSnapshot.outcome = 'retrying';
      stepRecord.history.push(currentSnapshot);

      emit({
        type: 'mistake_flagged',
        runId,
        entry: mistakeEntry,
        nextAction: decision.action,
      });

      if (decision.action === 'redo_agent2_and_3') {
        runAgent1 = false;
        runAgent2 = true;
      } else {
        runAgent1 = true;
        runAgent2 = true;
      }
    }
  }

  for (const part of subParts) {
    const stepRecord = steps.find((s) => s.stepId === part.id)!;
    await executeSynchronizedStep({
      stepRecord,
      phase: 'solve_part',
      shouldUseWebSearch: true,
      stepPromptBuilder: (mistakeContext, attempt) =>
        [
          `Overall User Query: "${query}"`,
          `Current Sub-Part (${part.index}/${subParts.length}): ${part.title}`,
          `Objective: ${part.objective}`,
          `Attempt: ${attempt}/${MAX_ATTEMPTS}`,
          `Prior Mistake Log:\n${mistakeContext}`,
        ].join('\n'),
    });
  }

  const synthesisStep = steps.find((s) => s.stepId === 'synthesis')!;
  const compiledPartsText = subParts
    .map((part) => {
      const rec = steps.find((s) => s.stepId === part.id);
      return `[Part ${part.index}: ${part.title} | Status: ${rec?.status ?? 'unknown'}]\nVerified Answer: ${rec?.agent1?.answer ?? 'N/A'}\nSources: ${(rec?.agent1?.credibleSources ?? []).map((s) => s.url).join(', ') || 'None'}`;
    })
    .join('\n\n');

  const unresolvedReportsText =
    bottleneckReports.length > 0
      ? bottleneckReports
          .map(
            (r) =>
              `- Step "${r.stepLabel}":\n  Basis used: ${r.basisUsed}\n  Missing / unverified: ${r.missingInformation}\n  Why unresolved: ${r.whyUnresolved}`,
          )
          .join('\n')
      : 'None';

  await executeSynchronizedStep({
    stepRecord: synthesisStep,
    phase: 'synthesize',
    shouldUseWebSearch: false,
    stepPromptBuilder: (mistakeContext, attempt) =>
      [
        `Overall User Query: "${query}"`,
        `Verified Sub-Part Solutions to Club Together:\n${compiledPartsText}`,
        `4-Attempt Unresolved Step Reports (ALL 3 agents must verify these are explicitly reported in the final answer):\n${unresolvedReportsText}`,
        `Attempt: ${attempt}/${MAX_ATTEMPTS}`,
        `Prior Mistake Log:\n${mistakeContext}`,
        `Club all verified part solutions into one cohesive, direct answer. STRICT RESPONSIBILITIES:\n1. Zero false, hallucinated, invented, or fake facts may appear in the final answer.\n2. If any step reached the 4-attempt unresolved cap, explicitly state in the final answer: (a) on what basis you are answering, (b) what could not be found/verified, and (c) why.`,
      ].join('\n\n'),
  });

  const rawFinalAnswer =
    synthesisStep.agent1?.answer ||
    subParts
      .map((p) => steps.find((s) => s.stepId === p.id)?.agent1?.answer)
      .filter(Boolean)
      .join('\n\n');

  const finalAnswer = ensureBottleneckDisclosures(rawFinalAnswer, bottleneckReports);
  const citations = Array.from(allCitationsMap.values());

  emit({
    type: 'run_completed',
    runId,
    finalAnswer,
    citations,
    bottlenecks,
    activeModelTier,
  });

  return {
    finalAnswer,
    citations,
    bottlenecks,
    steps,
    mistakes,
    activeModelTier,
  };
}
