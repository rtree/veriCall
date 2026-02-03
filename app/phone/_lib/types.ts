/**
 * Phone Types
 * 電話関連の型定義
 */

/** 通話記録 */
export interface CallRecord {
  callSid: string;
  from: string;
  to: string;
  callerCity?: string;
  callerState?: string;
  callerCountry?: string;
  timestamp: string;
  status: 'incoming' | 'forwarded' | 'rejected' | 'voicemail' | 'ai_screening' | 'completed';
}

/** 判断アクション */
export type DecisionAction = 'forward' | 'reject' | 'voicemail' | 'ai_screen';

/** ルーティング判断 */
export interface Decision {
  action: DecisionAction;
  reason: string;
  forwardTo?: string;
  confidence: number;
}

/** 通話ログ（判断結果付き） */
export interface CallLog {
  call: CallRecord;
  decision: Decision;
  witnessId?: string; // Vlayer連携用（後で使う）
}
