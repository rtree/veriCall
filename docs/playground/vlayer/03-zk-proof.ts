/**
 * 03 - ZK Proof Compression
 * 
 * Web ProofをZK Proofに圧縮し、オンチェーン検証可能な形式に変換
 * 
 * 前提: 02-web-proof.ts を実行して /tmp/web-proof.json を生成済み
 * 実行: pnpm play docs/playground/vlayer/03-zk-proof.ts
 */

import 'dotenv/config';
import { encodePacked, keccak256 } from 'viem';

// 公式ドキュメントの公開テスト用クレデンシャル
const TEST_CLIENT_ID = '4f028e97-b7c7-4a81-ade2-6b1a2917380c';
const TEST_API_KEY = 'jUWXi1pVUoTHgc7MOgh5X0zMR12MHtAhtjVgMc2DM3B3Uc8WEGQAEix83VwZ';

const VLAYER_ZK_PROVER_URL = process.env.VLAYER_ZK_PROVER_URL || 'https://zk-prover.vlayer.xyz';
const VLAYER_API_KEY = process.env.VLAYER_API_KEY || TEST_API_KEY;
const VLAYER_CLIENT_ID = process.env.VLAYER_CLIENT_ID || TEST_CLIENT_ID;

interface WebProof {
  data: string;
  version: string;
  meta: {
    notaryUrl: string;
  };
}

interface CompressResponse {
  success: boolean;
  data?: {
    zkProof: string;
    journalDataAbi: string;
  };
  error?: {
    code: string;
    message: string;
  };
}

async function loadWebProof(): Promise<WebProof | null> {
  try {
    const fs = await import('fs');
    const content = fs.readFileSync('/tmp/web-proof.json', 'utf-8');
    return JSON.parse(content) as WebProof;
  } catch (error) {
    console.log('❌ Could not load /tmp/web-proof.json');
    console.log('   Run 02-web-proof.ts first to generate a Web Proof');
    return null;
  }
}

function calculateExtractionHash(queries: string[]): string {
  // extraction hash は JMESPath クエリから計算される
  // 各クエリに対して source, format, query を連結
  const sources = queries.map(() => 'response.body');
  const formats = queries.map(() => 'jmespath');
  
  // 型と値を交互に配列化
  const types: ('string')[] = [];
  const values: string[] = [];
  
  for (let i = 0; i < queries.length; i++) {
    types.push('string', 'string', 'string');
    values.push(sources[i], formats[i], queries[i]);
  }
  
  const packed = encodePacked(types, values);
  return keccak256(packed);
}

async function compressToZKProof(
  webProof: WebProof,
  extraction: { jmespath: string[] }
): Promise<CompressResponse> {
  console.log('🔐 Compressing Web Proof to ZK Proof...\n');
  console.log('   Extraction queries:', extraction.jmespath.join(', '));
  
  const expectedHash = calculateExtractionHash(extraction.jmespath);
  console.log('   Expected extraction hash:', expectedHash.slice(0, 18) + '...');
  console.log();
  
  const response = await fetch(`${VLAYER_ZK_PROVER_URL}/api/v0/compress-web-proof`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-client-id': VLAYER_CLIENT_ID,
      'Authorization': `Bearer ${VLAYER_API_KEY}`,
    },
    body: JSON.stringify({
      presentation: webProof,
      extraction: {
        'response.body': {
          jmespath: extraction.jmespath,
        },
      },
    }),
  });
  
  return await response.json() as CompressResponse;
}

async function main() {
  console.log('🧪 ZK Proof Compression\n');
  console.log('='.repeat(50));
  
  // Step 1: 前のスクリプトで生成したWeb Proofをロード
  console.log('\n📂 Loading Web Proof from /tmp/web-proof.json...\n');
  const webProof = await loadWebProof();
  
  if (!webProof) {
    return;
  }
  
  console.log('✅ Web Proof loaded');
  console.log('   Version:', webProof.version);
  console.log('   Data length:', webProof.data.length, 'chars');
  
  // Step 2: ZK Proofに圧縮（price と symbol を抽出）
  console.log('\n' + '-'.repeat(50) + '\n');
  
  const result = await compressToZKProof(webProof, {
    jmespath: ['price', 'symbol'],
  });
  
  if (!result.success || !result.data) {
    console.log('❌ Compression failed:', result.error?.message || 'Unknown error');
    return;
  }
  
  console.log('✅ ZK Proof generated!');
  console.log('   zkProof length:', result.data.zkProof.length, 'chars');
  console.log('   journalDataAbi length:', result.data.journalDataAbi.length, 'chars');
  
  // Step 3: 結果を解説
  console.log('\n' + '='.repeat(50));
  console.log('🎉 ZK Proof generated successfully!\n');
  
  console.log('📋 What you have now:');
  console.log('');
  console.log('   zkProof (seal):');
  console.log('     → RISC Zero証明。オンチェーンで検証に使用');
  console.log('     → ' + result.data.zkProof.slice(0, 40) + '...');
  console.log('');
  console.log('   journalDataAbi:');
  console.log('     → ABI エンコードされた公開出力');
  console.log('     → Contains: notaryKeyFingerprint, method, url, timestamp,');
  console.log('                 extractionHash, price, symbol');
  console.log('     → ' + result.data.journalDataAbi.slice(0, 40) + '...');
  console.log('');
  
  console.log('🔗 Next steps for VeriCall:');
  console.log('   1. Deploy a Verifier contract on Base Sepolia');
  console.log('   2. Submit zkProof + journalDataAbi to verify on-chain');
  console.log('   3. Store call decision proof on-chain');
  
  // 結果を保存
  console.log('\n💾 Saving ZK Proof to /tmp/zk-proof.json...');
  const fs = await import('fs');
  fs.writeFileSync('/tmp/zk-proof.json', JSON.stringify(result.data, null, 2));
  console.log('   Done!');
}

main().catch(console.error);
