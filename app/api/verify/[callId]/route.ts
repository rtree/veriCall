import { NextRequest, NextResponse } from 'next/server';
import { verifyDecisionOnChain, getDecisionLog } from '@/lib/decision-logger';

interface VerifyParams {
  params: Promise<{ callId: string }>;
}

/**
 * GET /api/verify/[callId]
 * 
 * Verify a call decision on-chain via Vlayer
 */
export async function GET(
  request: NextRequest,
  { params }: VerifyParams
) {
  const { callId } = await params;

  const log = getDecisionLog(callId);
  
  if (!log) {
    return NextResponse.json(
      { error: 'Call not found' },
      { status: 404 }
    );
  }

  const verification = await verifyDecisionOnChain(callId);

  return NextResponse.json({
    callId,
    decision: log.decision,
    timestamp: log.timestamp,
    verification: {
      verified: verification.verified,
      txHash: verification.txHash,
      error: verification.error,
    },
    vlayerProof: log.vlayerProof,
  });
}
