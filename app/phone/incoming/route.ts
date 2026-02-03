import { NextRequest, NextResponse } from 'next/server';
import { CallRecord } from '../_lib/types';
import { decide } from '../_lib/router';
import { buildResponse } from '../_lib/twiml-builder';
import { onIncoming, onDecisionMade } from '../_lib/events';

/**
 * POST /phone/incoming
 * Twilio着信Webhook
 */
export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const body = Object.fromEntries(formData.entries()) as Record<string, string>;

  // 通話情報を抽出
  const call: CallRecord = {
    callSid: body.CallSid || '',
    from: body.From || '',
    to: body.To || '',
    callerCity: body.CallerCity,
    callerState: body.CallerState,
    callerCountry: body.CallerCountry,
    timestamp: new Date().toISOString(),
    status: 'incoming',
  };

  // イベント発火
  await onIncoming(call);

  // ルーティング判断
  const decision = decide(call);

  // イベント発火（Vlayer連携ポイント）
  await onDecisionMade(call, decision);

  // TwiMLレスポンス生成
  const twiml = buildResponse(decision, { from: call.from, callSid: call.callSid });

  return new NextResponse(twiml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}
