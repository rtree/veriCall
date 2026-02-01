/**
 * 02 - Web Proof Generation
 * 
 * Vlayer Web Prover ServerでWeb Proofを生成し、内容を検証する
 * 
 * 実行: pnpm play playground/vlayer/02-web-proof.ts
 */

import 'dotenv/config';

// 公式ドキュメントの公開テスト用クレデンシャル
const TEST_CLIENT_ID = '4f028e97-b7c7-4a81-ade2-6b1a2917380c';
const TEST_API_KEY = 'jUWXi1pVUoTHgc7MOgh5X0zMR12MHtAhtjVgMc2DM3B3Uc8WEGQAEix83VwZ';

const VLAYER_WEB_PROVER_URL = process.env.VLAYER_WEB_PROVER_URL || 'https://web-prover.vlayer.xyz';
const VLAYER_API_KEY = process.env.VLAYER_API_KEY || TEST_API_KEY;
const VLAYER_CLIENT_ID = process.env.VLAYER_CLIENT_ID || TEST_CLIENT_ID;

interface WebProof {
  data: string;
  version: string;
  meta: {
    notaryUrl: string;
  };
}

interface VerifyResponse {
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  responseBody: string;
}

async function generateWebProof(url: string): Promise<WebProof | null> {
  console.log(`📡 Generating Web Proof for: ${url}\n`);
  
  const response = await fetch(`${VLAYER_WEB_PROVER_URL}/api/v1/prove`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-client-id': VLAYER_CLIENT_ID,
      'Authorization': `Bearer ${VLAYER_API_KEY}`,
    },
    body: JSON.stringify({
      url,
      headers: [],
    }),
  });
  
  if (!response.ok) {
    console.log('❌ Failed:', response.status, await response.text());
    return null;
  }
  
  const proof = await response.json() as WebProof;
  console.log('✅ Web Proof generated!');
  console.log('   Version:', proof.version);
  console.log('   Notary:', proof.meta.notaryUrl);
  console.log('   Proof size:', proof.data.length, 'chars');
  
  return proof;
}

async function verifyWebProof(proof: WebProof): Promise<VerifyResponse | null> {
  console.log('\n🔍 Verifying Web Proof...\n');
  
  const response = await fetch(`${VLAYER_WEB_PROVER_URL}/api/v1/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-client-id': VLAYER_CLIENT_ID,
      'Authorization': `Bearer ${VLAYER_API_KEY}`,
    },
    body: JSON.stringify(proof),
  });
  
  if (!response.ok) {
    console.log('❌ Verification failed:', response.status, await response.text());
    return null;
  }
  
  const result = await response.json() as VerifyResponse;
  console.log('✅ Proof verified!');
  console.log('   Method:', result.method);
  console.log('   URL:', result.url);
  console.log('   Response Body:', result.responseBody?.slice(0, 200) + '...');
  
  return result;
}

async function main() {
  console.log('🧪 Web Proof Generation & Verification\n');
  console.log('='.repeat(50));
  
  // Step 1: BinanceのETH/USDC価格をProof化
  const proof = await generateWebProof(
    'https://data-api.binance.vision/api/v3/ticker/price?symbol=ETHUSDC'
  );
  
  if (!proof) {
    console.log('\n❌ Could not generate proof. Exiting.');
    return;
  }
  
  // Step 2: Proofを検証してHTTPトランスクリプトを取得
  const verified = await verifyWebProof(proof);
  
  if (!verified) {
    console.log('\n❌ Could not verify proof. Exiting.');
    return;
  }
  
  // Step 3: レスポンスボディをパース
  console.log('\n📊 Parsed Response:');
  try {
    const data = JSON.parse(verified.responseBody);
    console.log('   Symbol:', data.symbol);
    console.log('   Price:', data.price);
  } catch {
    console.log('   (Could not parse as JSON)');
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('🎉 Web Proof flow complete!');
  console.log('\nNext: Run 03-zk-proof.ts to compress this to a ZK proof for on-chain use.');
  
  // Export proof for next script
  console.log('\n💾 Saving proof to /tmp/web-proof.json...');
  const fs = await import('fs');
  fs.writeFileSync('/tmp/web-proof.json', JSON.stringify(proof, null, 2));
  console.log('   Done!');
}

main().catch(console.error);
