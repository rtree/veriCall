/**
 * Witness Pipeline — Core Logic
 *
 * Orchestrates: Web Proof → ZK Proof → Base Sepolia on-chain.
 * Shared by session.ts (server-side) and vlayer-client.ts (API routes).
 *
 * This module lives in lib/ so it's resolvable from both
 * the custom server (server.ts / tsx) and Next.js app router.
 */

import crypto from 'crypto';
import { vlayerConfig } from '@/lib/config';
import {
  generateWebProof as vlayerWebProof,
  compressToZKProof as vlayerZKProof,
} from '@/lib/witness/vlayer-api';
import { submitDecisionOnChain } from '@/lib/witness/on-chain';
import { demoBus } from '@/lib/demo/event-bus';

// ─── Types (duplicated here to avoid cross-boundary imports) ──

export type ProofStatus =
  | 'pending'
  | 'web-proof'
  | 'zk-proof'
  | 'on-chain'
  | 'failed';

export interface WitnessRecord {
  id: string;
  callSid: string;
  createdAt: string;
  status: ProofStatus;
  webProof?: { proofId: string; generatedAt: string };
  zkProof?: { hash: string; generatedAt: string };
  onChain?: {
    txHash: string;
    blockNumber: number;
    contractAddress?: string;
    submittedAt: string;
  };
  error?: string;
}

export interface DecisionData {
  callId: string;
  timestamp: string;
  action: string;
  reason: string;
  confidence: number;
}

// ─── In-memory store ──────────────────────────────────────────

const records = new Map<string, WitnessRecord>();

function saveRecord(record: WitnessRecord): void {
  records.set(record.id, record);
  console.log('⛓️ Witness recorded:', record.id, record.status);
}

function updateStatus(
  id: string,
  status: ProofStatus,
  data?: Partial<WitnessRecord>,
): void {
  const record = records.get(id);
  if (record) {
    record.status = status;
    if (data) Object.assign(record, data);
    records.set(id, record);
  }
}

export function getRecord(id: string): WitnessRecord | undefined {
  return records.get(id);
}

export function getByCallSid(callSid: string): WitnessRecord | undefined {
  return Array.from(records.values()).find((r) => r.callSid === callSid);
}

export function getAllRecords(): WitnessRecord[] {
  return Array.from(records.values());
}

// ─── Configuration ────────────────────────────────────────────

/**
 * Build the Web Proof source URL for a given call.
 * Points to our own /api/witness/decision/[callSid] endpoint,
 * so vlayer TLSNotary proves THIS server returned this decision.
 */
function getProofSourceUrl(callSid: string): string {
  const base =
    process.env.VLAYER_PROOF_SOURCE_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    'https://vericall-kkz6k4jema-uc.a.run.app';
  return `${base}/api/witness/decision/${callSid}`;
}

const PROOF_JMESPATH = (
  process.env.VLAYER_PROOF_JMESPATH || 'decision,reason,systemPromptHash,transcriptHash'
).split(',');

const DECISION_MAP: Record<string, number> = {
  ACCEPT: 1,
  BLOCK: 2,
  RECORD: 3,
};

// ─── Public API ───────────────────────────────────────────────

/** Hash a phone number for privacy (SHA-256, truncated) */
export function hashPhoneNumber(phone: string): string {
  return crypto
    .createHash('sha256')
    .update(phone)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Create a new witness for a call decision.
 * Returns immediately; the proof pipeline runs in the background.
 */
export async function createWitness(
  callSid: string,
  decisionData: DecisionData,
): Promise<WitnessRecord> {
  const id = `wit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const record: WitnessRecord = {
    id,
    callSid,
    createdAt: new Date().toISOString(),
    status: 'pending',
  };

  saveRecord(record);

  // Fire-and-forget — never blocks the phone call
  processWitnessAsync(record, decisionData).catch((err) => {
    console.error(`⛓️ [Witness ${id}] Pipeline failed:`, err);
    updateStatus(id, 'failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return record;
}

// ─── Pipeline ─────────────────────────────────────────────────

async function processWitnessAsync(
  record: WitnessRecord,
  data: DecisionData,
): Promise<void> {
  const tag = `⛓️ [Witness ${record.id}]`;

  demoBus.emitDemo('witness:start', record.callSid, {
    witnessId: record.id,
    decision: data.action,
    reason: data.reason,
  });

  if (!vlayerConfig.apiKey) {
    console.log(`${tag} VLAYER_API_KEY not set — skipping proof pipeline`);
    updateStatus(record.id, 'failed', {
      error: 'VLAYER_API_KEY not configured',
    });
    return;
  }

  // Step 1: Web Proof (prove our own decision API via TLSNotary)
  const proofUrl = getProofSourceUrl(record.callSid);
  console.log(`${tag} Step 1/3: Generating Web Proof from ${proofUrl}`);
  const webProof = await vlayerWebProof(proofUrl);
  updateStatus(record.id, 'web-proof', {
    webProof: {
      proofId: `wp_${Date.now()}`,
      generatedAt: new Date().toISOString(),
    },
  });
  console.log(`${tag} ✅ Web Proof generated (${webProof.data.length} chars)`);
  demoBus.emitDemo('witness:web-proof', record.callSid, {
    witnessId: record.id,
    proofSize: webProof.data.length,
    sourceUrl: proofUrl,
  });

  // Step 2: ZK Proof
  console.log(
    `${tag} Step 2/3: Compressing to ZK Proof [${PROOF_JMESPATH.join(', ')}]`,
  );
  const { zkProof, journalDataAbi } = await vlayerZKProof(
    webProof,
    PROOF_JMESPATH,
  );
  const proofHash = crypto
    .createHash('sha256')
    .update(zkProof)
    .digest('hex')
    .slice(0, 16);
  updateStatus(record.id, 'zk-proof', {
    zkProof: { hash: proofHash, generatedAt: new Date().toISOString() },
  });
  console.log(`${tag} ✅ ZK Proof compressed (seal hash: ${proofHash})`);
  demoBus.emitDemo('witness:zk-proof', record.callSid, {
    witnessId: record.id,
    sealHash: proofHash,
  });

  // Step 3: On-Chain
  const decisionNum = DECISION_MAP[data.action] || 0;
  if (decisionNum === 0) {
    console.warn(
      `${tag} Unknown decision "${data.action}" — skipping on-chain`,
    );
    return;
  }

  console.log(
    `${tag} Step 3/3: Submitting to Base Sepolia (decision=${data.action})`,
  );

  try {
    const result = await submitDecisionOnChain({
      callSid: record.callSid,
      decision: decisionNum,
      reason: data.reason,    // must match journal's provenReason exactly
      zkProofSeal: zkProof,
      journalDataAbi,
    });

    updateStatus(record.id, 'on-chain', {
      onChain: {
        txHash: result.txHash,
        blockNumber: result.blockNumber,
        contractAddress: result.contractAddress,
        submittedAt: new Date().toISOString(),
      },
    });

    console.log(`${tag} ✅ On-chain! TX: ${result.txHash}`);
    console.log(
      `${tag} 🔗 https://sepolia.basescan.org/tx/${result.txHash}`,
    );
    demoBus.emitDemo('witness:on-chain', record.callSid, {
      witnessId: record.id,
      txHash: result.txHash,
      blockNumber: result.blockNumber,
    });
  } catch (err) {
    console.error(`${tag} ❌ On-chain submission failed:`, err);
    demoBus.emitDemo('witness:failed', record.callSid, {
      witnessId: record.id,
      error: err instanceof Error ? err.message : String(err),
    });
    updateStatus(record.id, 'failed', {
      error: `On-chain failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
