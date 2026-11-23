export type ResourceKind = 'url' | 'pdf' | 'doc' | 'text' | 'image' | 'video';

export interface GroundingResource {
  id: string;
  kind: ResourceKind;
  name: string;
  url?: string;
  mimeType: string;
  extractedText?: string;
  base64Data?: string;
  byteSize: number;
  addedAt: number;
  enabled: boolean;
}

export interface SubPart {
  id: string;
  index: number;
  title: string;
  objective: string;
}

export interface SourceCitation {
  title: string;
  url: string;
  snippet: string;
}

export interface Agent1StepOutput {
  stepId: string;
  attempt: number;
  phase: 'decompose' | 'solve_part' | 'synthesize';
  searchQueries: string[];
  credibleSources: SourceCitation[];
  claimKeywords: string[];
  answer: string;
  reasoning: string;
  modelUsed: string;
}

export interface KeywordCheckItem {
  phrase: string;
  foundInSource: boolean;
  sourceRef: string;
}

export interface ClaimCheckItem {
  claim: string;
  verdict: 'supported' | 'partial' | 'unsupported';
  evidence: string;
}

export interface Agent2StepOutput {
  stepId: string;
  attempt: number;
  keywordChecks: KeywordCheckItem[];
  lexicalMatchRatio: number;
  claimChecks: ClaimCheckItem[];
  reasoning: string;
  anomalyFlagged: boolean;
  anomalyDetail: string;
  modelUsed: string;
}

export type FaultOwner = 'none' | 'agent1' | 'agent2' | 'both';

export interface Agent3StepOutput {
  stepId: string;
  attempt: number;
  agent1ReasoningValid: boolean;
  agent2ReasoningValid: boolean;
  compatibilityValid: boolean;
  matchedReasoningSummary: string;
  reasoning: string;
  anomalyFlagged: boolean;
  faultOwner: FaultOwner;
  anomalyDetail: string;
  modelUsed: string;
}

export interface StepAttemptSnapshot {
  attempt: number;
  agent1?: Agent1StepOutput;
  agent2?: Agent2StepOutput;
  agent3?: Agent3StepOutput;
  outcome: 'passed' | 'retrying' | 'bottleneck_capped';
}

export type StepStatus = 'pending' | 'running' | 'retrying' | 'verified' | 'bottleneck' | 'error';

export interface BottleneckReport {
  stepId: string;
  stepLabel: string;
  basisUsed: string;
  missingInformation: string;
  whyUnresolved: string;
}

export interface SyncedStepRecord {
  stepId: string;
  stepIndex: number;
  stepLabel: string;
  objective: string;
  status: StepStatus;
  currentAttempt: number;
  maxAttempts: number;
  agent1?: Agent1StepOutput;
  agent2?: Agent2StepOutput;
  agent3?: Agent3StepOutput;
  history: StepAttemptSnapshot[];
  bottleneckNote?: string;
  bottleneckReport?: BottleneckReport;
}

export interface MistakeLogEntry {
  id: string;
  stepId: string;
  stepLabel: string;
  attempt: number;
  flaggedBy: 'agent2' | 'agent3';
  faultOwner: FaultOwner;
  reason: string;
  resolutionNote: string;
  timestamp: number;
}

export interface PipelineRunState {
  runId: string;
  query: string;
  sourceMode: 'text' | 'voice';
  status: 'idle' | 'running' | 'completed' | 'error';
  activeStepId: string;
  parts: SubPart[];
  steps: SyncedStepRecord[];
  mistakes: MistakeLogEntry[];
  finalAnswer: string;
  citations: SourceCitation[];
  bottlenecks: string[];
  activeModelTier: string;
  errorMessage?: string;
}

export type PipelineEvent =
  | {
      type: 'run_started';
      runId: string;
      query: string;
      sourceMode: 'text' | 'voice';
    }
  | {
      type: 'model_fallback';
      runId: string;
      fromModel: string;
      toModel: string;
      reason: string;
    }
  | {
      type: 'decomposition_complete';
      runId: string;
      parts: SubPart[];
      steps: SyncedStepRecord[];
      decomposeAgent1: Agent1StepOutput;
      decomposeAgent2: Agent2StepOutput;
      decomposeAgent3: Agent3StepOutput;
    }
  | {
      type: 'step_active';
      runId: string;
      stepId: string;
      attempt: number;
      status: StepStatus;
    }
  | {
      type: 'agent_output';
      runId: string;
      stepId: string;
      agent: 'agent1' | 'agent2' | 'agent3';
      attempt: number;
      payload: Agent1StepOutput | Agent2StepOutput | Agent3StepOutput;
    }
  | {
      type: 'mistake_flagged';
      runId: string;
      entry: MistakeLogEntry;
      nextAction: 'redo_all' | 'redo_agent2_and_3' | 'cap_with_bottleneck';
    }
  | {
      type: 'step_resolved';
      runId: string;
      stepId: string;
      status: 'verified' | 'bottleneck';
      bottleneckNote?: string;
    }
  | {
      type: 'run_completed';
      runId: string;
      finalAnswer: string;
      citations: SourceCitation[];
      bottlenecks: string[];
      activeModelTier: string;
    }
  | {
      type: 'run_error';
      runId: string;
      message: string;
    };

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  source: 'text' | 'voice';
  content: string;
  timestamp: number;
  citations?: SourceCitation[];
  bottlenecks?: string[];
  runSnapshot?: {
    runId: string;
    partsCount: number;
    mistakesCount: number;
    modelTier: string;
    steps: SyncedStepRecord[];
    mistakes: MistakeLogEntry[];
  };
  streaming?: boolean;
}
