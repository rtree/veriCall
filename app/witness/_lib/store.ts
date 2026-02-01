import { WitnessRecord } from './types';

/**
 * Witness Store
 * 証明記録の保存（MVP: インメモリ）
 */

const records = new Map<string, WitnessRecord>();

/** 記録を保存 */
export function saveRecord(record: WitnessRecord): void {
  records.set(record.id, record);
  console.log('⛓️ Witness recorded:', record.id, record.status);
}

/** 記録を取得 */
export function getRecord(id: string): WitnessRecord | undefined {
  return records.get(id);
}

/** CallSidで検索 */
export function getByCallSid(callSid: string): WitnessRecord | undefined {
  return Array.from(records.values()).find(r => r.callSid === callSid);
}

/** 全記録を取得 */
export function getAllRecords(): WitnessRecord[] {
  return Array.from(records.values());
}

/** ステータス更新 */
export function updateStatus(
  id: string, 
  status: WitnessRecord['status'],
  data?: Partial<WitnessRecord>
): void {
  const record = records.get(id);
  if (record) {
    record.status = status;
    if (data) Object.assign(record, data);
    records.set(id, record);
  }
}
