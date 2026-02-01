import { CallRecord, Decision, CallLog } from './types';
import { saveLog } from './store';

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
