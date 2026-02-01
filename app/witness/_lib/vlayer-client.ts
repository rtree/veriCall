import { vlayerConfig } from '@/lib/config';
import { WitnessRecord, DecisionData } from './types';
import { saveRecord, updateStatus } from './store';
import crypto from 'crypto';

/**
 * Vlayer Client
 * Vlayer APIとの連携（段階的に実装）
 */

/** 新しい証明プロセスを開始 */
export async function createWitness(
  callSid: string,
  decisionData: DecisionData
): Promise<WitnessRecord> {
  const id = `wit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  const record: WitnessRecord = {
    id,
    callSid,
    createdAt: new Date().toISOString(),
    status: 'pending',
  };
  
  saveRecord(record);

  // 非同期で証明生成（ブロックしない）
  processWitnessAsync(record, decisionData).catch(console.error);

  return record;
}

/** 非同期で証明を生成 */
async function processWitnessAsync(
  record: WitnessRecord,
  data: DecisionData
): Promise<void> {
  try {
    // Step 1: Web Proof生成
    const webProof = await generateWebProof(data);
    if (webProof) {
      updateStatus(record.id, 'web-proof', {
        webProof: {
          proofId: webProof.id,
          generatedAt: new Date().toISOString(),
        },
      });

      // Step 2: ZK Proof圧縮
      const zkProof = await compressToZKProof(webProof.proof);
      if (zkProof) {
        updateStatus(record.id, 'zk-proof', {
          zkProof: {
            hash: zkProof.hash,
            generatedAt: new Date().toISOString(),
          },
        });

        // Step 3: オンチェーン提出（TODO）
        // const tx = await submitOnChain(zkProof);
        // updateStatus(record.id, 'on-chain', { onChain: tx });
      }
    }
  } catch (error) {
    console.error('Witness processing failed:', error);
    updateStatus(record.id, 'failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/** Web Proof生成 */
async function generateWebProof(
  data: DecisionData
): Promise<{ id: string; proof: string } | null> {
  if (!vlayerConfig.apiKey) {
    console.log('⚠️ Vlayer API key not set, skipping web proof');
    return null;
  }

  // TODO: 実際のVlayer API呼び出し
  // これはplaygroundで先に試してから実装する
  console.log('📝 Would generate web proof for:', data.callId);
  
  return {
    id: `wp_${Date.now()}`,
    proof: 'placeholder_proof',
  };
}

/** ZK Proof圧縮 */
async function compressToZKProof(
  webProof: string
): Promise<{ hash: string } | null> {
  if (!vlayerConfig.apiKey) {
    return null;
  }

  // TODO: 実際のVlayer API呼び出し
  console.log('🔐 Would compress to ZK proof');
  
  return {
    hash: crypto.createHash('sha256').update(webProof).digest('hex').slice(0, 16),
  };
}

/** 電話番号をハッシュ化（プライバシー保護） */
export function hashPhoneNumber(phone: string): string {
  return crypto.createHash('sha256').update(phone).digest('hex').slice(0, 16);
}
