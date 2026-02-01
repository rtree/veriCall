import { CallRecord, Decision, CallLog } from './types';
import { saveLog } from './store';
import { sendCallNotification } from './email';

/**
 * Phone Events
 * イベントドリブンなフック（ドメイン間連携のポイント）
 */

/** 着信時 */
export async function onIncoming(call: CallRecord): Promise<void> {
  console.log(`📞 Incoming: ${call.from} → ${call.to}`);
}

/** 判断確定時 */
export async function onDecisionMade(call: CallRecord, decision: Decision): Promise<void> {
  // ログ保存
  const log: CallLog = { call, decision };
  saveLog(log);

  console.log(`✅ Decision: ${decision.action} (${decision.reason})`);

  // メール通知（非同期で送信、エラーがあってもフローは止めない）
  sendCallNotification({
    callId: call.callSid,
    from: call.from,
    to: call.to,
    action: decision.action,
    reason: decision.reason,
    timestamp: new Date(),
  }).catch((err) => console.error('Email notification error:', err));

  // TODO: ここでVlayerを呼ぶ（後で実装）
  // await witness.createProof(log);
}

/** 転送完了時 */
export async function onForwarded(callSid: string, duration: number): Promise<void> {
  console.log(`📲 Forwarded: ${callSid} (${duration}s)`);
}

/** 通話終了時 */
export async function onCompleted(callSid: string, status: string): Promise<void> {
  console.log(`📴 Completed: ${callSid} - ${status}`);
}
