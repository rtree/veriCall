#!/usr/bin/env npx tsx
/**
 * VeriCall Live Demo — Terminal Viewer
 *
 * Connects to the SSE endpoint and renders the full pipeline
 * in real time with colored output and animations.
 *
 * Usage:
 *   npx tsx scripts/demo.ts              # connect to Cloud Run (default)
 *   npx tsx scripts/demo.ts --local      # connect to localhost:3000
 *   npx tsx scripts/demo.ts --token XXX  # override token
 *   Token is read from .env.local (VERICALL_DEMO_TOKEN) automatically.
 *
 * Flow:
 *   1. 🔄 Waiting for call… (spinner animation)
 *   2. 📞 Call connected → conversation log streams in real-time
 *   3. ⚖️  Decision rendered
 *   4. 🔐 WebProof → ZK Proof → ⛓️  On-Chain TX
 *   5. → back to waiting
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// ─── Load .env.local (same as Next.js) ───────────────────────
try {
  const envPath = resolve(__dirname, '..', '.env.local');
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
} catch { /* .env.local not found — ok */ }

// ─── CLI args ─────────────────────────────────────────────────

const args = process.argv.slice(2);
const isLocal = args.includes('--local');
const urlFlag = args.indexOf('--url');
const BASE_URL = urlFlag !== -1 && args[urlFlag + 1]
  ? args[urlFlag + 1]
  : isLocal
    ? 'http://localhost:3000'
    : 'https://vericall-kkz6k4jema-uc.a.run.app';

const tokenFlag = args.indexOf('--token');
const DEMO_TOKEN = tokenFlag !== -1 && args[tokenFlag + 1]
  ? args[tokenFlag + 1]
  : process.env.VERICALL_DEMO_TOKEN || '';

// ─── ANSI helpers ─────────────────────────────────────────────

const ESC = '\x1b';
const RESET  = `${ESC}[0m`;
const BOLD   = `${ESC}[1m`;
const DIM    = `${ESC}[2m`;
const ITALIC = `${ESC}[3m`;

const RED    = `${ESC}[31m`;
const GREEN  = `${ESC}[32m`;
const YELLOW = `${ESC}[33m`;
const BLUE   = `${ESC}[34m`;
const CYAN   = `${ESC}[36m`;
const WHITE  = `${ESC}[37m`;
const GRAY   = `${ESC}[90m`;

const BG_GREEN  = `${ESC}[42m`;
const BG_RED    = `${ESC}[41m`;
const BG_YELLOW = `${ESC}[43m`;
const BG_BLUE   = `${ESC}[44m`;
const BG_CYAN   = `${ESC}[46m`;

const CLEAR_LINE = `${ESC}[2K\r`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;

// ─── Helpers ──────────────────────────────────────────────────

function ts(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

function line(prefix: string, msg: string): void {
  process.stdout.write(`${CLEAR_LINE}  ${GRAY}${ts()}${RESET}  ${prefix}  ${msg}\n`);
}

function separator(label?: string): void {
  const w = process.stdout.columns || 80;
  if (label) {
    const pad = Math.max(0, Math.floor((w - label.length - 4) / 2));
    process.stdout.write(`\n${GRAY}${'─'.repeat(pad)}${RESET} ${BOLD}${label}${RESET} ${GRAY}${'─'.repeat(pad)}${RESET}\n\n`);
  } else {
    process.stdout.write(`${GRAY}${'─'.repeat(w)}${RESET}\n`);
  }
}

function fmtHash(h: string): string {
  return h.length >= 10 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h;
}

// ─── Spinner ──────────────────────────────────────────────────

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
let spinnerInterval: ReturnType<typeof setInterval> | null = null;
let spinnerFrame = 0;

function startSpinner(msg: string): void {
  stopSpinner();
  process.stdout.write(HIDE_CURSOR);
  spinnerInterval = setInterval(() => {
    const frame = SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length];
    process.stdout.write(`${CLEAR_LINE}  ${CYAN}${frame}${RESET}  ${DIM}${msg}${RESET}`);
    spinnerFrame++;
  }, 80);
}

function stopSpinner(): void {
  if (spinnerInterval) {
    clearInterval(spinnerInterval);
    spinnerInterval = null;
    process.stdout.write(`${CLEAR_LINE}${SHOW_CURSOR}`);
  }
}

// ─── Banner ───────────────────────────────────────────────────

function printBanner(): void {
  console.clear();
  const w = process.stdout.columns || 80;
  const border = GRAY + '═'.repeat(w) + RESET;

  console.log(border);
  console.log();
  console.log(`  ${BOLD}${GREEN}⛓️  VeriCall${RESET}  ${DIM}Live Demo — Trust-Minimized AI Call Screening${RESET}`);
  console.log(`  ${DIM}Proving AI fairness on-chain with ZK proofs${RESET}`);
  console.log();
  console.log(`  ${GRAY}Pipeline:  📞 Call → 🤖 AI Screen → ⚖️ Decision → 🔐 WebProof → 🧮 ZK → ⛓️ Base Sepolia${RESET}`);
  console.log(`  ${GRAY}Server:    ${BASE_URL}${RESET}`);
  console.log(`  ${GRAY}SSE:       ${BASE_URL}/api/demo/stream${RESET}`);
  console.log(`  ${GRAY}Auth:      ${DEMO_TOKEN ? `${GREEN}Bearer ●●●${DEMO_TOKEN.slice(-4)}${RESET}` : `${YELLOW}none (local)${RESET}`}${RESET}`);
  console.log();
  console.log(border);
  console.log();
}

// ─── Event Handlers ───────────────────────────────────────────

interface DemoEvent {
  type: string;
  timestamp: string;
  callSid?: string;
  data: Record<string, unknown>;
}

/** Track current call for grouping */
let currentCallSid: string | null = null;
let turnCount = 0;

function handleEvent(event: DemoEvent): void {
  const { type, data, callSid } = event;

  switch (type) {
    // ─── Call Lifecycle ─────────────────────────
    case 'call:start': {
      stopSpinner();
      currentCallSid = callSid ?? null;
      turnCount = 0;
      separator('📞 INCOMING CALL');
      line(
        `${BG_BLUE}${WHITE}${BOLD} CALL ${RESET}`,
        `${BOLD}Call connected${RESET}  ${DIM}from ${data.from || 'unknown'}${RESET}  ${GRAY}sid:${fmtHash(String(callSid ?? ''))}${RESET}`,
      );
      console.log();
      break;
    }

    case 'call:greeting': {
      line(
        `${GREEN}🤖 AI${RESET}  `,
        `${ITALIC}"${data.text}"${RESET}`,
      );
      console.log();
      break;
    }

    // ─── Conversation ───────────────────────────
    case 'stt:transcript': {
      turnCount++;
      line(
        `${YELLOW}📞 Caller${RESET}`,
        `${ITALIC}"${data.text}"${RESET}`,
      );
      break;
    }

    case 'ai:response': {
      line(
        `${GREEN}🤖 AI${RESET}   `,
        `${ITALIC}"${data.text}"${RESET}`,
      );
      if (data.decision) {
        console.log();
      }
      break;
    }

    // ─── Decision ───────────────────────────────
    case 'ai:decision': {
      const decision = String(data.decision).toUpperCase();
      const isBlock = decision === 'BLOCK';
      const badge = isBlock
        ? `${BG_RED}${WHITE}${BOLD} 🚫 ${decision} ${RESET}`
        : `${BG_GREEN}${WHITE}${BOLD} ✅ ${decision} ${RESET}`;

      separator('⚖️  DECISION');
      line(badge, `${DIM}after ${turnCount} turns${RESET}`);
      if (data.reason) {
        line(`     `, `${DIM}${data.reason}${RESET}`);
      }
      console.log();
      break;
    }

    // ─── Email ──────────────────────────────────
    case 'email:sent': {
      line(
        `${BLUE}📧${RESET}     `,
        `Email notification sent ${DIM}(${data.decision})${RESET}`,
      );
      break;
    }

    // ─── Witness Pipeline ───────────────────────
    case 'witness:start': {
      separator('🔐 PROOF PIPELINE');
      line(
        `${CYAN}⛓️${RESET}      `,
        `Witness pipeline started  ${DIM}${fmtHash(String(data.witnessId ?? ''))}${RESET}`,
      );
      break;
    }

    case 'witness:web-proof': {
      line(
        `${CYAN}🌐${RESET}     `,
        `${GREEN}✓${RESET} Web Proof generated  ${DIM}(${data.proofSize} chars, TLSNotary MPC)${RESET}`,
      );
      if (data.sourceUrl) {
        line(
          `       `,
          `${GRAY}source: ${data.sourceUrl}${RESET}`,
        );
      }
      break;
    }

    case 'witness:zk-proof': {
      line(
        `${CYAN}🧮${RESET}     `,
        `${GREEN}✓${RESET} ZK Proof compressed  ${DIM}(RISC Zero → Groth16 BN254, seal: ${data.sealHash})${RESET}`,
      );
      break;
    }

    case 'witness:on-chain': {
      line(
        `${CYAN}⛓️${RESET}      `,
        `${GREEN}${BOLD}✓ ON-CHAIN!${RESET}  TX: ${GREEN}${fmtHash(String(data.txHash ?? ''))}${RESET}  block: ${data.blockNumber}`,
      );
      line(
        `       `,
        `${DIM}https://sepolia.basescan.org/tx/${data.txHash}${RESET}`,
      );
      console.log();
      separator('✅ COMPLETE');
      line(
        `${GREEN}${BOLD}✓${RESET}      `,
        `Call verified and recorded on Base Sepolia`,
      );
      console.log();
      currentCallSid = null;
      startSpinner('Waiting for next call… (make a call to the Twilio number)');
      break;
    }

    case 'witness:failed': {
      line(
        `${RED}❌${RESET}     `,
        `${RED}Witness pipeline failed: ${data.error}${RESET}`,
      );
      console.log();
      currentCallSid = null;
      startSpinner('Waiting for next call…');
      break;
    }

    // ─── Call End ───────────────────────────────
    case 'call:end': {
      if (!data.decision) {
        // Call ended without decision (hangup)
        line(
          `${GRAY}📞${RESET}     `,
          `${DIM}Call ended without decision (caller hung up)${RESET}`,
        );
        console.log();
        currentCallSid = null;
        startSpinner('Waiting for next call…');
      }
      // If decision was made, witness pipeline will trigger the "back to waiting" state
      break;
    }

    default:
      line(`${GRAY}?${RESET}      `, `${GRAY}Unknown event: ${type}${RESET}`);
  }
}

// ─── SSE Connection ───────────────────────────────────────────

async function connect(): Promise<void> {
  const sseUrl = `${BASE_URL}/api/demo/stream`;

  line(`${CYAN}🔗${RESET}     `, `Connecting to ${sseUrl}…`);
  console.log();

  try {
    const headers: Record<string, string> = { Accept: 'text/event-stream' };
    if (DEMO_TOKEN) {
      headers['Authorization'] = `Bearer ${DEMO_TOKEN}`;
    }
    const res = await fetch(sseUrl, { headers });

    if (!res.ok || !res.body) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    line(`${GREEN}✓${RESET}      `, `Connected! Streaming events…`);
    console.log();
    startSpinner('Waiting for call… (make a call to the Twilio number)');

    // Parse SSE stream
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE messages
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // keep incomplete line

      let eventType = '';
      let eventData = '';

      for (const raw of lines) {
        const l = raw.trim();
        if (l.startsWith('event: ')) {
          eventType = l.slice(7);
        } else if (l.startsWith('data: ')) {
          eventData = l.slice(6);
        } else if (l === '' && eventData) {
          // End of SSE message
          try {
            const event: DemoEvent = JSON.parse(eventData);
            handleEvent(event);
          } catch {
            // ignore parse errors (comments, pings)
          }
          eventType = '';
          eventData = '';
        }
        // Ignore comments like ": connected" and ": ping"
      }
    }

    // Stream ended
    stopSpinner();
    line(`${YELLOW}⚠${RESET}      `, `Stream ended. Reconnecting in 3s…`);
    setTimeout(() => connect(), 3000);
  } catch (err) {
    stopSpinner();
    const msg = err instanceof Error ? err.message : String(err);
    line(`${RED}✗${RESET}      `, `${RED}Connection failed: ${msg}${RESET}`);
    line(`       `, `${DIM}Is the server running? Try: pnpm dev${RESET}`);
    line(`       `, `${DIM}Retrying in 5s…${RESET}`);
    setTimeout(() => connect(), 5000);
  }
}

// ─── Main ─────────────────────────────────────────────────────

// Cleanup on exit
process.on('SIGINT', () => {
  stopSpinner();
  console.log(`\n\n  ${DIM}👋 Demo ended${RESET}\n`);
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopSpinner();
  process.exit(0);
});

printBanner();
connect();
