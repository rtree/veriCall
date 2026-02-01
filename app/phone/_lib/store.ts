import { CallLog } from './types';

/**
 * Call Store
 * 通話ログの保存（MVP: インメモリ）
 */

const logs = new Map<string, CallLog>();

/** ログを保存 */
export function saveLog(log: CallLog): void {
  logs.set(log.call.callSid, log);
  console.log('📞 Call logged:', log.call.callSid, log.decision.action);
}

/** ログを取得 */
export function getLog(callSid: string): CallLog | undefined {
  return logs.get(callSid);
}

/** 全ログを取得 */
export function getAllLogs(): CallLog[] {
  return Array.from(logs.values());
}

/** ログにWitness IDを追加（Vlayer連携用） */
export function attachWitnessId(callSid: string, witnessId: string): void {
  const log = logs.get(callSid);
  if (log) {
    log.witnessId = witnessId;
    logs.set(callSid, log);
  }
}
