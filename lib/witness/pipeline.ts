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
  callerHash: string;
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

const PROOF_SOURCE_URL =
  process.env.VLAYER_PROOF_SOURCE_URL ||
  'https://data-api.binance.vision/api/v3/ticker/price?symbol=ETHUSDC';

const PROOF_JMESPATH = (
  process.env.VLAYER_PROOF_JMESPATH || 'price,symbol'
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

  if (!vlayerConfig.apiKey) {
    console.log(`${tag} VLAYER_API_KEY not set — skipping proof pipeline`);
    updateStatus(record.id, 'failed', {
      error: 'VLAYER_API_KEY not configured',
    });
    return;
  }

  // Step 1: Web Proof
  console.log(`${tag} Step 1/3: Generating Web Proof from ${PROOF_SOURCE_URL}`);
  const webProof = await vlayerWebProof(PROOF_SOURCE_URL);
  updateStatus(record.id, 'web-proof', {
    webProof: {
      proofId: `wp_${Date.now()}`,
      generatedAt: new Date().toISOString(),
    },
  });
  console.log(`${tag} ✅ Web Proof generated (${webProof.data.length} chars)`);

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
      callerPhone: data.callerHash,
      decision: decisionNum,
      reason: data.reason.slice(0, 200),
      zkProofSeal: zkProof,
      journalDataAbi,
      sourceUrl: PROOF_SOURCE_URL,
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
  } catch (err) {
    console.error(`${tag} ❌ On-chain submission failed:`, err);
    updateStatus(record.id, 'failed', {
      error: `On-chain failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
