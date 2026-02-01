import { NextRequest, NextResponse } from 'next/server';
import { buildVoicemailFallback } from '../_lib/twiml-builder';
import { onForwarded, onCompleted } from '../_lib/events';

/**
 * POST /phone/status
 * 通話ステータス更新Webhook
 */
export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const body = Object.fromEntries(formData.entries()) as Record<string, string>;

  const callSid = body.CallSid;
  const callStatus = body.CallStatus;
  const dialCallStatus = body.DialCallStatus;
  const duration = parseInt(body.CallDuration || '0', 10);

  // イベント発火
  if (dialCallStatus === 'completed') {
    await onForwarded(callSid, duration);
  }
  await onCompleted(callSid, callStatus);

  // 転送失敗時は留守電へ
  let twiml = '';
  if (['no-answer', 'busy', 'failed'].includes(dialCallStatus)) {
    twiml = buildVoicemailFallback();
  }

  return new NextResponse(twiml || '<Response/>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}
