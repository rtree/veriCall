import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getDecisionForProof } from '@/lib/witness/decision-store';

/**
 * GET /api/witness/decision/[callSid]
 *
 * Returns the AI screening decision for a specific call.
 * This endpoint is the TARGET of vlayer Web Proof attestation.
 *
 * vlayer TLSNotary proves via MPC that this server returned this exact JSON
 * response over TLS — creating a cryptographic attestation of the decision.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ callSid: string }> },
) {
  const { callSid } = await params;

  const record = await getDecisionForProof(callSid);
  if (!record) {
    return NextResponse.json(
      { error: 'Decision not found or expired' },
      { status: 404 },
    );
  }

  // Compute transcript hash (SHA-256) — only the hash is proven via ZK,
  // not the full transcript text, preserving privacy while enabling verification.
  const transcriptHash = crypto
    .createHash('sha256')
    .update(record.transcript)
    .digest('hex');

  // Return clean JSON that vlayer will attest via TLSNotary.
  // JMESPath extracts: ["decision", "reason", "systemPromptHash", "transcriptHash"]
  return NextResponse.json({
    service: 'VeriCall',
    version: '1.0',
    callSid: record.callSid,
    decision: record.decision,
    reason: record.reason,
    transcript: record.transcript,
    systemPromptHash: record.systemPromptHash,
    transcriptHash,
    callerHashShort: record.callerHashShort,
    timestamp: record.timestamp,
    conversationTurns: record.conversationTurns,
  });
}
