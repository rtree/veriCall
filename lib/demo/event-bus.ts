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

class DemoEventBus extends EventEmitter {
  private static instance: DemoEventBus;

  private constructor() {
    super();
    this.setMaxListeners(50); // SSE clients
  }

  static getInstance(): DemoEventBus {
    if (!DemoEventBus.instance) {
      DemoEventBus.instance = new DemoEventBus();
    }
    return DemoEventBus.instance;
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

/** Global event bus — import this everywhere */
export const demoBus = DemoEventBus.getInstance();
