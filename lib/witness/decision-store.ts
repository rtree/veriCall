/**
 * Decision Data Store — PostgreSQL (Cloud SQL)
 *
 * Stores call decision data in Cloud SQL so the
 * /api/witness/decision/[callSid] endpoint can serve it
 * for vlayer Web Proof verification.
 *
 * vlayer TLSNotary proves via MPC that THIS server returned THIS exact JSON
 * at a specific time — making the decision record tamper-proof after attestation.
 *
 * Auth: IAM (ADC) — no passwords.
 */

import crypto from 'crypto';
import { query } from '@/lib/db';
import { GeminiChat } from '@/lib/voice-ai/gemini';

// ─── Types ────────────────────────────────────────────────────

export interface DecisionRecord {
  callSid: string;
  decision: 'BLOCK' | 'RECORD';
  reason: string;
  transcript: string;
  systemPromptHash: string;
  callerHashShort: string;
  timestamp: string;
  conversationTurns: number;
}

// ─── Store ────────────────────────────────────────────────────

/**
 * Store a decision record for later Web Proof attestation.
 * Called from session.ts after AI makes its decision.
 */
export async function storeDecisionForProof(params: {
  callSid: string;
  decision: 'BLOCK' | 'RECORD';
  reason: string;
  transcript: string;
  callerHashShort: string;
  conversationTurns: number;
}): Promise<DecisionRecord> {
  const systemPromptHash = crypto
    .createHash('sha256')
    .update(GeminiChat.getSystemPrompt())
    .digest('hex');

  const now = new Date().toISOString();

  await query(
    `INSERT INTO decision_records
       (call_sid, decision, reason, transcript, system_prompt_hash,
        caller_hash_short, conversation_turns, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8::timestamptz + interval '1 hour')
     ON CONFLICT (call_sid) DO UPDATE SET
       decision = EXCLUDED.decision,
       reason = EXCLUDED.reason,
       transcript = EXCLUDED.transcript,
       system_prompt_hash = EXCLUDED.system_prompt_hash,
       caller_hash_short = EXCLUDED.caller_hash_short,
       conversation_turns = EXCLUDED.conversation_turns,
       created_at = EXCLUDED.created_at,
       expires_at = EXCLUDED.expires_at`,
    [
      params.callSid,
      params.decision,
      params.reason,
      params.transcript,
      systemPromptHash,
      params.callerHashShort,
      params.conversationTurns,
      now,
    ],
  );

  const record: DecisionRecord = {
    callSid: params.callSid,
    decision: params.decision,
    reason: params.reason,
    transcript: params.transcript,
    systemPromptHash,
    callerHashShort: params.callerHashShort,
    timestamp: now,
    conversationTurns: params.conversationTurns,
  };

  console.log(
    `📋 [DecisionStore] Stored decision for ${params.callSid}: ${params.decision} (Cloud SQL)`,
  );

  return record;
}

/**
 * Get a stored decision record by callSid.
 * Used by the /api/witness/decision/[callSid] endpoint.
 */
export async function getDecisionForProof(
  callSid: string,
): Promise<DecisionRecord | undefined> {
  const res = await query(
    `SELECT call_sid, decision, reason, transcript, system_prompt_hash,
            caller_hash_short, conversation_turns, created_at
     FROM decision_records
     WHERE call_sid = $1 AND expires_at > NOW()`,
    [callSid],
  );

  if (res.rows.length === 0) return undefined;

  const row = res.rows[0];
  return {
    callSid: row.call_sid,
    decision: row.decision,
    reason: row.reason,
    transcript: row.transcript,
    systemPromptHash: row.system_prompt_hash,
    callerHashShort: row.caller_hash_short,
    timestamp: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : String(row.created_at),
    conversationTurns: row.conversation_turns,
  };
}
