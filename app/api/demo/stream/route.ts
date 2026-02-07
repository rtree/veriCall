/**
 * SSE endpoint for Demo Live Stream
 *
 * GET /api/demo/stream
 *
 * Sends Server-Sent Events for every pipeline stage:
 *   call:start, stt:transcript, ai:response, ai:decision,
 *   witness:web-proof, witness:zk-proof, witness:on-chain, etc.
 *
 * Used by scripts/demo.ts (CLI viewer).
 */

import { NextRequest } from 'next/server';
import { demoBus, type DemoEvent } from '@/lib/demo/event-bus';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<Response> {
  // ─── Bearer token auth ──────────────────────────────────
  const expected = process.env.VERICALL_DEMO_TOKEN;
  if (expected) {
    const auth = request.headers.get('authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (token !== expected) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  const encoder = new TextEncoder();

  // Track listeners for cleanup
  let onEvent: ((event: DemoEvent) => void) | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial heartbeat
      controller.enqueue(encoder.encode(': connected\n\n'));

      onEvent = (event: DemoEvent) => {
        try {
          const data = JSON.stringify(event);
          controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${data}\n\n`));
        } catch {
          // stream closed — cleanup will happen in cancel()
        }
      };

      // Keep-alive every 15s
      keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          // stream closed
        }
      }, 15_000);

      demoBus.on('demo', onEvent);
    },
    cancel() {
      if (onEvent) demoBus.off('demo', onEvent);
      if (keepAlive) clearInterval(keepAlive);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
