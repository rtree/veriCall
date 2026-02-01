import { NextRequest, NextResponse } from 'next/server';
import { getDecisionLog, getAllDecisionLogs } from '@/lib/decision-logger';

/**
 * GET /api/calls
 * 
 * Get all call decision logs
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const callId = searchParams.get('callId');

  if (callId) {
    const log = getDecisionLog(callId);
    if (!log) {
      return NextResponse.json(
        { error: 'Call not found' },
        { status: 404 }
      );
    }
    return NextResponse.json(log);
  }

  const logs = getAllDecisionLogs();
  return NextResponse.json({
    total: logs.length,
    calls: logs,
  });
}
