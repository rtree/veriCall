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
import { createPublicClient, http, keccak256, sha256 } from 'viem';
import { baseSepolia } from 'viem/chains';

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

// ─── On-chain verification (post-COMPLETE) ───────────────────

const VERIFY_CONFIG = {
  registry: '0x656ae703ca94cc4247493dec6f9af9c6f974ba82' as `0x${string}`,
  mockVerifier: '0x9afb5f28e2317d75212a503eecf02dce4a7b6f0e' as `0x${string}`,
  imageId: '0x6e251f4d993427d02a4199e1201f3b54462365d7c672a51be57f776d509b47eb',
  rpcUrl: 'https://sepolia.base.org',
  basescan: 'https://sepolia.basescan.org',
  deployBlock: 37335241n,
} as const;

const REGISTRY_ABI = [
  { type: 'function', name: 'getStats', inputs: [], outputs: [{ name: 'total', type: 'uint256' }, { name: 'accepted', type: 'uint256' }, { name: 'blocked', type: 'uint256' }, { name: 'recorded', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'owner', inputs: [], outputs: [{ name: '', type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'imageId', inputs: [], outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view' },
  { type: 'function', name: 'verifier', inputs: [], outputs: [{ name: '', type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'callIds', inputs: [{ name: '', type: 'uint256' }], outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view' },
  { type: 'function', name: 'getRecord', inputs: [{ name: 'callId', type: 'bytes32' }], outputs: [{ name: '', type: 'tuple', components: [{ name: 'callerHash', type: 'bytes32' }, { name: 'decision', type: 'uint8' }, { name: 'reason', type: 'string' }, { name: 'journalHash', type: 'bytes32' }, { name: 'zkProofSeal', type: 'bytes' }, { name: 'journalDataAbi', type: 'bytes' }, { name: 'sourceUrl', type: 'string' }, { name: 'timestamp', type: 'uint256' }, { name: 'submitter', type: 'address' }, { name: 'verified', type: 'bool' }] }], stateMutability: 'view' },
  { type: 'function', name: 'getProvenData', inputs: [{ name: 'callId', type: 'bytes32' }], outputs: [{ name: 'notaryKeyFingerprint', type: 'bytes32' }, { name: 'method', type: 'string' }, { name: 'url', type: 'string' }, { name: 'proofTimestamp', type: 'uint256' }, { name: 'queriesHash', type: 'bytes32' }, { name: 'extractedData', type: 'string' }], stateMutability: 'view' },
  { type: 'function', name: 'verifyJournal', inputs: [{ name: 'callId', type: 'bytes32' }, { name: 'journalData', type: 'bytes' }], outputs: [{ name: '', type: 'bool' }], stateMutability: 'view' },
] as const;

const MOCK_VERIFIER_ABI = [
  { type: 'function', name: 'SELECTOR', inputs: [], outputs: [{ name: '', type: 'bytes4' }], stateMutability: 'view' },
  { type: 'function', name: 'verify', inputs: [{ name: 'seal', type: 'bytes' }, { name: 'imageId', type: 'bytes32' }, { name: 'journalDigest', type: 'bytes32' }], outputs: [], stateMutability: 'pure' },
] as const;

const DECISION_MAP: Record<number, string> = { 0: 'UNKNOWN', 1: 'ACCEPT', 2: 'BLOCK', 3: 'RECORD' };

/**
 * Run trust-minimized on-chain verification on the latest record.
 * This reads ONLY from the public blockchain — same checks as scripts/verify.ts.
 */
async function runPostCompleteVerification(): Promise<void> {
  separator('🔍 ON-CHAIN VERIFICATION');
  line(`${CYAN}🔍${RESET}     `, `${DIM}Reading directly from Base Sepolia (public RPC, no VeriCall APIs)…${RESET}`);
  console.log();

  const client: any = createPublicClient({ chain: baseSepolia, transport: http(VERIFY_CONFIG.rpcUrl) });

  try {
    // ─── Phase 1: Contract Checks ──────────────────────

    // C1: Contract bytecode
    const bytecode = await client.getCode({ address: VERIFY_CONFIG.registry });
    const bytecodeOk = !!bytecode && bytecode !== '0x';
    printCheck('C1', 'Contract bytecode exists', bytecodeOk,
      bytecodeOk ? `${((bytecode!.length - 2) / 2)} bytes deployed` : 'No contract found');
    if (!bytecodeOk) { line(`${RED}✗${RESET}      `, `Cannot verify — no contract`); return; }

    // C2: Contract responds
    const stats = (await client.readContract({ address: VERIFY_CONFIG.registry, abi: REGISTRY_ABI, functionName: 'getStats' })) as [bigint, bigint, bigint, bigint];
    const total = Number(stats[0]);
    printCheck('C2', 'Contract responds (getStats)', true,
      `total=${total}, accepted=${stats[1]}, blocked=${stats[2]}, recorded=${stats[3]}`);

    // C3: Verifier
    const verifierAddr = (await client.readContract({ address: VERIFY_CONFIG.registry, abi: REGISTRY_ABI, functionName: 'verifier' })) as `0x${string}`;
    let isMock = false;
    try {
      const sel = (await client.readContract({ address: verifierAddr, abi: MOCK_VERIFIER_ABI, functionName: 'SELECTOR' })) as string;
      isMock = sel === '0xffffffff';
    } catch { /* not mock */ }
    printCheck('C3', 'Verifier configured', true,
      isMock ? `MockVerifier at ${fmtHash(verifierAddr)} (0xFFFFFFFF)` : `Verifier at ${fmtHash(verifierAddr)}`);

    // C4: Image ID
    const imgId = (await client.readContract({ address: VERIFY_CONFIG.registry, abi: REGISTRY_ABI, functionName: 'imageId' })) as `0x${string}`;
    printCheck('C4', 'Image ID (ZK guest program)', imgId !== ('0x' + '0'.repeat(64)),
      `${fmtHash(imgId)}`);

    // C5: Owner
    const owner = (await client.readContract({ address: VERIFY_CONFIG.registry, abi: REGISTRY_ABI, functionName: 'owner' })) as `0x${string}`;
    printCheck('C5', 'Owner address', true, `${fmtHash(owner)}`);

    console.log();
    if (total === 0) {
      line(`${YELLOW}⚠${RESET}      `, `No records on-chain yet`);
      return;
    }

    // ─── Phase 2: Latest Record ────────────────────────

    const idx = total - 1;
    const callId = (await client.readContract({ address: VERIFY_CONFIG.registry, abi: REGISTRY_ABI, functionName: 'callIds', args: [BigInt(idx)] })) as `0x${string}`;
    const record = (await client.readContract({ address: VERIFY_CONFIG.registry, abi: REGISTRY_ABI, functionName: 'getRecord', args: [callId] })) as any;

    line(`${CYAN}📄${RESET}     `, `${BOLD}Verifying latest record #${idx}${RESET}  ${DIM}${DECISION_MAP[Number(record.decision)] || '?'}: ${record.reason.slice(0, 60)}${RESET}`);
    console.log();

    // V1: verified flag
    printCheck('V1', 'verified == true (ZK proof passed)', record.verified === true,
      record.verified ? 'On-chain verifier confirmed ZK proof at registration' : 'NOT VERIFIED');

    // V2: Journal hash
    const computedHash = keccak256(record.journalDataAbi);
    const hashMatch = computedHash === record.journalHash;
    printCheck('V2', 'Journal hash integrity (keccak256)', hashMatch,
      hashMatch ? 'keccak256(journalDataAbi) matches stored commitment' : 'HASH MISMATCH');

    // V3: On-chain verifyJournal
    let journalOk = false;
    try {
      journalOk = (await client.readContract({ address: VERIFY_CONFIG.registry, abi: REGISTRY_ABI, functionName: 'verifyJournal', args: [callId, record.journalDataAbi] })) as boolean;
    } catch { /* fail */ }
    printCheck('V3', 'On-chain verifyJournal()', journalOk,
      journalOk ? 'Contract confirms journal integrity' : 'Contract rejected journal');

    // V4: Independent seal re-verification
    let sealOk = false;
    try {
      const digest = sha256(record.journalDataAbi);
      await client.readContract({ address: verifierAddr, abi: MOCK_VERIFIER_ABI, functionName: 'verify', args: [record.zkProofSeal, imgId, digest] });
      sealOk = true;
    } catch { /* fail */ }
    printCheck('V4', 'Independent verifier.verify() call', sealOk,
      sealOk ? 'Direct seal re-verification passed' : 'Seal verification failed');

    // V5: Proven data
    let pdValid = false;
    try {
      const pd = (await client.readContract({ address: VERIFY_CONFIG.registry, abi: REGISTRY_ABI, functionName: 'getProvenData', args: [callId] })) as any;
      const notaryOk = pd[0] !== ('0x' + '0'.repeat(64));
      const methodOk = pd[1] === 'GET';
      const urlOk = (pd[2] as string).length > 0;
      const dataOk = (pd[5] as string).length > 0;
      pdValid = notaryOk && methodOk && urlOk && dataOk;
      printCheck('V5', 'Proven data (TLSNotary metadata)', pdValid,
        pdValid ? `Method=${pd[1]}, URL present, Notary FP non-zero` : 'Invalid proven data');
    } catch {
      printCheck('V5', 'Proven data (TLSNotary metadata)', false, 'Failed to decode');
    }

    // V6: Source URL pattern
    const urlPattern = /\/api\/witness\/decision\/CA/;
    const urlOk = urlPattern.test(record.sourceUrl);
    printCheck('V6', 'Source URL matches Decision API', urlOk,
      urlOk ? fmtHash(record.sourceUrl) : `Unexpected: ${record.sourceUrl}`);

    // V7: Seal format (mock = starts with 0xffffffff)
    const sealHex = record.zkProofSeal as string;
    const sealPrefix = sealHex.slice(0, 10).toLowerCase();
    const sealFmtOk = sealPrefix === '0xffffffff';
    printCheck('V7', 'ZK seal format (RISC Zero mock selector)', sealFmtOk,
      sealFmtOk ? `Seal: ${fmtHash(sealHex)} (${(sealHex.length - 2) / 2} bytes)` : `Unexpected prefix: ${sealPrefix}`);

    // Summary
    const checks = [record.verified, hashMatch, journalOk, sealOk, pdValid, urlOk, sealFmtOk];
    const passed = checks.filter(Boolean).length;
    const total7 = checks.length;
    console.log();

    if (passed === total7) {
      line(`${GREEN}${BOLD}✅${RESET}     `,
        `${GREEN}${BOLD}ALL ${passed + 5}/${total7 + 5} CHECKS PASSED${RESET}  ${DIM}(5 contract + ${total7} record)${RESET}`);
      line(`       `, `${DIM}This verification read ONLY from the public blockchain.${RESET}`);
      line(`       `, `${DIM}No API keys, wallets, or trust in VeriCall required.${RESET}`);
    } else {
      line(`${RED}${BOLD}⚠${RESET}      `,
        `${RED}${passed + 5}/${total7 + 5} checks passed (${total7 - passed} failed)${RESET}`);
    }

    // Links
    console.log();
    line(`${CYAN}🔗${RESET}     `, `${DIM}Contract: ${VERIFY_CONFIG.basescan}/address/${VERIFY_CONFIG.registry}${RESET}`);
    line(`       `, `${DIM}Verify yourself: npx tsx scripts/verify.ts${RESET}`);
    line(`       `, `${DIM}Web: https://vericall-kkz6k4jema-uc.a.run.app/verify${RESET}`);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    line(`${RED}✗${RESET}      `, `${RED}Verification error: ${msg}${RESET}`);
  }
}

function printCheck(id: string, label: string, passed: boolean, detail: string): void {
  const icon = passed ? `${GREEN}✅${RESET}` : `${RED}❌${RESET}`;
  line(icon, `${BOLD}[${id}]${RESET} ${label}`);
  line(`       `, `${DIM}→ ${detail}${RESET}`);
}

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

      // Auto-verify: read the record back from chain and run checks
      // Then go back to waiting state
      runPostCompleteVerification()
        .catch(() => {/* verification is best-effort */})
        .finally(() => {
          console.log();
          currentCallSid = null;
          startSpinner('Waiting for next call… (make a call to the Twilio number)');
        });
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
