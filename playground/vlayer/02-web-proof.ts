/**
 * 02 - Web Proof Generation
 * 
 * Vlayer Web Prover ServerでWeb Proofを生成する実験
 * 
 * 実行: npx ts-node playground/vlayer/02-web-proof.ts
 */

import 'dotenv/config';

const VLAYER_WEB_PROVER_URL = process.env.VLAYER_WEB_PROVER_URL || 'https://web-prover.vlayer.xyz';
const VLAYER_API_KEY = process.env.VLAYER_API_KEY || '';

async function main() {
  console.log('🧪 Web Proof Generation Test\n');

  if (!VLAYER_API_KEY) {
    console.log('⚠️ VLAYER_API_KEY is not set');
    return;
  }

  // サンプルデータ（実際の通話判断を模倣）
  const decisionData = {
    callId: 'CA_test_12345',
    timestamp: new Date().toISOString(),
    callerHash: 'abc123def456', // 電話番号のハッシュ
    action: 'forward',
    reason: 'Caller is in whitelist',
    confidence: 1.0,
  };

  console.log('Decision Data:');
  console.log(JSON.stringify(decisionData, null, 2));
  console.log();

  // TODO: POST /prove を呼び出す
  // ドキュメント: https://docs.vlayer.xyz/server-side/rest-api/prove
  //
  // リクエスト形式:
  // {
  //   url: "https://example.com/api/data",
  //   method: "GET",
  //   headers: { ... },
  //   body: "..." (optional)
  // }
  //
  // 課題: VeriCallのAPIエンドポイントをHTTPSで公開する必要がある
  //       → ngrokでローカル開発、Cloud Runで本番
  
  console.log('📝 To be implemented:');
  console.log('   1. Deploy VeriCall to get HTTPS URL');
  console.log('   2. Call POST /prove with VeriCall API as target');
  console.log('   3. Get Web Proof back');
}

main().catch(console.error);
