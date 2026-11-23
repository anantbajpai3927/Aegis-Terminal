import { NextRequest } from 'next/server';
import { runTriAgentPipeline } from '@/lib/tri-agent-engine';
import type { GroundingResource, PipelineEvent } from '@/lib/types';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    runId?: string;
    query?: string;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    resources?: GroundingResource[];
  };

  const query = (body.query ?? '').trim();
  if (!query) {
    return new Response(JSON.stringify({ error: 'Query cannot be empty.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const runId = body.runId || `run-${Date.now()}`;
  const history = Array.isArray(body.history) ? body.history : [];
  const resources = Array.isArray(body.resources) ? body.resources : [];

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: PipelineEvent) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          // Stream already closed by client
        }
      };

      try {
        await runTriAgentPipeline({
          runId,
          query,
          sourceMode: 'text',
          history,
          resources,
          emit: sendEvent,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Verification pipeline encountered an error.';
        sendEvent({
          type: 'run_error',
          runId,
          message,
        });
      } finally {
        try {
          controller.close();
        } catch {
          // Ignore close error
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
