import { NextResponse } from 'next/server';
import { getAllLogs, getLog } from '../_lib/store';
import { NextRequest } from 'next/server';

/**
 * GET /phone/logs
 * 通話ログ一覧
 */
export async function GET(request: NextRequest) {
  const callSid = request.nextUrl.searchParams.get('callSid');

  if (callSid) {
    const log = getLog(callSid);
    if (!log) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(log);
  }

  const logs = getAllLogs();
  return NextResponse.json({
    total: logs.length,
    logs,
  });
}
