/**
 * Global Event Bus for Demo Live Streaming
 *
 * All pipeline stages emit structured events here.
 * The SSE endpoint (/api/demo/stream) consumes them
 * and forwards to the CLI viewer (scripts/demo.ts).
 */

import { EventEmitter } from 'events';

// ─── Event Types ──────────────────────────────────────────────

export type DemoEventType =
  // Call lifecycle
  | 'call:start'
  | 'call:greeting'
  | 'call:end'
  // Conversation
  | 'stt:transcript'
  | 'ai:response'
  | 'ai:decision'
  // Post-call
  | 'email:sent'
  // Witness pipeline
  | 'witness:start'
  | 'witness:web-proof'
  | 'witness:zk-proof'
  | 'witness:on-chain'
  | 'witness:failed';

export interface DemoEvent {
  type: DemoEventType;
  timestamp: string;
  callSid?: string;
  data: Record<string, unknown>;
}

// ─── Singleton ────────────────────────────────────────────────

// Use globalThis to ensure a SINGLE instance across Next.js module boundaries
// (custom server vs API routes may load separate module instances)
const GLOBAL_KEY = '__vericall_demo_bus__' as const;

class DemoEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50); // SSE clients
  }

  /** Emit a structured demo event */
  emitDemo(type: DemoEventType, callSid: string, data: Record<string, unknown> = {}): void {
    const event: DemoEvent = {
      type,
      timestamp: new Date().toISOString(),
      callSid,
      data,
    };
    this.emit('demo', event);
  }
}

function getGlobalBus(): DemoEventBus {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new DemoEventBus();
  }
  return g[GLOBAL_KEY] as DemoEventBus;
}

/** Global event bus — import this everywhere */
export const demoBus = getGlobalBus();
