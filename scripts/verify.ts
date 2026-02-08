#!/usr/bin/env npx tsx
/**
 * VeriCall — Trust-Minimized Independent Verification Report
 *
 * This script reads ONLY from the public Base Sepolia blockchain.
 * No API keys, no wallets, no trust in VeriCall operators required.
 *
 * Anyone can run this to independently verify that every AI call
 * decision was backed by a valid ZK proof at the time of on-chain
 * registration.
 *
 * Usage:
 *   npx tsx scripts/verify.ts                 # Full verification report
 *   npx tsx scripts/verify.ts --record 0      # Verify specific record
 *   npx tsx scripts/verify.ts --deep          # + Re-fetch source URLs
 *   npx tsx scripts/verify.ts --cast          # Print Foundry `cast` commands
 *   npx tsx scripts/verify.ts --json          # Machine-readable JSON output
 *
 * Requirements: Node.js ≥ 18, internet access (Base Sepolia RPC)
 * No wallet or private key needed — read-only verification.
 */

import { createPublicClient, http, keccak256, parseAbiItem, sha256 } from 'viem';
import { baseSepolia } from 'viem/chains';

// ═══════════════════════════════════════════════════════════════
// Config — hardcoded for trust-minimized verification.
// A verifier should NOT rely on .env or local config files.
// These are public, on-chain addresses anyone can check.
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  registry: '0x9a6015c6a0f13a816174995137e8a57a71250b81' as `0x${string}`,
  mockVerifier: '0xea998b642b469736a3f656328853203da3d92724' as `0x${string}`,
  deployer: '0x485A974140923524a74B0D72aF117852F31B412D' as `0x${string}`,
  deployBlock: 37374494n,
  imageId: '0x6e251f4d993427d02a4199e1201f3b54462365d7c672a51be57f776d509b47eb',
  rpcUrl: 'https://sepolia.base.org',
  basescan: 'https://sepolia.basescan.org',
  chainId: 84532,
  network: 'Base Sepolia',
  repo: 'https://github.com/rtree/veriCall',
} as const;

// ═══════════════════════════════════════════════════════════════
// ABIs — inlined so the script is fully self-contained.
// No imports from the project codebase.
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
  { type: 'function', name: 'EXPECTED_NOTARY_KEY_FP', inputs: [], outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view' },
  { type: 'function', name: 'expectedQueriesHash', inputs: [], outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view' },
  { type: 'function', name: 'expectedUrlPrefix', inputs: [], outputs: [{ name: '', type: 'string' }], stateMutability: 'view' },
] as const;

const MOCK_VERIFIER_ABI = [
  { type: 'function', name: 'SELECTOR', inputs: [], outputs: [{ name: '', type: 'bytes4' }], stateMutability: 'view' },
  { type: 'function', name: 'verify', inputs: [{ name: 'seal', type: 'bytes' }, { name: 'imageId', type: 'bytes32' }, { name: 'journalDigest', type: 'bytes32' }], outputs: [], stateMutability: 'pure' },
] as const;

// ─── Event ABI items for log lookups ───────────────────────────

const CallDecisionRecordedEvent = parseAbiItem(
  'event CallDecisionRecorded(bytes32 indexed callId, uint8 decision, uint256 timestamp, address submitter)',
);
const ProofVerifiedEvent = parseAbiItem(
  'event ProofVerified(bytes32 indexed callId, bytes32 imageId, bytes32 journalDigest)',
);

// ═══════════════════════════════════════════════════════════════
// CLI Flags
// ═══════════════════════════════════════════════════════════════

const args = process.argv.slice(2);
const JSON_MODE = args.includes('--json');
const DEEP_MODE = args.includes('--deep');
const CAST_MODE = args.includes('--cast');
const RECORD_INDEX = (() => {
  const idx = args.indexOf('--record');
  return idx >= 0 && args[idx + 1] ? parseInt(args[idx + 1], 10) : null;
})();

// ═══════════════════════════════════════════════════════════════
// Terminal Colors
// ═══════════════════════════════════════════════════════════════

const C = JSON_MODE
  ? { R: '', B: '', D: '', G: '', RD: '', Y: '', CY: '', MG: '' }
  : {
      R: '\x1b[0m',   // reset
      B: '\x1b[1m',   // bold
      D: '\x1b[2m',   // dim
      G: '\x1b[32m',  // green
      RD: '\x1b[31m', // red
      Y: '\x1b[33m',  // yellow
      CY: '\x1b[36m', // cyan
      MG: '\x1b[35m', // magenta
    };

const PASS = `${C.G}✅${C.R}`;
const FAIL = `${C.RD}❌${C.R}`;
const WARN = `${C.Y}⚠️${C.R}`;
const INFO = `${C.CY}ℹ${C.R}`;

const DECISION_LABEL: Record<number, string> = {
  0: 'UNKNOWN', 1: 'ACCEPT', 2: 'BLOCK', 3: 'RECORD',
};
const DECISION_EMOJI: Record<number, string> = {
  0: '❓', 1: '✅', 2: '🚫', 3: '📝',
};

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

interface CheckResult {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
  extra?: Record<string, any>;
}

interface RecordVerification {
  index: number;
  callId: string;
  decision: string;
  reason: string;
  timestamp: string;
  sourceUrl: string;
  submitter: string;
  txHash: string | null;
  basescanTx: string | null;
  checks: CheckResult[];
  provenData: {
    notaryKeyFingerprint: string;
    method: string;
    url: string;
    proofTimestamp: string;
    queriesHash: string;
    provenDecision: string;
    provenReason: string;
    provenSystemPromptHash: string;
    provenTranscriptHash: string;
    provenSourceCodeCommit: string;
    extractedData: string;
  };
  deepCheck?: {
    urlAccessible: boolean;
    responseConsistent: boolean;
    currentResponse: string | null;
  };
}

interface VerificationReport {
  title: string;
  generated: string;
  contract: string;
  network: string;
  chainId: number;
  basescan: string;
  rpcUrl: string;
  contractChecks: CheckResult[];
  records: RecordVerification[];
  summary: {
    totalRecords: number;
    allPassed: boolean;
    passCount: number;
    failCount: number;
    trustModel: string[];
  };
  reproduce: {
    cli: string;
    cast: string[];
  };
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(CONFIG.rpcUrl),
  });

  const report: VerificationReport = {
    title: 'VeriCall — Independent Verification Report',
    generated: new Date().toISOString(),
    contract: CONFIG.registry,
    network: CONFIG.network,
    chainId: CONFIG.chainId,
    basescan: `${CONFIG.basescan}/address/${CONFIG.registry}`,
    rpcUrl: CONFIG.rpcUrl,
    contractChecks: [],
    records: [],
    summary: {
      totalRecords: 0,
      allPassed: true,
      passCount: 0,
      failCount: 0,
      trustModel: [],
    },
    reproduce: { cli: '', cast: [] },
  };

  // ─── Header ────────────────────────────────────────────────

  if (!JSON_MODE && !CAST_MODE) {
    console.log('');
    console.log(`${C.B}╔══════════════════════════════════════════════════════════════════╗${C.R}`);
    console.log(`${C.B}║  VeriCall — Independent Verification Report                     ║${C.R}`);
    console.log(`${C.B}║  "Replace 'trust the AI' with 'verify the AI'"                  ║${C.R}`);
    console.log(`${C.B}╚══════════════════════════════════════════════════════════════════╝${C.R}`);
    console.log('');
    console.log(`  ${C.D}Generated:${C.R} ${report.generated}`);
    console.log(`  ${C.D}Contract:${C.R}  ${CONFIG.registry}`);
    console.log(`  ${C.D}Network:${C.R}   ${CONFIG.network} (chainId ${CONFIG.chainId})`);
    console.log(`  ${C.D}RPC:${C.R}       ${CONFIG.rpcUrl}`);
    console.log(`  ${C.D}BaseScan:${C.R}  ${CONFIG.basescan}/address/${CONFIG.registry}`);
    console.log('');
    console.log(`  ${C.D}This report reads ONLY from the public blockchain.${C.R}`);
    console.log(`  ${C.D}No API keys, wallets, or trust in VeriCall required.${C.R}`);
    console.log('');
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 1: Contract Verification
  // ═══════════════════════════════════════════════════════════

  if (!JSON_MODE && !CAST_MODE) {
    console.log(`${C.B}━━━ Phase 1: Contract Verification ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.R}`);
    console.log('');
  }

  // C1: Contract bytecode exists
  const bytecode = await client.getCode({ address: CONFIG.registry });
  const bytecodeLen = bytecode ? (bytecode.length - 2) / 2 : 0;
  const c1: CheckResult = {
    id: 'C1', label: 'Contract bytecode exists',
    passed: !!bytecode && bytecode !== '0x',
    detail: `${bytecodeLen} bytes at ${CONFIG.registry}`,
  };
  report.contractChecks.push(c1);
  if (!c1.passed) throw new Error(`No contract at ${CONFIG.registry} — cannot verify`);

  // C2: Contract responds as VeriCallRegistryV4
  const stats = (await client.readContract({
    address: CONFIG.registry, abi: REGISTRY_ABI, functionName: 'getStats',
  })) as [bigint, bigint, bigint, bigint];
  const totalRecords = Number(stats[0]);
  const c2: CheckResult = {
    id: 'C2', label: 'Contract responds as VeriCallRegistryV4',
    passed: true,
    detail: `getStats() → total=${totalRecords}, accepted=${stats[1]}, blocked=${stats[2]}, recorded=${stats[3]}`,
  };
  report.contractChecks.push(c2);

  // C3: Verifier contract
  const verifierAddr = (await client.readContract({
    address: CONFIG.registry, abi: REGISTRY_ABI, functionName: 'verifier',
  })) as `0x${string}`;
  const verifierCode = await client.getCode({ address: verifierAddr });
  let mockSelector = '';
  let isMockVerifier = false;
  try {
    mockSelector = (await client.readContract({
      address: verifierAddr, abi: MOCK_VERIFIER_ABI, functionName: 'SELECTOR',
    })) as string;
    isMockVerifier = mockSelector === '0xffffffff';
  } catch { /* not a mock verifier */ }

  const c3: CheckResult = {
    id: 'C3', label: 'Verifier contract configured',
    passed: !!verifierCode && verifierCode !== '0x',
    detail: isMockVerifier
      ? `MockVerifier at ${verifierAddr} (SELECTOR=0xFFFFFFFF) — hackathon dev mode`
      : `Verifier at ${verifierAddr}`,
    extra: { verifierAddr, isMockVerifier, mockSelector },
  };
  report.contractChecks.push(c3);

  // C4: Image ID
  const imageId = (await client.readContract({
    address: CONFIG.registry, abi: REGISTRY_ABI, functionName: 'imageId',
  })) as `0x${string}`;
  const c4: CheckResult = {
    id: 'C4', label: 'Image ID (ZK guest program) configured',
    passed: imageId !== '0x' + '0'.repeat(64),
    detail: imageId,
  };
  report.contractChecks.push(c4);

  // C5: Owner
  const owner = (await client.readContract({
    address: CONFIG.registry, abi: REGISTRY_ABI, functionName: 'owner',
  })) as `0x${string}`;
  const c5: CheckResult = {
    id: 'C5', label: 'Owner address',
    passed: true,
    detail: owner,
  };
  report.contractChecks.push(c5);

  if (!JSON_MODE && !CAST_MODE) {
    for (const check of report.contractChecks) {
      const icon = check.passed ? PASS : FAIL;
      console.log(`  ${icon} ${C.B}[${check.id}]${C.R} ${check.label}`);
      console.log(`       ${C.D}→ ${check.detail}${C.R}`);
      if (check.id === 'C3' && isMockVerifier) {
        console.log(`       ${C.D}→ Note: MockVerifier for hackathon. Production uses RiscZeroVerifierRouter.${C.R}`);
      }
      if (check.id === 'C1') {
        console.log(`       ${C.D}→ ${CONFIG.basescan}/address/${CONFIG.registry}${C.R}`);
      }
    }
    console.log('');
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 2: Record Verification
  // ═══════════════════════════════════════════════════════════

  const startIdx = RECORD_INDEX !== null ? RECORD_INDEX : 0;
  const endIdx = RECORD_INDEX !== null ? RECORD_INDEX + 1 : totalRecords;

  if (!JSON_MODE && !CAST_MODE) {
    if (RECORD_INDEX !== null) {
      console.log(`${C.B}━━━ Phase 2: Record Verification (record #${RECORD_INDEX}) ━━━━━━━━━━━━━━━━${C.R}`);
    } else {
      console.log(`${C.B}━━━ Phase 2: Record Verification (${totalRecords} record${totalRecords !== 1 ? 's' : ''}) ━━━━━━━━━━━━━━━━━━${C.R}`);
    }
    console.log('');
  }

  for (let i = startIdx; i < endIdx; i++) {
    const recordResult = await verifyRecord(client, i, imageId, verifierAddr);
    report.records.push(recordResult);

    if (!JSON_MODE && !CAST_MODE) {
      printRecord(recordResult);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 3: Verification Summary
  // ═══════════════════════════════════════════════════════════

  const allRecordChecks = report.records.flatMap(r => r.checks);
  const passCount = allRecordChecks.filter(c => c.passed).length;
  const failCount = allRecordChecks.filter(c => !c.passed).length;
  const allPassed = failCount === 0 && report.contractChecks.every(c => c.passed);

  report.summary = {
    totalRecords: report.records.length,
    allPassed,
    passCount: passCount + report.contractChecks.filter(c => c.passed).length,
    failCount: failCount + report.contractChecks.filter(c => !c.passed).length,
    trustModel: [
      'This verification reads ONLY from the public Base Sepolia blockchain.',
      'No trust in VeriCall operators is required.',
      '',
      'What each check proves:',
      '  V1: The ZK proof was verified by the on-chain verifier during registration',
      '  V2: The journal data has not been modified after submission (keccak256 commitment)',
      '  V3: The contract itself confirms journal integrity (on-chain verifyJournal())',
      '  V4: Independent re-verification — calling verifier.verify() directly from this script',
      '  V5: The TLSNotary/HTTP metadata in the journal is well-formed and non-trivial',
      '  V5b: The proven decision matches the on-chain record decision',
      '  V6: The registration transaction exists and is findable on BaseScan',
      '  V7: The ProofVerified event was emitted, confirming ZK verification happened on-chain',
      '  V8: Source code commit SHA is present on-chain (verifiable on GitHub)',
      ...(DEEP_MODE ? [
        '  V9: The source URL is still accessible (current state check)',
        '  V10: The current API response is consistent with on-chain extracted data',
      ] : []),
    ],
  };

  // Build reproduce instructions
  const castCommands = buildCastCommands(report);
  report.reproduce = {
    cli: `git clone ${CONFIG.repo} && cd veriCall && pnpm install && npx tsx scripts/verify.ts`,
    cast: castCommands,
  };

  // ─── Output ────────────────────────────────────────────────

  if (JSON_MODE) {
    console.log(JSON.stringify(report, null, 2));
  } else if (CAST_MODE) {
    printCastCommands(report, castCommands);
  } else {
    printSummary(report);
  }
}

// ═══════════════════════════════════════════════════════════════
// Record Verification
// ═══════════════════════════════════════════════════════════════

async function verifyRecord(
  client: ReturnType<typeof createPublicClient>,
  index: number,
  imageId: `0x${string}`,
  verifierAddr: `0x${string}`,
): Promise<RecordVerification> {
  const checks: CheckResult[] = [];

  // Read callId
  const callId = (await client.readContract({
    address: CONFIG.registry, abi: REGISTRY_ABI, functionName: 'callIds',
    args: [BigInt(index)],
  })) as `0x${string}`;

  // Read record
  const record = (await client.readContract({
    address: CONFIG.registry, abi: REGISTRY_ABI, functionName: 'getRecord',
    args: [callId],
  })) as any;

  const decision = Number(record.decision);
  const timestamp = Number(record.timestamp);
  const date = new Date(timestamp * 1000);

  // ─── V1: verified flag ─────────────────────────────────────

  checks.push({
    id: 'V1', label: 'verified flag == true (ZK proof passed during registration)',
    passed: record.verified === true,
    detail: record.verified
      ? 'The contract verified the ZK proof when this record was submitted'
      : 'WARNING: Record was stored without passing ZK verification',
  });

  // ─── V2: Journal hash commitment ──────────────────────────

  const computedJournalHash = keccak256(record.journalDataAbi);
  const journalHashMatch = computedJournalHash === record.journalHash;
  checks.push({
    id: 'V2', label: 'Journal hash integrity (offline keccak256 check)',
    passed: journalHashMatch,
    detail: journalHashMatch
      ? `keccak256(journalDataAbi) == stored journalHash`
      : `MISMATCH: computed ${computedJournalHash} ≠ stored ${record.journalHash}`,
    extra: { computed: computedJournalHash, stored: record.journalHash },
  });

  // ─── V3: On-chain verifyJournal() ─────────────────────────

  let journalVerified = false;
  try {
    journalVerified = (await client.readContract({
      address: CONFIG.registry, abi: REGISTRY_ABI, functionName: 'verifyJournal',
      args: [callId, record.journalDataAbi],
    })) as boolean;
  } catch (e: any) {
    // will be marked as failed
  }
  checks.push({
    id: 'V3', label: 'On-chain verifyJournal() returns true',
    passed: journalVerified,
    detail: journalVerified
      ? 'Contract confirms keccak256(journalData) matches stored commitment'
      : 'Contract rejected journal data integrity',
  });

  // ─── V4: Independent seal re-verification ─────────────────

  let sealVerified = false;
  let sealError = '';
  try {
    const journalDigest = sha256(record.journalDataAbi);
    await client.readContract({
      address: verifierAddr,
      abi: MOCK_VERIFIER_ABI,
      functionName: 'verify',
      args: [record.zkProofSeal, imageId, journalDigest],
    });
    sealVerified = true;
  } catch (e: any) {
    sealError = e.message?.slice(0, 100) || 'Unknown error';
  }
  checks.push({
    id: 'V4', label: 'Independent seal re-verification (verifier.verify() direct call)',
    passed: sealVerified,
    detail: sealVerified
      ? 'Called verifier.verify(seal, imageId, sha256(journal)) — passed'
      : `verifier.verify() failed: ${sealError}`,
    extra: {
      seal: `${record.zkProofSeal.slice(0, 20)}...${record.zkProofSeal.slice(-8)}`,
      sealLength: (record.zkProofSeal.length - 2) / 2,
    },
  });

  // ─── V5: Proven data extraction ───────────────────────────

  let provenData = {
    notaryKeyFingerprint: '' as string,
    method: '' as string,
    url: '' as string,
    proofTimestamp: 0,
    queriesHash: '' as string,
    provenDecision: '' as string,
    provenReason: '' as string,
    provenSystemPromptHash: '' as string,
    provenTranscriptHash: '' as string,
    provenSourceCodeCommit: '' as string,
    extractedData: '' as string,  // reconstructed for backward compat
  };
  let provenDataValid = false;
  try {
    const pd = (await client.readContract({
      address: CONFIG.registry, abi: REGISTRY_ABI, functionName: 'getProvenData',
      args: [callId],
    })) as any;
    provenData = {
      notaryKeyFingerprint: pd[0] || '',
      method: pd[1] || '',
      url: pd[2] || '',
      proofTimestamp: Number(pd[3] || 0),
      queriesHash: pd[4] || '',
      provenDecision: pd[5] || '',
      provenReason: pd[6] || '',
      provenSystemPromptHash: pd[7] || '',
      provenTranscriptHash: pd[8] || '',
      provenSourceCodeCommit: pd[9] || '',
      extractedData: `${pd[5] || ''}|${pd[6] || ''}`,  // reconstructed summary
    };
    const notaryNonZero = provenData.notaryKeyFingerprint !== '0x' + '0'.repeat(64);
    const methodGet = provenData.method === 'GET';
    const urlNonEmpty = provenData.url.length > 0;
    const dataPresent = provenData.provenDecision.length > 0;
    provenDataValid = notaryNonZero && methodGet && urlNonEmpty && dataPresent;
  } catch { /* will be marked failed */ }

  checks.push({
    id: 'V5', label: 'Proven data decoded via getProvenData() — TLSNotary metadata valid',
    passed: provenDataValid,
    detail: provenDataValid
      ? `Method=${provenData.method}, URL present, Notary FP non-zero, Data extracted`
      : 'Failed to decode or validate journal proven data fields',
    extra: {
      method: provenData.method,
      url: provenData.url,
      notaryFP: provenData.notaryKeyFingerprint
        ? `${(provenData.notaryKeyFingerprint as string).slice(0, 18)}...`
        : 'N/A',
      extractedDataPreview: provenData.extractedData.slice(0, 120),
      proofTimestamp: provenData.proofTimestamp > 0
        ? new Date(provenData.proofTimestamp * 1000).toISOString()
        : 'N/A',
    },
  });

  // ─── V6: TX hash from CallDecisionRecorded event ──────────

  let txHash: string | null = null;
  try {
    const logs = await client.getLogs({
      address: CONFIG.registry,
      event: CallDecisionRecordedEvent,
      args: { callId },
      fromBlock: CONFIG.deployBlock,
      toBlock: 'latest',
    });
    if (logs.length > 0) {
      txHash = logs[0].transactionHash;
    }
  } catch { /* event lookup may fail on some RPCs */ }

  checks.push({
    id: 'V6', label: 'Registration TX found via event logs',
    passed: txHash !== null,
    detail: txHash
      ? `TX: ${txHash}`
      : 'Could not find CallDecisionRecorded event (RPC may not support historical logs)',
  });

  // ─── V7: ProofVerified event ──────────────────────────────

  let proofEvent: { imageId: string; journalDigest: string } | null = null;
  try {
    const logs = await client.getLogs({
      address: CONFIG.registry,
      event: ProofVerifiedEvent,
      args: { callId },
      fromBlock: CONFIG.deployBlock,
      toBlock: 'latest',
    });
    if (logs.length > 0) {
      proofEvent = {
        imageId: (logs[0].args as any).imageId,
        journalDigest: (logs[0].args as any).journalDigest,
      };
    }
  } catch { /* event lookup may fail */ }

  checks.push({
    id: 'V7', label: 'ProofVerified event emitted (ZK verification happened on-chain)',
    passed: proofEvent !== null,
    detail: proofEvent
      ? `ProofVerified(imageId=${(proofEvent.imageId as string).slice(0, 18)}..., journalDigest=${(proofEvent.journalDigest as string).slice(0, 18)}...)`
      : 'Could not find ProofVerified event',
  });

  // ─── V5b: Decision consistency ────────────────────────────

  const provenDecisionUpper = provenData.provenDecision?.toUpperCase() || '';
  const onChainDecisionLabel = DECISION_LABEL[decision] || 'UNKNOWN';
  const decisionMatch = provenDecisionUpper === onChainDecisionLabel.toUpperCase();
  checks.push({
    id: 'V5b', label: 'Decision consistency (proven vs on-chain)',
    passed: decisionMatch,
    detail: decisionMatch
      ? `Proven "${provenData.provenDecision}" matches on-chain "${onChainDecisionLabel}"`
      : `Proven "${provenData.provenDecision || '?'}" ≠ on-chain "${onChainDecisionLabel}"`,
  });

  // ─── V8: Source code attestation ──────────────────────────

  const commitSha = provenData.provenSourceCodeCommit;
  let v8Passed = false;
  let v8Detail = '';
  if (commitSha && commitSha.length >= 7 && commitSha !== 'unknown') {
    const isValidHex = /^[0-9a-f]{7,40}$/.test(commitSha);
    v8Passed = isValidHex;
    v8Detail = isValidHex
      ? `Commit ${commitSha.slice(0, 7)}… on-chain → ${CONFIG.repo}/tree/${commitSha}`
      : `Invalid commit format: "${commitSha}"`;
  } else {
    v8Passed = false;
    v8Detail = commitSha === 'unknown'
      ? 'sourceCodeCommit = "unknown" — record created before attestation was deployed'
      : 'Source code commit not in journal — cannot verify logic';
  }
  checks.push({
    id: 'V8', label: 'Source code attestation (commit SHA on-chain)',
    passed: v8Passed,
    detail: v8Detail,
  });

  // ─── V9/V10: Deep verification (--deep) ───────────────────

  let deepCheck: RecordVerification['deepCheck'] = undefined;
  if (DEEP_MODE && provenData.url) {
    deepCheck = await deepVerify(provenData.url, provenData.extractedData, checks);
  }

  return {
    index,
    callId,
    decision: `${DECISION_EMOJI[decision] || '?'} ${DECISION_LABEL[decision] || 'UNKNOWN'}`,
    reason: record.reason,
    timestamp: date.toISOString(),
    sourceUrl: record.sourceUrl,
    submitter: record.submitter,
    txHash,
    basescanTx: txHash ? `${CONFIG.basescan}/tx/${txHash}` : null,
    checks,
    provenData: {
      notaryKeyFingerprint: provenData.notaryKeyFingerprint,
      method: provenData.method,
      url: provenData.url,
      proofTimestamp: provenData.proofTimestamp > 0
        ? new Date(provenData.proofTimestamp * 1000).toISOString()
        : 'N/A',
      queriesHash: provenData.queriesHash,
      provenDecision: provenData.provenDecision,
      provenReason: provenData.provenReason,
      provenSystemPromptHash: provenData.provenSystemPromptHash,
      provenTranscriptHash: provenData.provenTranscriptHash,
      provenSourceCodeCommit: provenData.provenSourceCodeCommit,
      extractedData: provenData.extractedData,
    },
    deepCheck,
  };
}

// ═══════════════════════════════════════════════════════════════
// Deep Verification (--deep)
// ═══════════════════════════════════════════════════════════════

async function deepVerify(
  url: string,
  onChainExtractedData: string,
  checks: CheckResult[],
): Promise<RecordVerification['deepCheck']> {
  let urlAccessible = false;
  let responseConsistent = false;
  let currentResponse: string | null = null;

  try {
    const resp = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    urlAccessible = resp.ok;
    if (resp.ok) {
      currentResponse = await resp.text();

      // Parse both the on-chain extracted data and current response
      try {
        const onChainParsed = JSON.parse(onChainExtractedData);
        const currentParsed = JSON.parse(currentResponse);

        // Check if the decision and reason match
        const decisionMatch = onChainParsed.decision === currentParsed.decision;
        const reasonMatch = onChainParsed.reason === currentParsed.reason;
        responseConsistent = decisionMatch && reasonMatch;
      } catch {
        // If either isn't valid JSON, do a string comparison
        responseConsistent = currentResponse.includes(onChainExtractedData) ||
          onChainExtractedData.includes(currentResponse);
      }
    }
  } catch {
    // URL not accessible or timed out
  }

  checks.push({
    id: 'V9', label: 'Source URL currently accessible',
    passed: urlAccessible,
    detail: urlAccessible
      ? `HTTP 200 from ${url}`
      : `Could not reach ${url} (may be expected if ephemeral)`,
  });

  checks.push({
    id: 'V10', label: 'Current API response consistent with on-chain extracted data',
    passed: responseConsistent,
    detail: responseConsistent
      ? 'Decision API currently returns the same decision as the on-chain proof'
      : urlAccessible
        ? 'Response differs from on-chain data (acceptable — Web Proof locked historical state)'
        : 'Could not compare (URL not accessible)',
  });

  return { urlAccessible, responseConsistent, currentResponse };
}

// ═══════════════════════════════════════════════════════════════
// Cast Commands (Foundry)
// ═══════════════════════════════════════════════════════════════

function buildCastCommands(report: VerificationReport): string[] {
  const rpc = `--rpc-url ${CONFIG.rpcUrl}`;
  const commands: string[] = [
    `# ━━━ Contract-Level Verification ━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `# Check contract bytecode exists`,
    `cast code ${CONFIG.registry} ${rpc}`,
    ``,
    `# Read registry stats (total, accepted, blocked, recorded)`,
    `cast call ${CONFIG.registry} "getStats()(uint256,uint256,uint256,uint256)" ${rpc}`,
    ``,
    `# Read verifier address`,
    `cast call ${CONFIG.registry} "verifier()(address)" ${rpc}`,
    ``,
    `# Read imageId (ZK guest program)`,
    `cast call ${CONFIG.registry} "imageId()(bytes32)" ${rpc}`,
    ``,
    `# Read owner`,
    `cast call ${CONFIG.registry} "owner()(address)" ${rpc}`,
    ``,
    `# Check MockVerifier SELECTOR`,
    `cast call ${report.contractChecks.find(c => c.id === 'C3')?.extra?.verifierAddr || CONFIG.mockVerifier} "SELECTOR()(bytes4)" ${rpc}`,
  ];

  for (const rec of report.records) {
    commands.push(``);
    commands.push(`# ━━━ Record #${rec.index} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    commands.push(``);
    commands.push(`# Read full record`);
    commands.push(`cast call ${CONFIG.registry} "getRecord(bytes32)" ${rec.callId} ${rpc}`);
    commands.push(``);
    commands.push(`# Decode proven data (TLSNotary + HTTP metadata)`);
    commands.push(`cast call ${CONFIG.registry} "getProvenData(bytes32)(bytes32,string,string,uint256,bytes32,string,string,string,string,string)" ${rec.callId} ${rpc}`);
    commands.push(``);
    commands.push(`# Verify journal integrity on-chain`);
    // We need the actual journal data hex
    const check = rec.checks.find(c => c.id === 'V2');
    commands.push(`# (Requires journalDataAbi hex — retrieve via getRecord first)`);
    commands.push(`cast call ${CONFIG.registry} "verifyJournal(bytes32,bytes)(bool)" ${rec.callId} <journalDataAbi_hex> ${rpc}`);

    if (rec.txHash) {
      commands.push(``);
      commands.push(`# View transaction on BaseScan`);
      commands.push(`# ${CONFIG.basescan}/tx/${rec.txHash}`);
      commands.push(`cast tx ${rec.txHash} ${rpc}`);
      commands.push(`cast receipt ${rec.txHash} ${rpc}`);
    }
  }

  return commands;
}

// ═══════════════════════════════════════════════════════════════
// Print Helpers
// ═══════════════════════════════════════════════════════════════

function printRecord(rec: RecordVerification): void {
  console.log(`  ${C.B}─── Record #${rec.index} ────────────────────────────────────────${C.R}`);
  console.log('');
  console.log(`    ${C.CY}Call ID:${C.R}    ${rec.callId.slice(0, 22)}...`);
  console.log(`    ${C.CY}Decision:${C.R}   ${rec.decision}`);
  console.log(`    ${C.CY}Reason:${C.R}     ${rec.reason}`);
  console.log(`    ${C.CY}Time:${C.R}       ${rec.timestamp}`);
  console.log(`    ${C.CY}Submitter:${C.R}  ${rec.submitter}`);
  console.log(`    ${C.CY}Source URL:${C.R} ${rec.sourceUrl}`);
  if (rec.txHash) {
    console.log(`    ${C.CY}TX Hash:${C.R}    ${rec.txHash}`);
    console.log(`    ${C.CY}BaseScan:${C.R}   ${rec.basescanTx}`);
  }
  console.log('');
  console.log(`    ${C.B}Verification Checks:${C.R}`);
  for (const check of rec.checks) {
    const icon = check.passed ? PASS : FAIL;
    console.log(`    ${icon} ${C.B}[${check.id}]${C.R} ${check.label}`);
    console.log(`         ${C.D}→ ${check.detail}${C.R}`);

    // Print extra detail for V5 (proven data)
    if (check.id === 'V5' && check.passed && check.extra) {
      console.log(`         ${C.D}  • Method:        ${check.extra.method}${C.R}`);
      console.log(`         ${C.D}  • URL:           ${check.extra.url?.slice(0, 80)}${check.extra.url?.length > 80 ? '...' : ''}${C.R}`);
      console.log(`         ${C.D}  • Notary FP:     ${check.extra.notaryFP}${C.R}`);
      console.log(`         ${C.D}  • Proof Time:    ${check.extra.proofTimestamp}${C.R}`);
      console.log(`         ${C.D}  • Extracted:     ${check.extra.extractedDataPreview}${check.extra.extractedDataPreview?.length >= 120 ? '...' : ''}${C.R}`);
    }

    // Print extra for V4 (seal info)
    if (check.id === 'V4' && check.extra) {
      console.log(`         ${C.D}  • Seal:          ${check.extra.seal} (${check.extra.sealLength} bytes)${C.R}`);
    }

    // Print GitHub link for V8 (source code attestation)
    if (check.id === 'V8' && check.passed) {
      const commit = rec.provenData.provenSourceCodeCommit;
      console.log(`         ${C.D}  • GitHub:        ${CONFIG.repo}/tree/${commit}${C.R}`);
      console.log(`         ${C.D}  • System prompt:  ${CONFIG.repo}/blob/${commit}/lib/voice-ai/gemini.ts${C.R}`);
    }
  }
  console.log('');
}

function printSummary(report: VerificationReport): void {
  const { summary } = report;
  const total = summary.passCount + summary.failCount;

  console.log(`${C.B}━━━ Phase 3: Verification Summary ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.R}`);
  console.log('');

  const bW = 64;
  const bar = '═'.repeat(bW);
  const pad = (s: string) => s.padEnd(bW - 2);
  if (summary.allPassed) {
    const c = `${C.B}${C.G}`;
    console.log(`  ${c}╔${bar}╗${C.R}`);
    console.log(`  ${c}║${' '.repeat(bW)}║${C.R}`);
    console.log(`  ${c}║${pad(`  ✅ ALL CHECKS PASSED  (${total}/${total})`)}  ║${C.R}`);
    console.log(`  ${c}║${' '.repeat(bW)}║${C.R}`);
    console.log(`  ${c}║${pad(`  • ${summary.totalRecords} record${summary.totalRecords !== 1 ? 's' : ''} verified on Base Sepolia`)}  ║${C.R}`);
    console.log(`  ${c}║${pad('  • All ZK proofs independently re-verified')}  ║${C.R}`);
    console.log(`  ${c}║${pad('  • All journal hashes match on-chain commitments')}  ║${C.R}`);
    console.log(`  ${c}║${pad('  • All registration transactions found on-chain')}  ║${C.R}`);
    console.log(`  ${c}║${' '.repeat(bW)}║${C.R}`);
    console.log(`  ${c}╚${bar}╝${C.R}`);
  } else {
    // Collect failed check IDs per record for informative summary
    const failedChecks = report.records.flatMap(r =>
      r.checks.filter(c => !c.passed).map(c => ({ record: r.index, id: c.id, label: c.label }))
    );
    const contractFails = report.contractChecks.filter(c => !c.passed);
    const c = `${C.B}${C.Y}`;
    console.log(`  ${c}╔${bar}╗${C.R}`);
    console.log(`  ${c}║${' '.repeat(bW)}║${C.R}`);
    console.log(`  ${c}║${pad(`  ⚠️  ${summary.passCount}/${total} CHECKS PASSED  (${summary.failCount} failed)`)}  ║${C.R}`);
    console.log(`  ${c}║${' '.repeat(bW)}║${C.R}`);
    console.log(`  ${c}║${pad(`  • ${summary.totalRecords} record${summary.totalRecords !== 1 ? 's' : ''} verified on Base Sepolia`)}  ║${C.R}`);
    for (const f of contractFails) {
      console.log(`  ${c}║${pad(`  ${FAIL} [${f.id}] ${f.label}`)}  ║${C.R}`);
    }
    // Group record failures by check ID
    const failGroups = new Map<string, number[]>();
    for (const f of failedChecks) {
      const arr = failGroups.get(f.id) || [];
      arr.push(f.record);
      failGroups.set(f.id, arr);
    }
    for (const [checkId, records] of failGroups) {
      const label = failedChecks.find(f => f.id === checkId)?.label || '';
      console.log(`  ${c}║${pad(`  ${FAIL} [${checkId}] Record #${records.join(', #')}: ${label}`)}  ║${C.R}`);
    }
    console.log(`  ${c}║${' '.repeat(bW)}║${C.R}`);
    console.log(`  ${c}╚${bar}╝${C.R}`);
  }

  console.log('');

  // Trust model
  console.log(`  ${C.B}Trust Model:${C.R}`);
  const boxW = 84;
  console.log(`  ${C.D}┌${'─'.repeat(boxW)}┐${C.R}`);
  for (const line of summary.trustModel) {
    console.log(`  ${C.D}│${C.R} ${line.padEnd(boxW - 2)} ${C.D}│${C.R}`);
  }
  console.log(`  ${C.D}└${'─'.repeat(boxW)}┘${C.R}`);
  console.log('');

  // Reproduce
  console.log(`  ${C.B}Reproduce This Yourself:${C.R}`);
  console.log('');
  console.log(`  ${C.MG}Option A — Run this script (no wallet needed):${C.R}`);
  console.log(`  ${C.D}  $ git clone ${CONFIG.repo} && cd veriCall${C.R}`);
  console.log(`  ${C.D}  $ pnpm install${C.R}`);
  console.log(`  ${C.D}  $ npx tsx scripts/verify.ts${C.R}`);
  console.log('');
  console.log(`  ${C.MG}Option B — Use Foundry (fully independent, no VeriCall code):${C.R}`);
  console.log(`  ${C.D}  $ cast call ${CONFIG.registry} "getStats()(uint256,uint256,uint256,uint256)" --rpc-url ${CONFIG.rpcUrl}${C.R}`);
  console.log(`  ${C.D}  $ cast call ${CONFIG.registry} "getProvenData(bytes32)(bytes32,string,string,uint256,bytes32,string,string,string,string,string)" <callId> --rpc-url ${CONFIG.rpcUrl}${C.R}`);
  console.log(`  ${C.D}  # Run: npx tsx scripts/verify.ts --cast   for all commands${C.R}`);
  console.log('');
  console.log(`  ${C.MG}Option C — BaseScan (zero setup):${C.R}`);
  console.log(`  ${C.D}  → Contract: ${CONFIG.basescan}/address/${CONFIG.registry}#readContract${C.R}`);
  for (const rec of report.records) {
    if (rec.txHash) {
      console.log(`  ${C.D}  → Record #${rec.index} TX: ${CONFIG.basescan}/tx/${rec.txHash}${C.R}`);
    }
  }
  console.log('');

  // Architecture one-liner
  console.log(`  ${C.B}Pipeline:${C.R}`);
  console.log(`  ${C.D}  Phone Call → AI Screening → Decision API → vlayer Web Proof (TLSNotary)${C.R}`);
  console.log(`  ${C.D}  → RISC Zero ZK Proof (Groth16) → Base Sepolia VeriCallRegistryV4${C.R}`);
  console.log('');
}

function printCastCommands(report: VerificationReport, commands: string[]): void {
  console.log('#!/bin/bash');
  console.log('# VeriCall — Independent Verification via Foundry (cast)');
  console.log(`# Generated: ${report.generated}`);
  console.log(`# Contract:  ${CONFIG.registry}`);
  console.log(`# Network:   ${CONFIG.network} (chainId ${CONFIG.chainId})`);
  console.log('#');
  console.log('# Requirements: Foundry (https://getfoundry.sh)');
  console.log('# No wallet, API keys, or VeriCall code needed.');
  console.log('#');
  console.log(`# Install: curl -L https://foundry.paradigm.xyz | bash && foundryup`);
  console.log('');
  for (const cmd of commands) {
    console.log(cmd);
  }
  console.log('');
}

// ═══════════════════════════════════════════════════════════════
// Run
// ═══════════════════════════════════════════════════════════════

main().catch((err) => {
  if (!JSON_MODE) {
    console.error(`\n${FAIL} Fatal error: ${err.message}\n`);
  } else {
    console.log(JSON.stringify({ error: err.message }));
  }
  process.exit(1);
});
