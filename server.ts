import http from 'node:http';
import { parse } from 'node:url';
import next from 'next';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  Behavior,
  FunctionResponseScheduling,
  Modality,
  ThinkingLevel,
  Type,
  type FunctionDeclaration,
  type LiveServerMessage,
} from '@google/genai';
import { getLiveGenAIClient } from './lib/gemini-fallback.ts';
import { runTriAgentPipeline } from './lib/tri-agent-engine.ts';
import type { GroundingResource } from './lib/types.ts';

const dev = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname: '0.0.0.0', port });
const handle = app.getRequestHandler();

function buildVerifyQueryTool(nonBlocking: boolean): FunctionDeclaration {
  return {
    name: 'verify_query_with_agents',
    description:
      'Runs the mandatory 3-agent non-hallucinating verification pipeline (Decomposition -> Internet Search + Reasoning -> Cross-Reference -> Compatibility Audit) for any user query. MUST be called before answering factual, analytical, or grounded document/URL queries.',
    ...(nonBlocking ? { behavior: Behavior.NON_BLOCKING } : {}),
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'The exact user question or task to verify across all 3 agents.',
        },
      },
      required: ['query'],
    },
  };
}

function formatLiveError(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message || err.name;
  if (err && typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    if (obj.error) {
      const nested = formatLiveError(obj.error);
      if (nested && nested !== '[object Object]') return nested;
    }
    if (typeof obj.message === 'string' && obj.message.trim()) {
      return obj.message;
    }
    if (typeof obj.reason === 'string' && obj.reason.trim()) {
      return typeof obj.code === 'number'
        ? `WebSocket closed (code ${obj.code}): ${obj.reason}`
        : obj.reason;
    }
    if (typeof obj.code === 'number') {
      return `WebSocket closed with code ${obj.code}`;
    }
    try {
      const json = JSON.stringify(obj);
      if (json && json !== '{}') return json;
    } catch {
      // Ignore JSON circular errors
    }
  }
  return 'Live voice connection encountered an upstream error.';
}

function sendJson(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

async function attachLiveSession(clientWs: WebSocket): Promise<void> {
  let resources: GroundingResource[] = [];
  let history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  let liveSession: Awaited<ReturnType<ReturnType<typeof getLiveGenAIClient>['live']['connect']>> | null = null;
  let closed = false;
  let activeLiveModel = 'gemini-3.8-live-extended-thinking';

  const buildSystemInstruction = () => {
    const activeResNames = resources
      .filter((r) => r.enabled)
      .map((r) => `${r.name} (${r.kind})`)
      .join(', ');
    return [
      'You are Aegis Terminal Live Voice, a zero-hallucination voice interface backed by a 3-agent verification engine.',
      'For ANY factual question, research request, current-events query, document question, or multi-step problem, you MUST immediately call the tool `verify_query_with_agents` with the user query and wait for its verified result before stating facts.',
      'While `verify_query_with_agents` runs, give only a brief 1-sentence acknowledgement that verification has started—never speculate or invent facts before the tool responds.',
      'Once `verify_query_with_agents` returns `verifiedAnswer`, speak clearly and concisely strictly based on `verifiedAnswer` and mention any `bottlenecks` if present.',
      `Active conversation grounding resources: ${activeResNames || 'None attached'}.`,
    ].join(' ');
  };

  const connectWithModel = async (useExtendedThinking: boolean) => {
    const ai = getLiveGenAIClient();
    const model = useExtendedThinking
      ? 'gemini-3.8-live-extended-thinking'
      : 'gemini-3.8-live';
    activeLiveModel = model;
    let sessionEstablished = false;
    let handshakeErrorDetail: string | null = null;

    const config: Record<string, unknown> = {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Fenrir' } },
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      tools: [{ functionDeclarations: [buildVerifyQueryTool(useExtendedThinking)] }],
      systemInstruction: buildSystemInstruction(),
    };

    if (useExtendedThinking) {
      config.thinkingConfig = {
        thinkingLevel: ThinkingLevel.HIGH,
      };
    }

    try {
      const session = await ai.live.connect({
        model,
        config,
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            if (closed) return;
            const content = message.serverContent;

            if (content?.inputTranscription?.text) {
              sendJson(clientWs, {
                type: 'input_transcript',
                text: content.inputTranscription.text,
              });
            }

            if (content?.outputTranscription?.text) {
              sendJson(clientWs, {
                type: 'output_transcript',
                text: content.outputTranscription.text,
              });
            }

            for (const part of content?.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                sendJson(clientWs, {
                  type: 'audio',
                  data: part.inlineData.data,
                });
              }
            }

            if (content?.interrupted) {
              sendJson(clientWs, { type: 'interrupted' });
            }

            if (content?.turnComplete) {
              sendJson(clientWs, { type: 'turn_complete' });
            }

            if (content?.interactionStatus) {
              sendJson(clientWs, {
                type: 'interaction_status',
                status: content.interactionStatus,
              });
            }

            for (const call of message.toolCall?.functionCalls ?? []) {
              if (call.name === 'verify_query_with_agents') {
                const args = (call.args ?? {}) as { query?: string };
                const q = (args.query ?? '').trim();
                const runId = `voice-${Date.now()}`;

                void (async () => {
                  try {
                    const result = await runTriAgentPipeline({
                      runId,
                      query: q,
                      sourceMode: 'voice',
                      history,
                      resources,
                      emit: (event) => {
                        sendJson(clientWs, { type: 'pipeline_event', event });
                      },
                    });

                    history.push({ role: 'user', content: q });
                    history.push({ role: 'assistant', content: result.finalAnswer });

                    sendJson(clientWs, {
                      type: 'verified_voice_result',
                      runId,
                      query: q,
                      finalAnswer: result.finalAnswer,
                      citations: result.citations,
                      bottlenecks: result.bottlenecks,
                      steps: result.steps,
                      mistakes: result.mistakes,
                      modelTier: result.activeModelTier,
                    });

                    liveSession?.sendToolResponse({
                      functionResponses: [
                        {
                          id: call.id,
                          name: call.name,
                          response: {
                            verifiedAnswer: result.finalAnswer,
                            citationsCount: result.citations.length,
                            bottlenecks: result.bottlenecks,
                          },
                          ...(useExtendedThinking
                            ? { scheduling: FunctionResponseScheduling.WHEN_IDLE }
                            : {}),
                        },
                      ],
                    });
                  } catch (err) {
                    const errMsg = formatLiveError(err);
                    sendJson(clientWs, {
                      type: 'pipeline_event',
                      event: {
                        type: 'run_error',
                        runId,
                        message: errMsg,
                      },
                    });
                    liveSession?.sendToolResponse({
                      functionResponses: [
                        {
                          id: call.id,
                          name: call.name,
                          response: { error: errMsg },
                          ...(useExtendedThinking
                            ? { scheduling: FunctionResponseScheduling.WHEN_IDLE }
                            : {}),
                        },
                      ],
                    });
                  }
                })();
              }
            }
          },
          onerror: (err: unknown) => {
            const msg = formatLiveError(err);
            if (!sessionEstablished) {
              handshakeErrorDetail = msg;
              return;
            }
            if (!closed) {
              sendJson(clientWs, { type: 'live_error', message: msg });
            }
          },
          onclose: (event: unknown) => {
            const msg = formatLiveError(event);
            if (!sessionEstablished) {
              if (!handshakeErrorDetail) handshakeErrorDetail = msg;
              return;
            }
            if (!closed) {
              sendJson(clientWs, { type: 'live_closed', reason: msg });
            }
          },
        },
      });

      sessionEstablished = true;
      sendJson(clientWs, {
        type: 'live_ready',
        model: activeLiveModel,
      });
      return session;
    } catch (err) {
      const msg = handshakeErrorDetail || formatLiveError(err);
      throw new Error(`${model}: ${msg}`);
    }
  };

  clientWs.on('message', async (rawData) => {
    try {
      const msg = JSON.parse(rawData.toString()) as {
        type: string;
        data?: string;
        text?: string;
        resources?: GroundingResource[];
        history?: Array<{ role: 'user' | 'assistant'; content: string }>;
      };

      if (msg.type === 'init') {
        resources = Array.isArray(msg.resources) ? msg.resources : [];
        history = Array.isArray(msg.history) ? msg.history : [];

        try {
          liveSession = await connectWithModel(true);
        } catch (err) {
          const reason = formatLiveError(err);
          sendJson(clientWs, {
            type: 'live_fallback',
            from: 'gemini-3.8-live-extended-thinking',
            to: 'gemini-3.8-live',
            reason,
          });
          try {
            liveSession = await connectWithModel(false);
          } catch (fallbackErr) {
            const fallbackReason = formatLiveError(fallbackErr);
            sendJson(clientWs, {
              type: 'live_error',
              message: `Live Voice failed to start (${reason} | ${fallbackReason})`,
            });
          }
        }
        return;
      }

      if (msg.type === 'sync_context') {
        if (Array.isArray(msg.resources)) resources = msg.resources;
        if (Array.isArray(msg.history)) history = msg.history;
        return;
      }

      if (msg.type === 'audio' && msg.data && liveSession) {
        liveSession.sendRealtimeInput({
          audio: { data: msg.data, mimeType: 'audio/pcm;rate=16000' },
        });
        return;
      }

      if (msg.type === 'text' && msg.text && liveSession) {
        liveSession.sendRealtimeInput({ text: msg.text });
      }
    } catch (err) {
      const errMsg = formatLiveError(err);
      sendJson(clientWs, { type: 'live_error', message: errMsg });
    }
  });

  clientWs.on('close', () => {
    closed = true;
    try {
      liveSession?.close();
    } catch {
      // Ignore cleanup errors
    }
  });
}

async function main() {
  await app.prepare();

  const server = http.createServer((req, res) => {
    const parsedUrl = parse(req.url ?? '/', true);
    void handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ noServer: true });
  const nextUpgradeHandler = app.getUpgradeHandler();

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = parse(req.url ?? '/', true);
    if (pathname === '/ws/live') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        void attachLiveSession(ws);
      });
    } else {
      void nextUpgradeHandler(req, socket, head);
    }
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`Aegis Terminal server listening on http://0.0.0.0:${port}`);
  });
}

void main();
