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

  // Return clean JSON that vlayer will attest via TLSNotary
  return NextResponse.json({
    service: 'VeriCall',
    version: '1.0',
    callSid: record.callSid,
    decision: record.decision,
    reason: record.reason,
    transcript: record.transcript,
    systemPromptHash: record.systemPromptHash,
    callerHashShort: record.callerHashShort,
    timestamp: record.timestamp,
    conversationTurns: record.conversationTurns,
  });
}
