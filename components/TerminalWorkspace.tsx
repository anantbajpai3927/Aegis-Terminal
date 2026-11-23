'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { float32ToPcm16Base64, Pcm24kPlayer } from '@/lib/audio-utils';
import type {
  ChatMessage,
  GroundingResource,
  MistakeLogEntry,
  PipelineEvent,
  PipelineRunState,
} from '@/lib/types';
import TopHeader, { type WorkspaceTab } from './TopHeader';
import ChatPanel from './ChatPanel';
import AgentSyncBay from './AgentSyncBay';
import GroundingBar from './GroundingBar';
import MistakeLogPanel from './MistakeLogPanel';

const INITIAL_RUN_STATE: PipelineRunState = {
  runId: '',
  query: '',
  sourceMode: 'text',
  status: 'idle',
  activeStepId: 'decompose',
  parts: [],
  steps: [],
  mistakes: [],
  finalAnswer: '',
  citations: [],
  bottlenecks: [],
  activeModelTier: 'gemini-4-hydrogen (HIGH)',
};

export default function TerminalWorkspace() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('workspace');
  const [resources, setResources] = useState<GroundingResource[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [runState, setRunState] = useState<PipelineRunState>(INITIAL_RUN_STATE);
  const [sessionMistakes, setSessionMistakes] = useState<MistakeLogEntry[]>([]);
  const [autoSync, setAutoSync] = useState(true);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Voice Live states
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceConnecting, setVoiceConnecting] = useState(false);
  const [voiceStatusText, setVoiceStatusText] = useState('Standby');
  const [liveUserTranscript, setLiveUserTranscript] = useState('');
  const [liveAssistantTranscript, setLiveAssistantTranscript] = useState('');

  // Refs for WebSocket & WebAudio callbacks (prevent stale closures)
  const autoSyncRef = useRef(autoSync);
  const resourcesRef = useRef(resources);
  const messagesRef = useRef(messages);
  useEffect(() => {
    autoSyncRef.current = autoSync;
    resourcesRef.current = resources;
    messagesRef.current = messages;
  }, [autoSync, resources, messages]);
  const liveUserTranscriptRef = useRef('');
  const liveAssistantTranscriptRef = useRef('');
  const latestVoiceRunRef = useRef<PipelineRunState>(INITIAL_RUN_STATE);
  const voiceReadyRef = useRef(false);
  const voiceSessionOpenRef = useRef(false);

  const wsRef = useRef<WebSocket | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const playerRef = useRef<Pcm24kPlayer | null>(null);

  const applyPipelineEvent = useCallback((event: PipelineEvent) => {
    if (event.type === 'mistake_flagged') {
      setSessionMistakes((prev) => [event.entry, ...prev]);
    }

    setRunState((prev) => {
      let next: PipelineRunState;
      switch (event.type) {
        case 'run_started':
          next = {
            ...INITIAL_RUN_STATE,
            runId: event.runId,
            query: event.query,
            sourceMode: event.sourceMode,
            status: 'running',
            activeStepId: 'decompose',
            steps: [
              {
                stepId: 'decompose',
                stepIndex: 0,
                stepLabel: 'Decompose Query',
                objective: 'Break query into atomic parts with grounded reasoning.',
                status: 'running',
                currentAttempt: 1,
                maxAttempts: 4,
                history: [],
              },
            ],
          };
          break;

        case 'model_fallback':
          next = {
            ...prev,
            activeModelTier: event.toModel,
          };
          break;

        case 'decomposition_complete':
          next = {
            ...prev,
            parts: event.parts,
            steps: event.steps,
            activeStepId: autoSyncRef.current ? 'decompose' : prev.activeStepId,
          };
          break;

        case 'step_active':
          next = {
            ...prev,
            activeStepId: autoSyncRef.current ? event.stepId : prev.activeStepId,
            steps: prev.steps.map((s) =>
              s.stepId === event.stepId
                ? { ...s, status: event.status, currentAttempt: event.attempt }
                : s,
            ),
          };
          break;

        case 'agent_output':
          next = {
            ...prev,
            activeStepId: autoSyncRef.current ? event.stepId : prev.activeStepId,
            steps: prev.steps.map((s) => {
              if (s.stepId !== event.stepId) return s;
              if (event.agent === 'agent1') {
                return { ...s, agent1: event.payload as typeof s.agent1 };
              }
              if (event.agent === 'agent2') {
                return { ...s, agent2: event.payload as typeof s.agent2 };
              }
              return { ...s, agent3: event.payload as typeof s.agent3 };
            }),
          };
          break;

        case 'mistake_flagged':
          next = {
            ...prev,
            mistakes: [...prev.mistakes, event.entry],
          };
          break;

        case 'step_resolved':
          next = {
            ...prev,
            steps: prev.steps.map((s) =>
              s.stepId === event.stepId
                ? {
                    ...s,
                    status: event.status,
                    bottleneckNote: event.bottleneckNote,
                  }
                : s,
            ),
          };
          break;

        case 'run_completed':
          next = {
            ...prev,
            status: 'completed',
            finalAnswer: event.finalAnswer,
            citations: event.citations,
            bottlenecks: event.bottlenecks,
            activeModelTier: event.activeModelTier,
            activeStepId: autoSyncRef.current ? 'synthesis' : prev.activeStepId,
          };
          break;

        case 'run_error':
          next = {
            ...prev,
            status: 'error',
            errorMessage: event.message,
            steps: prev.steps.map((s) =>
              s.status === 'running' || s.status === 'retrying'
                ? { ...s, status: 'error' }
                : s,
            ),
          };
          break;

        default:
          next = prev;
      }

      latestVoiceRunRef.current = next;
      return next;
    });
  }, []);

  const stopVoiceSession = useCallback(async () => {
    voiceReadyRef.current = false;
    voiceSessionOpenRef.current = false;
    setVoiceActive(false);
    setVoiceConnecting(false);
    setVoiceStatusText('Disconnected');

    try {
      processorRef.current?.disconnect();
      processorRef.current = null;
    } catch {
      // Ignore disconnect errors
    }

    try {
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    } catch {
      // Ignore track stop errors
    }

    try {
      if (inputAudioCtxRef.current && inputAudioCtxRef.current.state !== 'closed') {
        await inputAudioCtxRef.current.close();
      }
      inputAudioCtxRef.current = null;
    } catch {
      // Ignore audio ctx close errors
    }

    try {
      await playerRef.current?.close();
      playerRef.current = null;
    } catch {
      // Ignore player close errors
    }

    try {
      wsRef.current?.close();
      wsRef.current = null;
    } catch {
      // Ignore ws close errors
    }

    liveUserTranscriptRef.current = '';
    liveAssistantTranscriptRef.current = '';
    setLiveUserTranscript('');
    setLiveAssistantTranscript('');
  }, []);

  useEffect(() => {
    return () => {
      void stopVoiceSession();
    };
  }, [stopVoiceSession]);

  // Keep active Live Voice session synced when grounding resources or chat history change
  useEffect(() => {
    if (voiceActive && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'sync_context',
          resources,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      );
    }
  }, [resources, messages, voiceActive]);

  const startVoiceSession = useCallback(async () => {
    if (voiceConnecting || voiceActive) return;
    setErrorBanner(null);
    voiceReadyRef.current = false;
    voiceSessionOpenRef.current = true;
    setVoiceConnecting(true);
    setVoiceStatusText('Requesting microphone access...');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;

      const inputCtx = new AudioContext({ sampleRate: 16000 });
      inputAudioCtxRef.current = inputCtx;
      if (inputCtx.state === 'suspended') await inputCtx.resume();

      const player = new Pcm24kPlayer();
      playerRef.current = player;
      await player.resume();

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/live`);
      wsRef.current = ws;

      ws.onopen = () => {
        setVoiceStatusText('Initializing Gemini Live session...');
        ws.send(
          JSON.stringify({
            type: 'init',
            resources: resourcesRef.current,
            history: messagesRef.current.map((m) => ({
              role: m.role,
              content: m.content,
            })),
          }),
        );

        const source = inputCtx.createMediaStreamSource(stream);
        const processor = inputCtx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (event) => {
          if (!voiceReadyRef.current || ws.readyState !== WebSocket.OPEN) return;
          const channelData = event.inputBuffer.getChannelData(0);
          const base64 = float32ToPcm16Base64(channelData);
          ws.send(JSON.stringify({ type: 'audio', data: base64 }));
        };

        source.connect(processor);
        processor.connect(inputCtx.destination);
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data as string) as {
          type: string;
          model?: string;
          text?: string;
          data?: string;
          message?: string;
          reason?: string;
          from?: string;
          to?: string;
          event?: PipelineEvent;
          runId?: string;
          query?: string;
          finalAnswer?: string;
          citations?: ChatMessage['citations'];
          bottlenecks?: string[];
          steps?: PipelineRunState['steps'];
          mistakes?: MistakeLogEntry[];
          modelTier?: string;
        };

        if (msg.type === 'live_ready') {
          voiceReadyRef.current = true;
          setVoiceConnecting(false);
          setVoiceActive(true);
          setVoiceStatusText(`Listening (${msg.model ?? 'gemini-3.8-live'})`);
          return;
        }

        if (msg.type === 'live_fallback') {
          setVoiceStatusText(`Switching to ${msg.to}...`);
          return;
        }

        if (msg.type === 'input_transcript' && msg.text) {
          // Commit previous assistant live transcript if starting a new user utterance
          if (liveAssistantTranscriptRef.current.trim()) {
            const committed = liveAssistantTranscriptRef.current.trim();
            liveAssistantTranscriptRef.current = '';
            setLiveAssistantTranscript('');
            setMessages((prev) => [
              ...prev,
              {
                id: `voice-a-${Date.now()}`,
                role: 'assistant',
                source: 'voice',
                content: committed,
                timestamp: Date.now(),
              },
            ]);
          }
          liveUserTranscriptRef.current = `${liveUserTranscriptRef.current}${msg.text}`;
          setLiveUserTranscript(liveUserTranscriptRef.current);
          return;
        }

        if (msg.type === 'output_transcript' && msg.text) {
          if (liveUserTranscriptRef.current.trim()) {
            const committedUser = liveUserTranscriptRef.current.trim();
            liveUserTranscriptRef.current = '';
            setLiveUserTranscript('');
            setMessages((prev) => [
              ...prev,
              {
                id: `voice-u-${Date.now()}`,
                role: 'user',
                source: 'voice',
                content: committedUser,
                timestamp: Date.now(),
              },
            ]);
          }
          liveAssistantTranscriptRef.current = `${liveAssistantTranscriptRef.current}${msg.text}`;
          setLiveAssistantTranscript(liveAssistantTranscriptRef.current);
          return;
        }

        if (msg.type === 'audio' && msg.data) {
          playerRef.current?.enqueue(msg.data);
          return;
        }

        if (msg.type === 'interrupted') {
          playerRef.current?.interrupt();
          setVoiceStatusText('Listening (interrupted)');
          return;
        }

        if (msg.type === 'pipeline_event' && msg.event) {
          if (msg.event.type === 'run_error') {
            setErrorBanner(msg.event.message);
            setVoiceStatusText('Verification stopped (error)');
            setMessages((prev) => [
              ...prev,
              {
                id: `voice-err-${Date.now()}`,
                role: 'assistant',
                source: 'voice',
                content: `**Process Stopped (Error):** ${msg.event!.type === 'run_error' ? msg.event!.message : ''}`,
                timestamp: Date.now(),
              },
            ]);
          } else {
            setVoiceStatusText('Running 3-agent verification...');
          }
          applyPipelineEvent(msg.event);
          return;
        }

        if (msg.type === 'verified_voice_result' && msg.finalAnswer) {
          setVoiceStatusText('Speaking verified output');
          // Flush any pending user voice transcript first
          if (liveUserTranscriptRef.current.trim()) {
            const committedUser = liveUserTranscriptRef.current.trim();
            liveUserTranscriptRef.current = '';
            setLiveUserTranscript('');
            setMessages((prev) => [
              ...prev,
              {
                id: `voice-u-${Date.now()}`,
                role: 'user',
                source: 'voice',
                content: committedUser,
                timestamp: Date.now(),
              },
            ]);
          }

          // Replace streaming live transcript with verified structured answer in chat
          liveAssistantTranscriptRef.current = '';
          setLiveAssistantTranscript('');

          const runSnap = latestVoiceRunRef.current;
          setMessages((prev) => [
            ...prev,
            {
              id: `voice-verified-${Date.now()}`,
              role: 'assistant',
              source: 'voice',
              content: msg.finalAnswer ?? '',
              timestamp: Date.now(),
              citations: msg.citations ?? [],
              bottlenecks: msg.bottlenecks ?? [],
              runSnapshot: {
                runId: msg.runId || runSnap.runId,
                partsCount: runSnap.parts.length,
                mistakesCount: (msg.mistakes ?? runSnap.mistakes).length,
                modelTier: msg.modelTier || runSnap.activeModelTier,
                steps: msg.steps ?? runSnap.steps,
                mistakes: msg.mistakes ?? runSnap.mistakes,
              },
            },
          ]);
          return;
        }

        if (msg.type === 'turn_complete') {
          if (liveUserTranscriptRef.current.trim()) {
            const committedUser = liveUserTranscriptRef.current.trim();
            liveUserTranscriptRef.current = '';
            setLiveUserTranscript('');
            setMessages((prev) => [
              ...prev,
              {
                id: `voice-u-${Date.now()}`,
                role: 'user',
                source: 'voice',
                content: committedUser,
                timestamp: Date.now(),
              },
            ]);
          }
          if (liveAssistantTranscriptRef.current.trim()) {
            const committedAsst = liveAssistantTranscriptRef.current.trim();
            liveAssistantTranscriptRef.current = '';
            setLiveAssistantTranscript('');
            setMessages((prev) => [
              ...prev,
              {
                id: `voice-a-${Date.now()}`,
                role: 'assistant',
                source: 'voice',
                content: committedAsst,
                timestamp: Date.now(),
              },
            ]);
          }
          setVoiceStatusText('Listening');
          return;
        }

        if (msg.type === 'live_error') {
          const text = msg.message || 'Voice stream encountered an error.';
          setErrorBanner(text);
          void stopVoiceSession();
          return;
        }

        if (msg.type === 'live_closed') {
          if (voiceSessionOpenRef.current) {
            setErrorBanner(msg.reason || 'Live voice session closed.');
            void stopVoiceSession();
          }
        }
      };

      ws.onerror = () => {
        setErrorBanner('Unable to establish full-duplex voice WebSocket connection.');
        void stopVoiceSession();
      };

      ws.onclose = () => {
        if (voiceSessionOpenRef.current) {
          void stopVoiceSession();
        }
      };
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Microphone permission denied or audio hardware unavailable.';
      setErrorBanner(msg);
      await stopVoiceSession();
    }
  }, [applyPipelineEvent, stopVoiceSession, voiceActive, voiceConnecting]);

  const handleToggleVoice = useCallback(() => {
    if (voiceActive || voiceConnecting) {
      void stopVoiceSession();
    } else {
      void startVoiceSession();
    }
  }, [startVoiceSession, stopVoiceSession, voiceActive, voiceConnecting]);

  const handleSubmitQuery = useCallback(
    async (query: string) => {
      if (runState.status === 'running') return;
      setErrorBanner(null);

      const runId = `run-${Date.now()}`;
      const userMsg: ChatMessage = {
        id: `u-${Date.now()}`,
        role: 'user',
        source: 'text',
        content: query,
        timestamp: Date.now(),
      };

      const historyPayload = messagesRef.current.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      setMessages((prev) => [...prev, userMsg]);
      setRunState({
        ...INITIAL_RUN_STATE,
        runId,
        query,
        sourceMode: 'text',
        status: 'running',
        activeStepId: 'decompose',
        steps: [
          {
            stepId: 'decompose',
            stepIndex: 0,
            stepLabel: 'Decompose Query',
            objective: 'Break query into atomic parts with grounded reasoning.',
            status: 'running',
            currentAttempt: 1,
            maxAttempts: 4,
            history: [],
          },
        ],
      });

      let terminalEventSeen = false;

      try {
        const res = await fetch('/api/chat/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            runId,
            query,
            history: historyPayload,
            resources: resourcesRef.current,
          }),
        });

        if (!res.ok || !res.body) {
          const errData = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(errData.error || `Server error (${res.status})`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n\n');
          buffer = lines.pop() ?? '';

          for (const block of lines) {
            const dataLine = block
              .split('\n')
              .find((line) => line.startsWith('data: '));
            if (!dataLine) continue;

            const event = JSON.parse(dataLine.slice(6)) as PipelineEvent;
            applyPipelineEvent(event);

            if (event.type === 'run_completed') {
              terminalEventSeen = true;
              setRunState((latest) => {
                setMessages((prevMsgs) => [
                  ...prevMsgs,
                  {
                    id: `a-${Date.now()}`,
                    role: 'assistant',
                    source: 'text',
                    content: event.finalAnswer,
                    timestamp: Date.now(),
                    citations: event.citations,
                    bottlenecks: event.bottlenecks,
                    runSnapshot: {
                      runId,
                      partsCount: latest.parts.length,
                      mistakesCount: latest.mistakes.length,
                      modelTier: event.activeModelTier,
                      steps: latest.steps,
                      mistakes: latest.mistakes,
                    },
                  },
                ]);
                return latest;
              });
            } else if (event.type === 'run_error') {
              terminalEventSeen = true;
              setErrorBanner(event.message);
              setMessages((prevMsgs) => [
                ...prevMsgs,
                {
                  id: `err-${Date.now()}`,
                  role: 'assistant',
                  source: 'text',
                  content: `**Process Stopped (Error):** ${event.message}`,
                  timestamp: Date.now(),
                },
              ]);
            }
          }
        }

        if (!terminalEventSeen) {
          throw new Error('Verification stream closed unexpectedly before completing.');
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to execute verification pipeline.';
        setErrorBanner(message);
        setRunState((prev) => ({
          ...prev,
          status: 'error',
          errorMessage: message,
          steps: prev.steps.map((s) =>
            s.status === 'running' || s.status === 'retrying'
              ? { ...s, status: 'error' }
              : s,
          ),
        }));
        if (!terminalEventSeen) {
          setMessages((prevMsgs) => [
            ...prevMsgs,
            {
              id: `err-${Date.now()}`,
              role: 'assistant',
              source: 'text',
              content: `**Process Stopped (Error):** ${message}`,
              timestamp: Date.now(),
            },
          ]);
        }
      }
    },
    [applyPipelineEvent, runState.status],
  );

  const handleInspectRun = useCallback((msg: ChatMessage) => {
    if (!msg.runSnapshot) return;
    setAutoSync(false);
    setRunState({
      runId: msg.runSnapshot.runId,
      query: '',
      sourceMode: msg.source,
      status: 'completed',
      activeStepId: msg.runSnapshot.steps[0]?.stepId ?? 'decompose',
      parts: [],
      steps: msg.runSnapshot.steps,
      mistakes: msg.runSnapshot.mistakes,
      finalAnswer: msg.content,
      citations: msg.citations ?? [],
      bottlenecks: msg.bottlenecks ?? [],
      activeModelTier: msg.runSnapshot.modelTier,
    });
    setActiveTab('workspace');
  }, []);

  return (
    <div className="min-h-screen lg:h-screen flex flex-col bg-[#0b0d10] text-[#eef1f6] lg:overflow-hidden">
      <TopHeader
        activeTab={activeTab}
        onTabChange={setActiveTab}
        voiceActive={voiceActive}
        voiceConnecting={voiceConnecting}
        onToggleVoice={handleToggleVoice}
        resourcesCount={resources.length}
        mistakesCount={sessionMistakes.length}
      />

      {errorBanner && (
        <div
          role="alert"
          className="px-5 py-2 bg-[#ef4444]/15 border-b border-[#ef4444]/35 text-xs text-[#fca5a5] flex items-center justify-between gap-4 shrink-0"
        >
          <span>{errorBanner}</span>
          <button
            type="button"
            onClick={() => setErrorBanner(null)}
            className="text-xs underline hover:text-white cursor-pointer shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      <main className="flex-1 min-h-0 p-3 md:p-4 lg:overflow-hidden">
        {activeTab === 'workspace' && (
          <motion.div
            key="workspace"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.16 }}
            className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:h-full min-h-0"
          >
            <div className="lg:col-span-5 min-h-[520px] lg:min-h-0 lg:h-full">
              <ChatPanel
                messages={messages}
                isRunning={runState.status === 'running'}
                voiceActive={voiceActive}
                voiceConnecting={voiceConnecting}
                voiceStatusText={voiceStatusText}
                liveUserTranscript={liveUserTranscript}
                liveAssistantTranscript={liveAssistantTranscript}
                resources={resources}
                onAddResource={(res) => setResources((prev) => [...prev, res])}
                onToggleResource={(id) =>
                  setResources((prev) =>
                    prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)),
                  )
                }
                onRemoveResource={(id) =>
                  setResources((prev) => prev.filter((r) => r.id !== id))
                }
                onSubmitQuery={handleSubmitQuery}
                onToggleVoice={handleToggleVoice}
                onInspectRun={handleInspectRun}
                activeInspectedRunId={runState.runId || null}
              />
            </div>

            <div className="lg:col-span-7 min-h-[480px] lg:min-h-0 lg:h-full">
              <AgentSyncBay
                runState={runState}
                autoSync={autoSync}
                onToggleAutoSync={() => setAutoSync((v) => !v)}
                onSelectStep={(stepId) => {
                  setAutoSync(false);
                  setRunState((prev) => ({ ...prev, activeStepId: stepId }));
                }}
              />
            </div>
          </motion.div>
        )}

        {activeTab === 'grounding' && (
          <motion.div
            key="grounding"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.16 }}
            className="matte-panel rounded-2xl p-6 h-full overflow-y-auto max-w-4xl mx-auto"
          >
            <div className="pb-4 mb-4 border-b border-[#232832] space-y-1">
              <h2 className="font-display text-lg font-semibold text-[#eef1f6]">
                Conversation Grounding Vault
              </h2>
              <p className="text-xs text-[#9aa3b2]">
                Enabled documents, media, and URLs are injected directly into Agent 1, Agent 2, and Live Voice across your entire session.
              </p>
            </div>
            <GroundingBar
              expandedView
              resources={resources}
              onAddResource={(res) => setResources((prev) => [...prev, res])}
              onToggleResource={(id) =>
                setResources((prev) =>
                  prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)),
                )
              }
              onRemoveResource={(id) =>
                setResources((prev) => prev.filter((r) => r.id !== id))
              }
            />
          </motion.div>
        )}

        {activeTab === 'mistakes' && (
          <motion.div
            key="mistakes"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.16 }}
            className="h-full max-w-6xl mx-auto"
          >
            <MistakeLogPanel mistakes={sessionMistakes} />
          </motion.div>
        )}
      </main>
    </div>
  );
}
