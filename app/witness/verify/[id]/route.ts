import { NextRequest, NextResponse } from 'next/server';
import { getRecord, getByCallSid } from '@/lib/witness/pipeline';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /witness/verify/[id]
 * 証明を検証
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  const { id } = await params;

  // IDまたはCallSidで検索
  let record = getRecord(id);
  if (!record) {
    record = getByCallSid(id);
  }

  if (!record) {
    return NextResponse.json(
      { error: 'Witness record not found' },
      { status: 404 }
    );
  }

  return NextResponse.json({
    id: record.id,
    callSid: record.callSid,
    status: record.status,
    createdAt: record.createdAt,
    webProof: record.webProof,
    zkProof: record.zkProof,
    onChain: record.onChain,
    verified: record.status === 'on-chain',
    error: record.error,
  });
}
