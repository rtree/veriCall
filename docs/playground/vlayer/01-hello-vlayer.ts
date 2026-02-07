/**
 * 01 - Hello Vlayer
 * 
 * Vlayer APIの基本的な疎通確認
 * 公式テスト用クレデンシャルを使用してAPIに接続
 * 
 * 実行: pnpm play docs/playground/vlayer/01-hello-vlayer.ts
 */

import 'dotenv/config';

// 公式ドキュメントの公開テスト用クレデンシャル
// https://docs.vlayer.xyz/server-side/rest-api/prove
const TEST_CLIENT_ID = '4f028e97-b7c7-4a81-ade2-6b1a2917380c';
const TEST_API_KEY = 'jUWXi1pVUoTHgc7MOgh5X0zMR12MHtAhtjVgMc2DM3B3Uc8WEGQAEix83VwZ';

const VLAYER_WEB_PROVER_URL = process.env.VLAYER_WEB_PROVER_URL || 'https://web-prover.vlayer.xyz';
const VLAYER_ZK_PROVER_URL = process.env.VLAYER_ZK_PROVER_URL || 'https://zk-prover.vlayer.xyz';
const VLAYER_API_KEY = process.env.VLAYER_API_KEY || TEST_API_KEY;
const VLAYER_CLIENT_ID = process.env.VLAYER_CLIENT_ID || TEST_CLIENT_ID;

async function main() {
  console.log('🧪 Vlayer Connection Test\n');
  
  console.log('Config:');
  console.log('  Web Prover:', VLAYER_WEB_PROVER_URL);
  console.log('  ZK Prover:', VLAYER_ZK_PROVER_URL);
  console.log('  Client ID:', VLAYER_CLIENT_ID.slice(0, 8) + '...');
  console.log('  API Key:', VLAYER_API_KEY ? '✅ Set' : '❌ Not set');
  console.log();

  // Step 1: GET /guest-id でZK Proverの疎通確認
  console.log('📡 Step 1: Testing ZK Prover /guest-id...');
  try {
    const response = await fetch(`${VLAYER_ZK_PROVER_URL}/api/v0/guest-id`, {
      headers: {
        'x-client-id': VLAYER_CLIENT_ID,
        'Authorization': `Bearer ${VLAYER_API_KEY}`,
      },
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('✅ ZK Prover connected!');
      console.log('   Guest ID:', JSON.stringify(data, null, 2));
    } else {
      console.log('❌ Failed:', response.status, await response.text());
    }
  } catch (error) {
    console.log('❌ Error:', error);
  }

  console.log();

  // Step 2: Web Proverで簡単なWeb Proofを生成
  console.log('📡 Step 2: Testing Web Prover /prove with Binance API...');
  try {
    const response = await fetch(`${VLAYER_WEB_PROVER_URL}/api/v1/prove`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': VLAYER_CLIENT_ID,
        'Authorization': `Bearer ${VLAYER_API_KEY}`,
      },
      body: JSON.stringify({
        url: 'https://data-api.binance.vision/api/v3/ticker/price?symbol=ETHUSDC',
        headers: [],
      }),
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('✅ Web Proof generated!');
      console.log('   Version:', data.version);
      console.log('   Notary URL:', data.meta?.notaryUrl);
      console.log('   Proof data length:', data.data?.length, 'chars');
    } else {
      console.log('❌ Failed:', response.status, await response.text());
    }
  } catch (error) {
    console.log('❌ Error:', error);
  }

  console.log();
  console.log('🎉 Connection test complete!');
  console.log();
  console.log('Next steps:');
  console.log('  - Run 02-web-proof.ts to generate a full proof');
  console.log('  - Run 03-zk-proof.ts to compress to ZK proof');
}

main().catch(console.error);
