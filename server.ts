/**
 * Custom server with WebSocket support for Voice AI
 * This extends Next.js standalone server to add WebSocket handling
 */

import { createServer, IncomingMessage } from 'http';
import { parse } from 'url';
import next from 'next';
import { WebSocketServer, WebSocket } from 'ws';
import { createSession, removeSession, getSession } from './lib/voice-ai/session';

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

interface TwilioStartMessage {
  event: 'start';
  start: {
    streamSid: string;
    callSid: string;
    customParameters?: Record<string, string>;
  };
}

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url || '', true);
    handle(req, res, parsedUrl);
  });

  // WebSocket server for voice streaming
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request: IncomingMessage, socket, head) => {
    const { pathname } = parse(request.url || '', true);

    if (pathname === '/stream') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
    console.log('[WebSocket] New connection');

    let callSid: string | null = null;

    ws.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());

        // Debug: Log all events
        if (message.event !== 'media') {
          console.log(`[WebSocket] Event: ${message.event}`);
        }

        // Handle start event to get call info
        if (message.event === 'start') {
          const startMsg = message as TwilioStartMessage;
          callSid = startMsg.start.callSid;
          const from = startMsg.start.customParameters?.From || 'Unknown';

          console.log(`[WebSocket] Call started: ${callSid} from ${from}`);

          const session = createSession(ws, {
            callSid,
            from,
            streamSid: startMsg.start.streamSid,
          });

          // Forward message to session
          await session.handleMessage(data.toString());
        } else if (callSid) {
          // Forward all other messages to the session
          const session = getSession(callSid);
          if (session) {
            await session.handleMessage(data.toString());
          } else {
            console.log(`[WebSocket] No session for callSid: ${callSid}`);
          }
        } else {
          console.log(`[WebSocket] No callSid set for event: ${message.event}`);
        }
      } catch (error) {
        console.error('[WebSocket] Error processing message:', error);
      }
    });

    ws.on('close', () => {
      console.log(`[WebSocket] Connection closed: ${callSid}`);
      if (callSid) {
        removeSession(callSid);
      }
    });

    ws.on('error', (error) => {
      console.error(`[WebSocket] Error: ${error.message}`);
    });
  });

  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log(`> WebSocket ready on ws://${hostname}:${port}/stream`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('🛑 Shutting down...');
    try {
      const { closeDb } = await import('@/lib/db');
      await closeDb();
      console.log('🗄️ DB pool closed');
    } catch { /* ignore if db not initialized */ }
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
});
