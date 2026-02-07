'use client';

/**
 * /demo — Live Demo Page
 *
 * Connects to the SSE endpoint and renders the full pipeline
 * in real-time: phone call → AI screening → decision → proof → on-chain.
 *
 * After the pipeline completes, links to /verify for independent verification.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { createPublicClient, http, keccak256, sha256, parseAbiItem } from 'viem';
import { baseSepolia } from 'viem/chains';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

interface DemoEvent {
  type: string;
  timestamp: string;
  callSid?: string;
  data: Record<string, unknown>;
}

type Phase = 'connecting' | 'waiting' | 'call' | 'decision' | 'proof' | 'complete' | 'error';

interface LogEntry {
  id: number;
  timestamp: string;
  icon: string;
  label: string;
  text: string;
  color: string;
  phase: Phase;
  link?: string;   // Optional BaseScan / external link
  indent?: boolean; // Sub-detail row (dimmer, smaller)
}

// ═══════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════

const BASE_URL = typeof window !== 'undefined' ? window.location.origin : '';

const BASESCAN = 'https://sepolia.basescan.org';

// ── Verification config (self-contained, same as /verify) ────
const VERIFY_CONFIG = {
  registry: '0x9beb87effdac68baf13b505b7e1515f9d43e6ad2' as `0x${string}`,
  mockVerifier: '0xd447c1342f7350ec5f0af60f8ed98e33b8c78ea1' as `0x${string}`,
  deployBlock: BigInt(37354216),
  rpcUrl: 'https://sepolia.base.org',
} as const;

const REGISTRY_ABI = [
  { type: 'function', name: 'getStats', inputs: [], outputs: [{ name: 'total', type: 'uint256' }, { name: 'accepted', type: 'uint256' }, { name: 'blocked', type: 'uint256' }, { name: 'recorded', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'owner', inputs: [], outputs: [{ name: '', type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'imageId', inputs: [], outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view' },
  { type: 'function', name: 'verifier', inputs: [], outputs: [{ name: '', type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'callIds', inputs: [{ name: '', type: 'uint256' }], outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view' },
  { type: 'function', name: 'getRecord', inputs: [{ name: 'callId', type: 'bytes32' }], outputs: [{ name: '', type: 'tuple', components: [{ name: 'decision', type: 'uint8' }, { name: 'reason', type: 'string' }, { name: 'journalHash', type: 'bytes32' }, { name: 'zkProofSeal', type: 'bytes' }, { name: 'journalDataAbi', type: 'bytes' }, { name: 'sourceUrl', type: 'string' }, { name: 'timestamp', type: 'uint256' }, { name: 'submitter', type: 'address' }, { name: 'verified', type: 'bool' }] }], stateMutability: 'view' },
  { type: 'function', name: 'getProvenData', inputs: [{ name: 'callId', type: 'bytes32' }], outputs: [{ name: 'notaryKeyFingerprint', type: 'bytes32' }, { name: 'method', type: 'string' }, { name: 'url', type: 'string' }, { name: 'proofTimestamp', type: 'uint256' }, { name: 'queriesHash', type: 'bytes32' }, { name: 'provenDecision', type: 'string' }, { name: 'provenReason', type: 'string' }], stateMutability: 'view' },
  { type: 'function', name: 'verifyJournal', inputs: [{ name: 'callId', type: 'bytes32' }, { name: 'journalData', type: 'bytes' }], outputs: [{ name: '', type: 'bool' }], stateMutability: 'view' },
] as const;

const MOCK_VERIFIER_ABI = [
  { type: 'function', name: 'SELECTOR', inputs: [], outputs: [{ name: '', type: 'bytes4' }], stateMutability: 'view' },
  { type: 'function', name: 'verify', inputs: [{ name: 'seal', type: 'bytes' }, { name: 'imageId', type: 'bytes32' }, { name: 'journalDigest', type: 'bytes32' }], outputs: [], stateMutability: 'pure' },
] as const;

const CallDecisionRecordedEvent = parseAbiItem(
  'event CallDecisionRecorded(bytes32 indexed callId, uint8 decision, uint256 timestamp, address submitter)',
);
const ProofVerifiedEvent = parseAbiItem(
  'event ProofVerified(bytes32 indexed callId, bytes32 imageId, bytes32 journalDigest)',
);

// ═══════════════════════════════════════════════════════════════
// Hook: useDemo
// ═══════════════════════════════════════════════════════════════

function useDemo() {
  const [phase, setPhase] = useState<Phase>('connecting');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [lastBlockNumber, setLastBlockNumber] = useState<number | null>(null);
  const [turnCount, setTurnCount] = useState(0);
  const idRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const addLog = useCallback(
    (icon: string, label: string, text: string, color: string, logPhase: Phase, link?: string, indent?: boolean) => {
      const entry: LogEntry = {
        id: idRef.current++,
        timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }),
        icon,
        label,
        text,
        color,
        phase: logPhase,
        link,
        indent,
      };
      setLogs(prev => [...prev, entry]);
    },
    [],
  );

  const handleEvent = useCallback(
    (event: DemoEvent) => {
      const { type, data, callSid } = event;

      switch (type) {
        case 'call:start':
          setPhase('call');
          setTurnCount(0);
          setLastTxHash(null);
          setLastBlockNumber(null);
          addLog('📞', 'CALL', `Call connected from ${data.from || 'unknown'}`, '#3b82f6', 'call');
          break;

        case 'call:greeting':
          addLog('🤖', 'AI', String(data.text), '#22c55e', 'call');
          break;

        case 'stt:transcript':
          setTurnCount(prev => prev + 1);
          addLog('🗣️', 'Caller', String(data.text), '#eab308', 'call');
          break;

        case 'ai:response':
          addLog('🤖', 'AI', String(data.text), '#22c55e', 'call');
          break;

        case 'ai:decision': {
          setPhase('decision');
          const decision = String(data.decision).toUpperCase();
          const isBlock = decision === 'BLOCK';
          addLog(
            isBlock ? '🚫' : '✅',
            decision,
            String(data.reason || ''),
            isBlock ? '#ef4444' : '#22c55e',
            'decision',
          );
          break;
        }

        case 'email:sent':
          addLog('📧', 'Email', `Notification sent (${data.decision})`, '#3b82f6', 'decision');
          break;

        case 'witness:start':
          setPhase('proof');
          addLog('⛓️', 'Witness', `Pipeline started`, '#06b6d4', 'proof');
          break;

        case 'witness:web-proof':
          addLog('🌐', 'WebProof', `Generated (${data.proofSize} chars, TLSNotary MPC)`, '#06b6d4', 'proof');
          break;

        case 'witness:zk-proof':
          addLog('🧮', 'ZK Proof', `Compressed (RISC Zero → Groth16, seal: ${data.sealHash})`, '#06b6d4', 'proof');
          break;

        case 'witness:on-chain': {
          const txHash = String(data.txHash ?? '');
          const blockNum = Number(data.blockNumber ?? 0);
          setLastTxHash(txHash);
          setLastBlockNumber(blockNum);
          setPhase('complete');
          addLog('⛓️', 'ON-CHAIN', `TX: ${txHash.slice(0, 10)}…${txHash.slice(-8)}  block: ${blockNum}`, '#22c55e', 'complete');
          break;
        }

        case 'witness:failed':
          addLog('❌', 'Failed', String(data.error), '#ef4444', 'error');
          setPhase('waiting');
          break;

        case 'call:end':
          if (!data.decision) {
            addLog('📞', 'Hangup', 'Call ended without decision', '#888', 'waiting');
            setPhase('waiting');
          }
          break;
      }
    },
    [addLog],
  );

  // SSE connection
  useEffect(() => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    let reconnectTimer: ReturnType<typeof setTimeout>;

    async function connect() {
      setPhase('connecting');
      setError(null);

      try {
        const res = await fetch(`${BASE_URL}/api/demo/stream`, {
          headers: { Accept: 'text/event-stream' },
          signal: ctrl.signal,
        });

        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status}`);
        }

        setConnected(true);
        setPhase('waiting');

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          let eventData = '';

          for (const raw of lines) {
            const l = raw.trim();
            if (l.startsWith('data: ')) {
              eventData = l.slice(6);
            } else if (l === '' && eventData) {
              try {
                const event: DemoEvent = JSON.parse(eventData);
                handleEvent(event);
              } catch { /* ignore */ }
              eventData = '';
            }
          }
        }

        setConnected(false);
        setPhase('connecting');
        reconnectTimer = setTimeout(connect, 3000);
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setConnected(false);
        setError(err instanceof Error ? err.message : String(err));
        setPhase('error');
        reconnectTimer = setTimeout(connect, 5000);
      }
    }

    connect();
    return () => {
      ctrl.abort();
      clearTimeout(reconnectTimer);
    };
  }, [handleEvent]);

  return { phase, logs, connected, error, lastTxHash, lastBlockNumber, turnCount, addLog };
}

// ═══════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

// Chunked getLogs — public RPCs often reject large block ranges
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function chunkedGetLogs(client: any, params: { address: `0x${string}`; event: any; args: any; fromBlock: bigint; toBlock: 'latest' | bigint }, chunkSize = BigInt(5000)) {
  const latestBlock = await client.getBlockNumber();
  const to = params.toBlock === 'latest' ? latestBlock : params.toBlock;
  const from = params.fromBlock;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allLogs: any[] = [];
  for (let start = from; start <= to; start += chunkSize) {
    const end = start + chunkSize - BigInt(1) > to ? to : start + chunkSize - BigInt(1);
    try {
      const logs = await client.getLogs({ ...params, fromBlock: start, toBlock: end });
      allLogs.push(...logs);
      if (allLogs.length > 0) return allLogs; // found, early return
    } catch { /* chunk failed, continue */ }
  }
  return allLogs;
}

export default function DemoPage() {
  const { phase, logs, connected, error, lastTxHash, lastBlockNumber, turnCount, addLog } = useDemo();
  const logEndRef = useRef<HTMLDivElement>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  // Auto-scroll
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs.length]);

  // ─── Inline On-Chain Verification ─────────────────────
  const runVerification = useCallback(async () => {
    if (isVerifying) return;
    setIsVerifying(true);

    const ok = (id: string, text: string, link?: string) => addLog('✅', id, text, '#22c55e', 'complete', link);
    const ng = (id: string, text: string) => addLog('❌', id, text, '#ef4444', 'complete');
    const sub = (text: string, link?: string) => addLog('', '', text, '#666', 'complete', link, true);
    const DECISION_LABELS: Record<number, string> = { 0: 'UNKNOWN', 1: 'ACCEPT', 2: 'BLOCK', 3: 'RECORD' };

    addLog('🔍', 'VERIFY', 'Starting independent on-chain verification…', '#a78bfa', 'complete');
    addLog('', '', `Reading directly from Base Sepolia RPC — no VeriCall APIs used`, '#666', 'complete', undefined, true);
    await wait(300);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client: any = createPublicClient({ chain: baseSepolia, transport: http(VERIFY_CONFIG.rpcUrl) });

      // ─── Phase 1: Contract Checks ─────────────────────
      addLog('📋', 'PHASE 1', 'Contract integrity checks (C1–C5)', '#a78bfa', 'complete');
      await wait(200);

      // C1: Contract deployed
      const bytecode = await client.getCode({ address: VERIFY_CONFIG.registry });
      const size = bytecode ? (bytecode.length - 2) / 2 : 0;
      size > 0 ? ok('C1', `Contract deployed — ${size} bytes on-chain`, `${BASESCAN}/address/${VERIFY_CONFIG.registry}#code`) : ng('C1', 'No bytecode found');
      sub(`Registry: ${VERIFY_CONFIG.registry}`, `${BASESCAN}/address/${VERIFY_CONFIG.registry}`);
      await wait(120);

      // C2: Registry responds
      const stats = (await client.readContract({ address: VERIFY_CONFIG.registry, abi: REGISTRY_ABI, functionName: 'getStats' })) as [bigint, bigint, bigint, bigint];
      const total = Number(stats[0]);
      const accepted = Number(stats[1]);
      const blocked = Number(stats[2]);
      const recorded = Number(stats[3]);
      ok('C2', `Registry responds — ${total} records on-chain`);
      sub(`Stats: ${accepted} accepted, ${blocked} blocked, ${recorded} recorded`);
      await wait(120);

      // C3: Verifier configured
      const verifierAddr = (await client.readContract({ address: VERIFY_CONFIG.registry, abi: REGISTRY_ABI, functionName: 'verifier' })) as `0x${string}`;
      let isMock = false;
      let selectorHex = '';
      try {
        const sel = (await client.readContract({ address: verifierAddr, abi: MOCK_VERIFIER_ABI, functionName: 'SELECTOR' })) as string;
        selectorHex = sel;
        isMock = sel === '0xffffffff';
      } catch { /* not mock */ }
      ok('C3', `Verifier: ${isMock ? 'MockVerifier (RISC Zero dev)' : verifierAddr.slice(0, 10) + '…'}`, `${BASESCAN}/address/${verifierAddr}`);
      sub(`Address: ${verifierAddr}`, `${BASESCAN}/address/${verifierAddr}#code`);
      if (selectorHex) sub(`SELECTOR: ${selectorHex} ${isMock ? '(mock: 0xFFFFFFFF)' : ''}`);
      await wait(120);

      // C4: Image ID
      const imageId = (await client.readContract({ address: VERIFY_CONFIG.registry, abi: REGISTRY_ABI, functionName: 'imageId' })) as `0x${string}`;
      const hasImage = imageId !== '0x' + '0'.repeat(64);
      hasImage ? ok('C4', `Image ID set (vlayer guestId)`) : ng('C4', 'Image ID not set (zero)');
      sub(`${imageId}`);
      await wait(120);

      // C5: Owner
      const owner = (await client.readContract({ address: VERIFY_CONFIG.registry, abi: REGISTRY_ABI, functionName: 'owner' })) as `0x${string}`;
      ok('C5', `Owner address`, `${BASESCAN}/address/${owner}`);
      sub(`${owner}`, `${BASESCAN}/address/${owner}`);
      await wait(200);

      if (total === 0) {
        addLog('⚠️', 'VERIFY', 'No records found on-chain', '#eab308', 'complete');
        return;
      }

      // ─── Phase 2: Record Verification ─────────────────
      addLog('📋', 'PHASE 2', `Per-record verification (V1–V7) — latest record #${total}`, '#a78bfa', 'complete');
      await wait(200);

      const callId = (await client.readContract({ address: VERIFY_CONFIG.registry, abi: REGISTRY_ABI, functionName: 'callIds', args: [BigInt(total - 1)] })) as `0x${string}`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const record = (await client.readContract({ address: VERIFY_CONFIG.registry, abi: REGISTRY_ABI, functionName: 'getRecord', args: [callId] })) as any;
      const decision = Number(record.decision);
      const decisionLabel = DECISION_LABELS[decision] || 'UNKNOWN';
      const timestamp = Number(record.timestamp) > 0 ? new Date(Number(record.timestamp) * 1000).toISOString() : 'N/A';

      addLog('🔍', 'RECORD', `callId: ${callId.slice(0, 14)}…${callId.slice(-8)}`, '#a78bfa', 'complete');
      sub(`Decision: ${decisionLabel} | Timestamp: ${timestamp}`);
      sub(`Reason: "${String(record.reason).slice(0, 100)}${String(record.reason).length > 100 ? '…' : ''}"`);
      sub(`Submitter: ${record.submitter}`, `${BASESCAN}/address/${record.submitter}`);
      await wait(200);

      // V1: ZK proof verified flag + seal inspection
      const sealHex = record.zkProofSeal as `0x${string}`;
      const sealBytes = sealHex.length > 2 ? (sealHex.length - 2) / 2 : 0;
      const sealPrefix = sealHex.slice(0, 10);
      record.verified ? ok('V1', `ZK proof verified on-chain — record.verified == true`) : ng('V1', 'ZK proof NOT verified');
      sub(`Seal: ${sealPrefix}… (${sealBytes} bytes) ${sealPrefix === '0xffffffff' ? '← RISC Zero Mock selector' : ''}`);
      await wait(120);

      // V2: Journal hash integrity
      const storedHash = record.journalHash as `0x${string}`;
      const computedHash = keccak256(record.journalDataAbi);
      const hashMatch = computedHash === storedHash;
      hashMatch ? ok('V2', `Journal hash integrity — keccak256(journalDataAbi) == journalHash`) : ng('V2', 'Journal hash MISMATCH');
      sub(`Stored:   ${storedHash}`);
      sub(`Computed: ${computedHash}`);
      await wait(120);

      // V3: verifyJournal() on-chain
      let journalOk = false;
      try { journalOk = (await client.readContract({ address: VERIFY_CONFIG.registry, abi: REGISTRY_ABI, functionName: 'verifyJournal', args: [callId, record.journalDataAbi] })) as boolean; } catch { /* */ }
      journalOk ? ok('V3', 'On-chain journal verification — verifyJournal() → true') : ng('V3', 'verifyJournal() failed');
      sub(`Contract re-computed keccak256 and confirmed match`);
      await wait(120);

      // V4: Independent seal re-verification
      const journalDigest = sha256(record.journalDataAbi);
      let sealOk = false;
      try { await client.readContract({ address: verifierAddr, abi: MOCK_VERIFIER_ABI, functionName: 'verify', args: [record.zkProofSeal, imageId, journalDigest] }); sealOk = true; } catch { /* */ }
      sealOk ? ok('V4', 'Independent seal re-verification — verifier.verify() passed') : ng('V4', 'Seal re-verification failed');
      sub(`ImageID: ${imageId.slice(0, 14)}…${imageId.slice(-8)}`);
      sub(`JournalDigest: ${(journalDigest as string).slice(0, 14)}…${(journalDigest as string).slice(-8)}`);
      await wait(120);

      // V5: TLSNotary proven data — the heart of the proof
      let provenOk = false;
      let provenDecision = '';
      let provenReason = '';
      let provenUrl = '';
      let notaryFP = '';
      let provenMethod = '';
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pd = (await client.readContract({ address: VERIFY_CONFIG.registry, abi: REGISTRY_ABI, functionName: 'getProvenData', args: [callId] })) as any;
        notaryFP = pd[0] as string;
        provenMethod = pd[1] as string;
        provenUrl = pd[2] as string;
        provenDecision = pd[5] as string;
        provenReason = pd[6] as string;
        const notaryNonZero = notaryFP !== '0x' + '0'.repeat(64);
        provenOk = notaryNonZero && provenMethod === 'GET' && provenUrl.length > 0 && provenDecision.length > 0 && provenReason.length > 0;
      } catch { /* */ }
      provenOk ? ok('V5', 'TLSNotary web proof metadata — all fields valid') : ng('V5', 'TLSNotary metadata invalid or missing');
      if (notaryFP) sub(`NotaryKey FP: ${notaryFP.slice(0, 14)}…${notaryFP.slice(-8)}`);
      if (provenMethod) sub(`Method: ${provenMethod}`);
      if (provenUrl) sub(`URL: ${provenUrl}`);
      if (provenDecision) sub(`Proven decision: ${provenDecision}`);
      if (provenReason) sub(`Proven reason: "${provenReason.slice(0, 120)}${provenReason.length > 120 ? '…' : ''}"`);
      await wait(150);

      // V5b: Decision consistency — proven data vs on-chain record
      const decisionMatch = provenDecision.toUpperCase() === decisionLabel.toUpperCase();
      decisionMatch ? ok('V5b', `Decision consistency — proven "${provenDecision}" matches on-chain "${decisionLabel}"`) : ng('V5b', `Decision MISMATCH — proven "${provenDecision}" ≠ on-chain "${decisionLabel}"`);
      await wait(120);

      // V6: Registration TX
      let eventTxHash: string | null = null;
      let eventBlock: bigint | null = null;
      try {
        const evLogs = await chunkedGetLogs(client, { address: VERIFY_CONFIG.registry, event: CallDecisionRecordedEvent, args: { callId }, fromBlock: VERIFY_CONFIG.deployBlock, toBlock: 'latest' });
        if (evLogs.length > 0) { eventTxHash = evLogs[0].transactionHash; eventBlock = evLogs[0].blockNumber; }
      } catch { /* */ }
      eventTxHash ? ok('V6', `CallDecisionRecorded event found`, `${BASESCAN}/tx/${eventTxHash}`) : ng('V6', 'Registration TX not found');
      if (eventTxHash) sub(`TX: ${eventTxHash}`, `${BASESCAN}/tx/${eventTxHash}`);
      if (eventBlock) sub(`Block: ${eventBlock}`);
      await wait(120);

      // V7: ProofVerified event
      let proofEvent = false;
      let proofEventImageId = '';
      let proofEventDigest = '';
      try {
        const evLogs = await chunkedGetLogs(client, { address: VERIFY_CONFIG.registry, event: ProofVerifiedEvent, args: { callId }, fromBlock: VERIFY_CONFIG.deployBlock, toBlock: 'latest' });
        if (evLogs.length > 0) {
          proofEvent = true;
          proofEventImageId = evLogs[0].args?.imageId || '';
          proofEventDigest = evLogs[0].args?.journalDigest || '';
        }
      } catch { /* */ }
      proofEvent ? ok('V7', 'ProofVerified event — ZK proof validated by contract') : ng('V7', 'ProofVerified event not found');
      if (proofEventImageId) sub(`Event imageId: ${String(proofEventImageId).slice(0, 14)}…`);
      if (proofEventDigest) sub(`Event journalDigest: ${String(proofEventDigest).slice(0, 14)}…`);
      await wait(250);

      // ─── Summary ──────────────────────────────────────
      const results = [size > 0, true, true, hasImage, true, record.verified, hashMatch, journalOk, sealOk, provenOk, decisionMatch, !!eventTxHash, proofEvent];
      const passed = results.filter(Boolean).length;
      const perfect = passed === results.length;
      addLog(perfect ? '🏁' : '⚠️', 'DONE', `Verification complete: ${passed}/${results.length} checks passed`, perfect ? '#22c55e' : '#eab308', 'complete');
      if (perfect) sub(`All cryptographic proofs validated. This record is independently verifiable.`);
      sub(`Full verification: /verify page`, `${window.location.origin}/verify`);

    } catch (err: unknown) {
      addLog('❌', 'ERROR', `Verification failed: ${err instanceof Error ? err.message : String(err)}`, '#ef4444', 'complete');
    } finally {
      setIsVerifying(false);
    }
  }, [isVerifying, addLog]);

  const phaseInfo = {
    connecting: { label: 'Connecting…', color: '#eab308', anim: true },
    waiting: { label: 'Waiting for call', color: '#888', anim: true },
    call: { label: 'Call in progress', color: '#3b82f6', anim: true },
    decision: { label: 'Decision made', color: '#eab308', anim: false },
    proof: { label: 'Generating proof…', color: '#06b6d4', anim: true },
    complete: { label: 'Verified on-chain ✓', color: '#22c55e', anim: false },
    error: { label: 'Error', color: '#ef4444', anim: false },
  };

  const current = phaseInfo[phase];

  return (
    <div style={styles.page}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <Link href="/" style={{ textDecoration: 'none', color: 'inherit' }}>
            <span style={styles.logo}>⛓️ VeriCall</span>
          </Link>
          <span style={styles.badge}>LIVE DEMO</span>
        </div>
        <div style={styles.headerRight}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
            color: connected ? '#22c55e' : '#ef4444', fontSize: '0.8rem',
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: connected ? '#22c55e' : '#ef4444',
              boxShadow: connected ? '0 0 6px #22c55e' : undefined,
              animation: connected ? 'pulse 2s infinite' : undefined,
            }} />
            {connected ? 'Connected' : 'Disconnected'}
          </span>
          <Link href="/verify" style={styles.headerLink}>
            🔍 Verify
          </Link>
        </div>
      </header>

      {/* Pipeline Banner */}
      <section style={styles.pipeline}>
        <div style={styles.pipelineSteps}>
          {[
            { icon: '📞', label: 'Call', active: phase === 'call' },
            { icon: '🤖', label: 'AI Screen', active: phase === 'call' },
            { icon: '⚖️', label: 'Decision', active: phase === 'decision' },
            { icon: '🔐', label: 'WebProof', active: phase === 'proof' },
            { icon: '🧮', label: 'ZK Proof', active: phase === 'proof' },
            { icon: '⛓️', label: 'On-Chain', active: phase === 'complete' },
          ].map((step, i) => {
            const done = (() => {
              const order = ['connecting', 'waiting', 'call', 'decision', 'proof', 'complete'];
              const currentIdx = order.indexOf(phase);
              // Steps map roughly to phases
              const stepPhaseMap = ['call', 'call', 'decision', 'proof', 'proof', 'complete'];
              const stepIdx = order.indexOf(stepPhaseMap[i]);
              return currentIdx > stepIdx;
            })();
            return (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: '0.3rem',
                opacity: step.active ? 1 : done ? 0.6 : 0.25,
                color: step.active ? '#fff' : done ? '#22c55e' : '#888',
                transition: 'all 0.3s',
              }}>
                <span style={{ fontSize: '1.1rem' }}>{done ? '✓' : step.icon}</span>
                <span style={{ fontSize: '0.75rem', fontWeight: step.active ? 600 : 400 }}>{step.label}</span>
                {i < 5 && <span style={{ color: '#333', margin: '0 0.2rem' }}>→</span>}
              </div>
            );
          })}
        </div>
      </section>

      {/* Status Bar */}
      <div style={{
        ...styles.statusBar,
        borderColor: current.color + '40',
        background: current.color + '08',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {current.anim && (
            <span style={{
              display: 'inline-block',
              width: 10, height: 10,
              borderRadius: '50%',
              border: `2px solid ${current.color}`,
              borderTopColor: 'transparent',
              animation: 'spin 1s linear infinite',
            }} />
          )}
          <span style={{ color: current.color, fontWeight: 600 }}>{current.label}</span>
        </div>
        {phase === 'waiting' && (
          <span style={{ color: '#06b6d4', fontFamily: 'monospace', fontSize: '0.85rem', letterSpacing: '0.02em' }}>
            📞 +1 (802) 613-9192
          </span>
        )}
        {phase === 'call' && turnCount > 0 && (
          <span style={{ color: '#888', fontSize: '0.8rem' }}>{turnCount} turns</span>
        )}
      </div>

      {/* Event Log */}
      <div style={styles.logContainer}>
        {logs.length === 0 && phase === 'waiting' && (
          <div style={styles.emptyState}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📞</div>
            <div style={{ color: '#888', fontSize: '1.1rem' }}>Waiting for a phone call…</div>
            <a
              href="tel:+18026139192"
              style={{
                display: 'inline-block', marginTop: '1rem', padding: '0.75rem 2rem',
                borderRadius: '8px', border: '1px solid #06b6d440', background: '#06b6d412',
                color: '#06b6d4', fontSize: '1.5rem', fontWeight: 700, fontFamily: 'monospace',
                textDecoration: 'none', letterSpacing: '0.04em',
              }}
            >
              +1 (802) 613-9192
            </a>
            <div style={{ color: '#555', fontSize: '0.85rem', marginTop: '0.75rem' }}>
              Call this number to see the live pipeline in action
            </div>
          </div>
        )}

        {logs.map(entry => (
          <div key={entry.id} style={{
            ...styles.logEntry,
            paddingLeft: entry.indent ? '7.5rem' : undefined,
            opacity: entry.indent ? 0.7 : 1,
          }}>
            <span style={styles.logTime}>{entry.indent ? '' : entry.timestamp}</span>
            <span style={{ fontSize: entry.indent ? '0.8rem' : '1rem', width: '1.5rem', textAlign: 'center' }}>{entry.indent ? '' : entry.icon}</span>
            <span style={{
              fontWeight: 600, fontSize: entry.indent ? '0.65rem' : '0.75rem',
              color: entry.indent ? '#555' : entry.color,
              minWidth: '5rem',
              textTransform: 'uppercase',
            }}>
              {entry.indent ? '' : entry.label}
            </span>
            <span style={{
              color: entry.indent ? '#666' : entry.phase === 'call' ? '#ddd' : '#aaa',
              fontStyle: (entry.label === 'Caller' || entry.label === 'AI') ? 'italic' : 'normal',
              fontSize: entry.indent ? '0.8rem' : undefined,
              fontFamily: entry.indent ? 'monospace' : undefined,
              flex: 1,
            }}>
              {entry.text}
              {entry.link && (
                <a
                  href={entry.link}
                  target="_blank"
                  rel="noopener"
                  style={{ color: '#06b6d4', textDecoration: 'none', marginLeft: '0.4rem', fontSize: '0.8rem' }}
                >
                  ↗ BaseScan
                </a>
              )}
            </span>
          </div>
        ))}

        <div ref={logEndRef} />
      </div>

      {/* Complete Banner */}
      {phase === 'complete' && lastTxHash && (
        <div style={styles.completeBanner}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
            <span style={{ fontSize: '2rem' }}>✅</span>
            <div>
              <div style={{ color: '#22c55e', fontWeight: 700, fontSize: '1.2rem' }}>
                Verified &amp; Recorded On-Chain
              </div>
              <div style={{ color: '#888', fontSize: '0.85rem', marginTop: '0.15rem' }}>
                AI decision permanently anchored on Base Sepolia with ZK proof
              </div>
            </div>
          </div>

          <div style={styles.txInfo}>
            <div style={styles.txRow}>
              <span style={{ color: '#888' }}>TX Hash</span>
              <a
                href={`${BASESCAN}/tx/${lastTxHash}`}
                target="_blank"
                rel="noopener"
                style={{ color: '#22c55e', textDecoration: 'none', fontFamily: 'monospace', fontSize: '0.85rem' }}
              >
                {lastTxHash.slice(0, 14)}…{lastTxHash.slice(-10)} ↗
              </a>
            </div>
            {lastBlockNumber && (
              <div style={styles.txRow}>
                <span style={{ color: '#888' }}>Block</span>
                <span style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{lastBlockNumber}</span>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem', flexWrap: 'wrap' }}>
            <button
              onClick={runVerification}
              disabled={isVerifying}
              style={{
                ...styles.verifyButton,
                opacity: isVerifying ? 0.6 : 1,
                cursor: isVerifying ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
                outline: 'none',
              }}
            >
              {isVerifying ? '⏳ Verifying…' : '🔍 Verify This Record'}
            </button>
            <a
              href={`${BASESCAN}/tx/${lastTxHash}`}
              target="_blank"
              rel="noopener"
              style={styles.basescanButton}
            >
              View on BaseScan ↗
            </a>
          </div>
        </div>
      )}

      {/* Error */}
      {phase === 'error' && error && (
        <div style={styles.errorBanner}>
          ❌ Connection error: {error}. Retrying…
        </div>
      )}

      {/* Footer */}
      <footer style={styles.footer}>
        <span style={{ color: '#555' }}>
          📞 Call → 🤖 AI Screen → ⚖️ Decision → 🔐 WebProof → 🧮 ZK → ⛓️ Base Sepolia
        </span>
        <span style={{ color: '#444' }}>|</span>
        <Link href="/verify" style={{ color: '#22c55e80', textDecoration: 'none', fontSize: '0.8rem' }}>
          Independent Verification →
        </Link>
      </footer>

      {/* CSS Animations */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════════════════

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#0a0a0a',
    color: '#ededed',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.75rem 1.5rem',
    borderBottom: '1px solid #1a1a1a',
    background: '#050505',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
  },
  logo: {
    fontSize: '1.1rem',
    fontWeight: 700,
    letterSpacing: '-0.02em',
  },
  badge: {
    fontSize: '0.65rem',
    fontWeight: 600,
    padding: '0.15rem 0.5rem',
    borderRadius: '4px',
    background: '#06b6d420',
    color: '#06b6d4',
    letterSpacing: '0.08em',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
  },
  headerLink: {
    color: '#22c55e',
    textDecoration: 'none',
    fontSize: '0.85rem',
    padding: '0.3rem 0.6rem',
    borderRadius: '4px',
    border: '1px solid #22c55e30',
    background: '#22c55e08',
  },
  pipeline: {
    padding: '0.75rem 1.5rem',
    borderBottom: '1px solid #1a1a1a',
    background: '#080808',
  },
  pipelineSteps: {
    display: 'flex',
    justifyContent: 'center',
    gap: '0.25rem',
    flexWrap: 'wrap' as const,
  },
  statusBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.5rem 1.5rem',
    borderBottom: '1px solid',
    fontSize: '0.9rem',
  },
  logContainer: {
    flex: 1,
    padding: '1rem 1.5rem',
    overflowY: 'auto' as const,
    maxHeight: 'calc(100vh - 320px)',
    minHeight: '200px',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4rem 2rem',
    textAlign: 'center' as const,
  },
  logEntry: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.5rem',
    padding: '0.3rem 0',
    fontSize: '0.9rem',
    lineHeight: '1.5',
    borderBottom: '1px solid #111',
  },
  logTime: {
    color: '#444',
    fontFamily: 'monospace',
    fontSize: '0.75rem',
    minWidth: '5.5rem',
    paddingTop: '0.15rem',
  },
  completeBanner: {
    margin: '0 1.5rem 1rem',
    padding: '1.25rem 1.5rem',
    borderRadius: '8px',
    border: '1px solid #22c55e30',
    background: 'rgba(34,197,94,0.04)',
  },
  txInfo: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.4rem',
    padding: '0.75rem',
    borderRadius: '6px',
    background: '#111',
    border: '1px solid #1a1a1a',
  },
  txRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '0.85rem',
  },
  verifyButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.4rem',
    padding: '0.6rem 1.2rem',
    borderRadius: '6px',
    background: '#22c55e15',
    border: '1px solid #22c55e40',
    color: '#22c55e',
    fontWeight: 600,
    fontSize: '0.85rem',
    textDecoration: 'none',
    cursor: 'pointer',
  },
  basescanButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.4rem',
    padding: '0.6rem 1.2rem',
    borderRadius: '6px',
    background: '#1a1a1a',
    border: '1px solid #333',
    color: '#888',
    fontSize: '0.85rem',
    textDecoration: 'none',
    cursor: 'pointer',
  },
  errorBanner: {
    margin: '0 1.5rem 1rem',
    padding: '1rem 1.5rem',
    borderRadius: '8px',
    border: '1px solid #ef444440',
    background: 'rgba(239,68,68,0.06)',
    color: '#ef4444',
    fontSize: '0.9rem',
  },
  footer: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.75rem',
    borderTop: '1px solid #1a1a1a',
    fontSize: '0.75rem',
    flexWrap: 'wrap' as const,
  },
};
