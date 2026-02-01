/**
 * 01 - Hello Vlayer
 * 
 * Vlayer APIの基本的な疎通確認
 * 
 * 実行: npx ts-node playground/vlayer/01-hello-vlayer.ts
 */

import 'dotenv/config';

const VLAYER_WEB_PROVER_URL = process.env.VLAYER_WEB_PROVER_URL || 'https://web-prover.vlayer.xyz';
const VLAYER_ZK_PROVER_URL = process.env.VLAYER_ZK_PROVER_URL || 'https://zk-prover.vlayer.xyz';
const VLAYER_API_KEY = process.env.VLAYER_API_KEY || '';

async function main() {
  console.log('🧪 Vlayer Connection Test\n');
  
  console.log('Config:');
  console.log('  Web Prover:', VLAYER_WEB_PROVER_URL);
  console.log('  ZK Prover:', VLAYER_ZK_PROVER_URL);
  console.log('  API Key:', VLAYER_API_KEY ? '✅ Set' : '❌ Not set');
  console.log();

  if (!VLAYER_API_KEY) {
    console.log('⚠️ VLAYER_API_KEY is not set in .env');
    console.log('   Get one at: https://accounts.vlayer.xyz/sign-up');
    return;
  }

  // TODO: 実際のAPIエンドポイントを試す
  // Step 1: GET /guest-id でZK Proverの疎通確認
  try {
    console.log('Testing ZK Prover /guest-id...');
    const response = await fetch(`${VLAYER_ZK_PROVER_URL}/guest-id`, {
      headers: {
        'Authorization': `Bearer ${VLAYER_API_KEY}`,
      },
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('✅ Connected! Guest ID:', data.guestId || data);
    } else {
      console.log('❌ Failed:', response.status, await response.text());
    }
  } catch (error) {
    console.log('❌ Error:', error);
  }
}

main().catch(console.error);
