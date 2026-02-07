/**
 * Witness Types
 * Vlayer/オンチェーン証明関連の型定義
 */

/** 証明のステータス */
export type ProofStatus = 'pending' | 'web-proof' | 'zk-proof' | 'on-chain' | 'failed';

/** 証明記録 */
export interface WitnessRecord {
  id: string;
  callSid: string;
  createdAt: string;
  status: ProofStatus;
  
  // 各段階のデータ
  webProof?: {
    proofId: string;
    generatedAt: string;
  };
  zkProof?: {
    hash: string;
    generatedAt: string;
  };
  onChain?: {
    txHash: string;
    blockNumber: number;
    contractAddress?: string;
    submittedAt: string;
  };
  
  error?: string;
}

/** 証明対象の判断データ */
export interface DecisionData {
  callId: string;
  timestamp: string;
  action: string;
  reason: string;
  confidence: number;
}
