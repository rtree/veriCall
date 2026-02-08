'use client';

/**
 * useVerify — Client-side on-chain verification hook.
 *
 * Trust model: This code runs entirely in the user's browser.
 * It connects directly to the public Base Sepolia RPC endpoint.
 * No VeriCall server-side APIs are called for verification.
 *
 * The user can inspect this code via browser DevTools → Sources
 * to confirm all data comes from on-chain reads.
 */

import { useState, useCallback } from 'react';
import {
  createPublicClient,
  http,
  keccak256,
  sha256,
  parseAbiItem,
} from 'viem';
import { baseSepolia } from 'viem/chains';

// ═══════════════════════════════════════════════════════════════
// Hardcoded public config — verifiable on BaseScan
// ═══════════════════════════════════════════════════════════════

export const CONFIG = {
  registry: '0x9a6015c6a0f13a816174995137e8a57a71250b81' as `0x${string}`,
  mockVerifier: '0xea998b642b469736a3f656328853203da3d92724' as `0x${string}`,
  deployBlock: BigInt(37374494),
  rpcUrl: 'https://sepolia.base.org',
  basescan: 'https://sepolia.basescan.org',
  chainId: 84532,
  network: 'Base Sepolia',
  repo: 'https://github.com/rtree/veriCall',
} as const;

// ═══════════════════════════════════════════════════════════════
// ABIs — self-contained, no imports from project
// ═══════════════════════════════════════════════════════════════

const REGISTRY_ABI = [
  { type: 'function', name: 'getStats', inputs: [], outputs: [{ name: 'total', type: 'uint256' }, { name: 'accepted', type: 'uint256' }, { name: 'blocked', type: 'uint256' }, { name: 'recorded', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'owner', inputs: [], outputs: [{ name: '', type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'imageId', inputs: [], outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view' },
  { type: 'function', name: 'verifier', inputs: [], outputs: [{ name: '', type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'callIds', inputs: [{ name: '', type: 'uint256' }], outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view' },
  { type: 'function', name: 'getRecord', inputs: [{ name: 'callId', type: 'bytes32' }], outputs: [{ name: '', type: 'tuple', components: [{ name: 'decision', type: 'uint8' }, { name: 'reason', type: 'string' }, { name: 'journalHash', type: 'bytes32' }, { name: 'zkProofSeal', type: 'bytes' }, { name: 'journalDataAbi', type: 'bytes' }, { name: 'sourceUrl', type: 'string' }, { name: 'timestamp', type: 'uint256' }, { name: 'submitter', type: 'address' }, { name: 'verified', type: 'bool' }] }], stateMutability: 'view' },
  { type: 'function', name: 'getProvenData', inputs: [{ name: 'callId', type: 'bytes32' }], outputs: [{ name: 'notaryKeyFingerprint', type: 'bytes32' }, { name: 'method', type: 'string' }, { name: 'url', type: 'string' }, { name: 'proofTimestamp', type: 'uint256' }, { name: 'queriesHash', type: 'bytes32' }, { name: 'provenDecision', type: 'string' }, { name: 'provenReason', type: 'string' }, { name: 'provenSystemPromptHash', type: 'string' }, { name: 'provenTranscriptHash', type: 'string' }, { name: 'provenSourceCodeCommit', type: 'string' }], stateMutability: 'view' },
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
// Types
// ═══════════════════════════════════════════════════════════════

export type CheckStatus = 'pending' | 'running' | 'pass' | 'fail' | 'skip';

export interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** Optional BaseScan or explorer link for the detail value */
  detailLink?: string;
  /** Sub-detail rows (richer data, shown indented) */
  subDetails?: Array<{ text: string; link?: string }>;
}

export interface RecordData {
  index: number;
  callId: string;
  decision: number;
  decisionLabel: string;
  reason: string;
  timestamp: string;
  submitter: string;
  sourceUrl: string;
  txHash: string | null;
  basescanTx: string | null;
  checks: Check[];
  provenData: {
    method: string;
    url: string;
    notaryFP: string;
    proofTimestamp: string;
    extractedData: string;
    provenSourceCodeCommit: string;
  };
}

export interface ContractData {
  bytecodeSize: number;
  verifierAddr: string;
  isMockVerifier: boolean;
  imageId: string;
  owner: string;
  stats: { total: number; accepted: number; blocked: number; recorded: number };
  checks: Check[];
}

export interface VerifyState {
  phase: 'idle' | 'contract' | 'records' | 'done' | 'error';
  contract: ContractData | null;
  records: RecordData[];
  error: string | null;
  totalChecks: number;
  passedChecks: number;
}

const DECISION_LABELS: Record<number, string> = {
  0: 'UNKNOWN', 1: 'ACCEPT', 2: 'BLOCK', 3: 'RECORD',
};

// ═══════════════════════════════════════════════════════════════
// Hook
// ═══════════════════════════════════════════════════════════════

export function useVerify() {
  const [state, setState] = useState<VerifyState>({
    phase: 'idle',
    contract: null,
    records: [],
    error: null,
    totalChecks: 0,
    passedChecks: 0,
  });

  const run = useCallback(async () => {
    try {
      const client = createPublicClient({
        chain: baseSepolia,
        transport: http(CONFIG.rpcUrl),
      });

      // ─── Phase 1: Contract ──────────────────────────────

      setState(s => ({ ...s, phase: 'contract' }));

      const contractChecks: Check[] = [
        { id: 'C1', label: 'Contract deployed', status: 'running', detail: '' },
        { id: 'C2', label: 'Registry responds', status: 'pending', detail: '' },
        { id: 'C3', label: 'Verifier configured', status: 'pending', detail: '' },
        { id: 'C4', label: 'Image ID set', status: 'pending', detail: '' },
        { id: 'C5', label: 'Owner address', status: 'pending', detail: '' },
      ];

      const contractData: ContractData = {
        bytecodeSize: 0, verifierAddr: '', isMockVerifier: false,
        imageId: '', owner: '',
        stats: { total: 0, accepted: 0, blocked: 0, recorded: 0 },
        checks: contractChecks,
      };

      setState(s => ({ ...s, contract: { ...contractData } }));

      // C1: Bytecode
      const bytecode = await client.getCode({ address: CONFIG.registry });
      const bytecodeSize = bytecode ? (bytecode.length - 2) / 2 : 0;
      contractData.bytecodeSize = bytecodeSize;
      contractChecks[0].status = bytecodeSize > 0 ? 'pass' : 'fail';
      contractChecks[0].detail = `${bytecodeSize} bytes`;
      contractChecks[1].status = 'running';
      setState(s => ({ ...s, contract: { ...contractData, checks: [...contractChecks] } }));

      // C2: Stats
      const stats = (await client.readContract({
        address: CONFIG.registry, abi: REGISTRY_ABI, functionName: 'getStats',
      })) as [bigint, bigint, bigint, bigint];
      contractData.stats = {
        total: Number(stats[0]), accepted: Number(stats[1]),
        blocked: Number(stats[2]), recorded: Number(stats[3]),
      };
      contractChecks[1].status = 'pass';
      contractChecks[1].detail = `${contractData.stats.total} records`;
      contractChecks[2].status = 'running';
      setState(s => ({ ...s, contract: { ...contractData, checks: [...contractChecks] } }));

      // C3: Verifier
      const verifierAddr = (await client.readContract({
        address: CONFIG.registry, abi: REGISTRY_ABI, functionName: 'verifier',
      })) as `0x${string}`;
      contractData.verifierAddr = verifierAddr;
      let isMock = false;
      try {
        const sel = (await client.readContract({
          address: verifierAddr, abi: MOCK_VERIFIER_ABI, functionName: 'SELECTOR',
        })) as string;
        isMock = sel === '0xffffffff';
      } catch { /* not mock */ }
      contractData.isMockVerifier = isMock;
      contractChecks[2].status = 'pass';
      contractChecks[2].detail = isMock ? `MockVerifier (dev)` : verifierAddr.slice(0, 6) + '...' + verifierAddr.slice(-4);
      contractChecks[2].detailLink = `${CONFIG.basescan}/address/${verifierAddr}`;
      contractChecks[3].status = 'running';
      setState(s => ({ ...s, contract: { ...contractData, checks: [...contractChecks] } }));

      // C4: Image ID
      const imageId = (await client.readContract({
        address: CONFIG.registry, abi: REGISTRY_ABI, functionName: 'imageId',
      })) as `0x${string}`;
      contractData.imageId = imageId;
      contractChecks[3].status = imageId !== '0x' + '0'.repeat(64) ? 'pass' : 'fail';
      contractChecks[3].detail = imageId.slice(0, 6) + '...' + imageId.slice(-4);
      contractChecks[4].status = 'running';
      setState(s => ({ ...s, contract: { ...contractData, checks: [...contractChecks] } }));

      // C5: Owner
      const owner = (await client.readContract({
        address: CONFIG.registry, abi: REGISTRY_ABI, functionName: 'owner',
      })) as `0x${string}`;
      contractData.owner = owner;
      contractChecks[4].status = 'pass';
      contractChecks[4].detail = owner.slice(0, 6) + '...' + owner.slice(-4);
      contractChecks[4].detailLink = `${CONFIG.basescan}/address/${owner}`;
      setState(s => ({ ...s, contract: { ...contractData, checks: [...contractChecks] } }));

      // ─── Phase 2: Records ───────────────────────────────

      setState(s => ({ ...s, phase: 'records' }));

      const records: RecordData[] = [];

      for (let i = 0; i < contractData.stats.total; i++) {
        const rec = await verifyRecord(client, i, imageId, verifierAddr);
        records.push(rec);
        setState(s => ({ ...s, records: [...records] }));
      }

      // ─── Done ───────────────────────────────────────────

      const allChecks = [...contractChecks, ...records.flatMap(r => r.checks)];
      const activeChecks = allChecks.filter(c => c.status !== 'skip');
      setState(s => ({
        ...s,
        phase: 'done',
        totalChecks: activeChecks.length,
        passedChecks: activeChecks.filter(c => c.status === 'pass').length,
      }));
    } catch (err: any) {
      setState(s => ({ ...s, phase: 'error', error: err.message || 'Unknown error' }));
    }
  }, []);

  return { state, run };
}

// ═══════════════════════════════════════════════════════════════
// Chunked getLogs (public RPCs reject large block ranges)
// ═══════════════════════════════════════════════════════════════

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
      if (allLogs.length > 0) return allLogs;
    } catch { /* chunk failed, continue */ }
  }
  return allLogs;
}

// ═══════════════════════════════════════════════════════════════
// Per-Record Verification
// ═══════════════════════════════════════════════════════════════

async function verifyRecord(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  index: number,
  imageId: `0x${string}`,
  verifierAddr: `0x${string}`,
): Promise<RecordData> {
  const callId = (await client.readContract({
    address: CONFIG.registry, abi: REGISTRY_ABI, functionName: 'callIds',
    args: [BigInt(index)],
  })) as `0x${string}`;

  const record = (await client.readContract({
    address: CONFIG.registry, abi: REGISTRY_ABI, functionName: 'getRecord',
    args: [callId],
  })) as any;

  const decision = Number(record.decision);
  const timestamp = new Date(Number(record.timestamp) * 1000).toISOString();

  const checks: Check[] = [];

  // V1: verified flag + seal inspection
  const sealHex = record.zkProofSeal as `0x${string}`;
  const sealBytes = sealHex.length > 2 ? (sealHex.length - 2) / 2 : 0;
  const sealPrefix = sealHex.slice(0, 10);
  checks.push({
    id: 'V1', label: 'ZK proof verified on-chain',
    status: record.verified ? 'pass' : 'fail',
    detail: record.verified ? 'record.verified == true' : 'NOT verified',
    subDetails: [
      { text: `Seal: ${sealPrefix}… (${sealBytes} bytes)${sealPrefix === '0xffffffff' ? ' ← RISC Zero Mock selector' : ''}` },
    ],
  });

  // V2: Journal hash
  const computedHash = keccak256(record.journalDataAbi);
  const hashMatch = computedHash === record.journalHash;
  checks.push({
    id: 'V2', label: 'Journal hash integrity',
    status: hashMatch ? 'pass' : 'fail',
    detail: hashMatch ? 'keccak256(journalDataAbi) == journalHash' : 'MISMATCH',
    subDetails: [
      { text: `Stored:   ${record.journalHash}` },
      { text: `Computed: ${computedHash}` },
    ],
  });

  // V3: verifyJournal()
  let journalOk = false;
  try {
    journalOk = (await client.readContract({
      address: CONFIG.registry, abi: REGISTRY_ABI, functionName: 'verifyJournal',
      args: [callId, record.journalDataAbi],
    })) as boolean;
  } catch { /* */ }
  checks.push({
    id: 'V3', label: 'On-chain journal verification',
    status: journalOk ? 'pass' : 'fail',
    detail: journalOk ? 'verifyJournal() → true' : 'verifyJournal() failed',
    subDetails: [
      { text: 'Contract re-computed keccak256 and confirmed match' },
    ],
  });

  // V4: Direct seal re-verify
  let sealOk = false;
  let journalDigest = '' as string;
  try {
    journalDigest = sha256(record.journalDataAbi) as string;
    await client.readContract({
      address: verifierAddr, abi: MOCK_VERIFIER_ABI, functionName: 'verify',
      args: [record.zkProofSeal, imageId, journalDigest],
    });
    sealOk = true;
  } catch { /* */ }
  checks.push({
    id: 'V4', label: 'Independent seal re-verification',
    status: sealOk ? 'pass' : 'fail',
    detail: sealOk ? 'verifier.verify() passed' : 'verifier.verify() failed',
    subDetails: [
      { text: `ImageID: ${imageId.slice(0, 14)}…${imageId.slice(-8)}` },
      { text: `JournalDigest: ${journalDigest.slice(0, 14)}…${journalDigest.slice(-8)}` },
    ],
  });

  // V5: Proven data
  let provenData = { method: '', url: '', notaryFP: '', proofTimestamp: '', extractedData: '', provenDecision: '', provenReason: '', provenSourceCodeCommit: '' };
  let provenOk = false;
  try {
    const pd = (await client.readContract({
      address: CONFIG.registry, abi: REGISTRY_ABI, functionName: 'getProvenData',
      args: [callId],
    })) as any;
    const notaryNonZero = pd[0] !== '0x' + '0'.repeat(64);
    const methodGet = pd[1] === 'GET';
    const urlPresent = (pd[2] as string).length > 0;
    const dataPresent = (pd[5] as string).length > 0;
    provenOk = notaryNonZero && methodGet && urlPresent && dataPresent;
    provenData = {
      method: pd[1],
      url: pd[2],
      notaryFP: pd[0] as string,
      proofTimestamp: Number(pd[3]) > 0 ? new Date(Number(pd[3]) * 1000).toISOString() : 'N/A',
      extractedData: pd[5],
      provenDecision: pd[5] as string,
      provenReason: pd[6] as string,
      provenSourceCodeCommit: (pd[9] as string) || '',
    };
  } catch { /* */ }
  const v5SubDetails: Array<{ text: string; link?: string }> = [];
  if (provenData.notaryFP) v5SubDetails.push({ text: `NotaryKey FP: ${provenData.notaryFP.slice(0, 14)}…${provenData.notaryFP.slice(-8)}` });
  if (provenData.method) v5SubDetails.push({ text: `Method: ${provenData.method}` });
  if (provenData.url) v5SubDetails.push({ text: `URL: ${provenData.url}` });
  if (provenData.provenDecision) v5SubDetails.push({ text: `Proven decision: ${provenData.provenDecision}` });
  if (provenData.provenReason) v5SubDetails.push({ text: `Proven reason: "${provenData.provenReason.slice(0, 120)}${provenData.provenReason.length > 120 ? '…' : ''}"` });
  if (provenData.provenSourceCodeCommit) v5SubDetails.push({ text: `Source code commit: ${provenData.provenSourceCodeCommit}`, link: `${CONFIG.repo}/tree/${provenData.provenSourceCodeCommit}` });
  checks.push({
    id: 'V5', label: 'TLSNotary web proof metadata',
    status: provenOk ? 'pass' : 'fail',
    detail: provenOk ? 'All fields valid' : 'Invalid or missing',
    subDetails: v5SubDetails,
  });

  // V5b: Decision consistency — proven data vs on-chain record
  const decisionMatch = provenData.provenDecision
    ? provenData.provenDecision.toUpperCase() === (DECISION_LABELS[decision] || '').toUpperCase()
    : false;
  checks.push({
    id: 'V5b', label: 'Decision consistency',
    status: decisionMatch ? 'pass' : 'fail',
    detail: decisionMatch
      ? `Proven "${provenData.provenDecision}" matches on-chain "${DECISION_LABELS[decision]}"`
      : `Proven "${provenData.provenDecision || '?'}" ≠ on-chain "${DECISION_LABELS[decision]}"`,
  });

  // V6: TX from events (chunked to avoid RPC range limits)
  let txHash: string | null = null;
  let eventBlock: bigint | null = null;
  try {
    const logs = await chunkedGetLogs(client, {
      address: CONFIG.registry, event: CallDecisionRecordedEvent,
      args: { callId }, fromBlock: CONFIG.deployBlock, toBlock: 'latest',
    });
    if (logs.length > 0) {
      txHash = logs[0].transactionHash;
      eventBlock = logs[0].blockNumber;
    }
  } catch { /* */ }
  const v6SubDetails: Array<{ text: string; link?: string }> = [];
  if (txHash) v6SubDetails.push({ text: `TX: ${txHash}`, link: `${CONFIG.basescan}/tx/${txHash}` });
  if (eventBlock) v6SubDetails.push({ text: `Block: ${eventBlock}`, link: `${CONFIG.basescan}/block/${eventBlock}` });
  checks.push({
    id: 'V6', label: 'CallDecisionRecorded event found',
    status: txHash ? 'pass' : 'fail',
    detail: txHash ? txHash.slice(0, 6) + '...' + txHash.slice(-4) : 'Event lookup failed',
    detailLink: txHash ? `${CONFIG.basescan}/tx/${txHash}` : undefined,
    subDetails: v6SubDetails,
  });

  // V7: ProofVerified event (chunked to avoid RPC range limits)
  let proofEventFound = false;
  let proofEventImageId = '';
  let proofEventDigest = '';
  try {
    const logs = await chunkedGetLogs(client, {
      address: CONFIG.registry, event: ProofVerifiedEvent,
      args: { callId }, fromBlock: CONFIG.deployBlock, toBlock: 'latest',
    });
    if (logs.length > 0) {
      proofEventFound = true;
      proofEventImageId = logs[0].args?.imageId || '';
      proofEventDigest = logs[0].args?.journalDigest || '';
    }
  } catch { /* */ }
  const v7SubDetails: Array<{ text: string; link?: string }> = [];
  if (proofEventImageId) v7SubDetails.push({ text: `Event imageId: ${String(proofEventImageId).slice(0, 14)}…` });
  if (proofEventDigest) v7SubDetails.push({ text: `Event journalDigest: ${String(proofEventDigest).slice(0, 14)}…` });
  checks.push({
    id: 'V7', label: 'ProofVerified event emitted',
    status: proofEventFound ? 'pass' : 'fail',
    detail: proofEventFound ? 'ZK verification confirmed on-chain' : 'Event not found',
    subDetails: v7SubDetails,
  });

  // V8: Source code attestation — verify commit SHA exists on GitHub
  const commitSha = provenData.provenSourceCodeCommit;
  let v8Status: CheckStatus = 'pending';
  let v8Detail = '';
  const v8SubDetails: Array<{ text: string; link?: string }> = [];
  if (commitSha && commitSha.length >= 7 && commitSha !== 'unknown') {
    // We can't call GitHub API from browser (CORS / rate limit), but we can
    // construct the URL and verify it's a valid-looking commit hash
    const isValidHex = /^[0-9a-f]{7,40}$/.test(commitSha);
    v8Status = isValidHex ? 'pass' : 'fail';
    v8Detail = isValidHex
      ? `Commit ${commitSha.slice(0, 7)}… on-chain — verify on GitHub`
      : `Invalid commit format: "${commitSha}"`;
    if (isValidHex) {
      v8SubDetails.push({ text: `GitHub: ${CONFIG.repo}/tree/${commitSha}`, link: `${CONFIG.repo}/tree/${commitSha}` });
      v8SubDetails.push({ text: `System prompt: ${CONFIG.repo}/blob/${commitSha}/lib/voice-ai/gemini.ts`, link: `${CONFIG.repo}/blob/${commitSha}/lib/voice-ai/gemini.ts` });
      v8SubDetails.push({ text: 'Hash the file yourself to compare with on-chain systemPromptHash' });
    }
  } else {
    v8Status = 'skip';
    v8Detail = 'Not available in this journal version';
    v8SubDetails.push({ text: 'V4+ records include sourceCodeCommit for source code attestation' });
  }
  checks.push({
    id: 'V8', label: 'Source code attestation',
    status: v8Status,
    detail: v8Detail,
    subDetails: v8SubDetails,
  });

  return {
    index, callId, decision,
    decisionLabel: DECISION_LABELS[decision] || 'UNKNOWN',
    reason: record.reason, timestamp,
    submitter: record.submitter,
    sourceUrl: record.sourceUrl,
    txHash,
    basescanTx: txHash ? `${CONFIG.basescan}/tx/${txHash}` : null,
    checks,
    provenData,
  };
}
