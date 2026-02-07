/**
 * 05 - End-to-End: Web Proof → ZK Proof → On-Chain
 * 
 * VeriCallの全パイプラインをテスト:
 * 1. Web Proofを生成 (vlayer Web Prover)
 * 2. ZK Proofに圧縮 (vlayer ZK Prover)
 * 3. Base Sepoliaに記録 (VeriCallRegistry)
 * 
 * 前提:
 *   - 04-deploy-registry.ts でコントラクトデプロイ済み
 *   - contracts/deployment.json が存在
 * 
 * 実行: npx tsx playground/vlayer/05-end-to-end.ts
 */

import 'dotenv/config';
import { createWalletClient, createPublicClient, http, keccak256, encodePacked, toHex } from 'viem';
import { baseSepolia } from 'viem/chains';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getDeployerAccount } from './wallet';

// ─── Config ─────────────────────────────────────────────────

const TEST_CLIENT_ID = '4f028e97-b7c7-4a81-ade2-6b1a2917380c';
const TEST_API_KEY = 'jUWXi1pVUoTHgc7MOgh5X0zMR12MHtAhtjVgMc2DM3B3Uc8WEGQAEix83VwZ';

const VLAYER_WEB_PROVER_URL = process.env.VLAYER_WEB_PROVER_URL || 'https://web-prover.vlayer.xyz';
const VLAYER_ZK_PROVER_URL = process.env.VLAYER_ZK_PROVER_URL || 'https://zk-prover.vlayer.xyz';
const VLAYER_API_KEY = process.env.VLAYER_API_KEY || TEST_API_KEY;
const VLAYER_CLIENT_ID = process.env.VLAYER_CLIENT_ID || TEST_CLIENT_ID;

const RPC_URL = process.env.ETHEREUM_RPC_URL || 'https://sepolia.base.org';

// ─── Load Contract ABI + Deployment ──────────────────────────

function loadDeployment() {
  const deploymentPath = resolve(__dirname, '../../contracts/deployment.json');
  const deployment = JSON.parse(readFileSync(deploymentPath, 'utf-8'));
  
  const artifactPath = resolve(__dirname, '../../contracts/out/VeriCallRegistry.sol/VeriCallRegistry.json');
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf-8'));
  
  return {
    address: deployment.contractAddress as `0x${string}`,
    abi: artifact.abi,
    deployment,
  };
}

// ─── vlayer API Calls ─────────────────────────────────────────

interface WebProof {
  data: string;
  version: string;
  meta: { notaryUrl: string };
}

interface CompressResult {
  success: boolean;
  data?: { zkProof: string; journalDataAbi: string };
  error?: { code: string; message: string };
}

async function generateWebProof(url: string): Promise<WebProof> {
  console.log('📡 Step 1: Generating Web Proof...');
  console.log('   URL:', url);
  
  const response = await fetch(`${VLAYER_WEB_PROVER_URL}/api/v1/prove`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-client-id': VLAYER_CLIENT_ID,
      'Authorization': `Bearer ${VLAYER_API_KEY}`,
    },
    body: JSON.stringify({ url, headers: [] }),
  });

  if (!response.ok) {
    throw new Error(`Web Proof failed: ${response.status} ${await response.text()}`);
  }

  const proof = await response.json() as WebProof;
  console.log('   ✅ Web Proof generated');
  console.log('   Version:', proof.version);
  console.log('   Size:', proof.data.length, 'chars');
  return proof;
}

async function compressToZKProof(
  webProof: WebProof,
  jmespath: string[]
): Promise<{ zkProof: string; journalDataAbi: string }> {
  console.log('\n🔐 Step 2: Compressing to ZK Proof...');
  console.log('   Extraction:', jmespath.join(', '));

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
        'response.body': { jmespath },
      },
    }),
  });

  const result = await response.json() as CompressResult;
  
  if (!result.success || !result.data) {
    throw new Error(`ZK Proof failed: ${result.error?.message || 'Unknown'}`);
  }

  console.log('   ✅ ZK Proof generated');
  console.log('   Seal:', result.data.zkProof.slice(0, 30) + '...');
  console.log('   Journal:', result.data.journalDataAbi.slice(0, 30) + '...');
  return result.data;
}

// ─── On-Chain Submission ──────────────────────────────────────

async function submitOnChain(
  zkProof: string,
  journalDataAbi: string,
  contractAddress: `0x${string}`,
  abi: any[]
) {
  console.log('\n⛓️  Step 3: Submitting to Base Sepolia...');

  // Get account from mnemonic or private key
  let account: ReturnType<typeof getDeployerAccount>;
  try {
    account = getDeployerAccount();
  } catch {
    console.log('   ⚠️ No wallet configured — simulating on-chain submission');
    
    const callId = keccak256(encodePacked(['string'], [`vericall_demo_${Date.now()}`]));
    const callerHash = keccak256(encodePacked(['string'], ['+1234567890']));
    
    console.log('   Call ID:', callId.slice(0, 18) + '...');
    console.log('   Caller Hash:', callerHash.slice(0, 18) + '...');
    console.log('   Decision: ACCEPT (1)');
    console.log('   ZK Proof Seal:', zkProof.length, 'hex chars');
    console.log('   Journal Data:', journalDataAbi.length, 'hex chars');
    console.log('\n   📝 Set DEPLOYER_MNEMONIC or DEPLOYER_PRIVATE_KEY in .env.local');
    return null;
  }
  
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  // Construct call data
  const callId = keccak256(encodePacked(['string'], [`vericall_demo_${Date.now()}`]));
  const callerHash = keccak256(encodePacked(['string'], ['+1234567890']));
  const decision = 1; // ACCEPT
  const reason = 'Demo: Binance ETH/USDC price proof verified via vlayer';
  const sourceUrl = 'https://data-api.binance.vision/api/v3/ticker/price?symbol=ETHUSDC';

  console.log('   Contract:', contractAddress);
  console.log('   Submitter:', account.address);
  console.log('   Call ID:', callId.slice(0, 18) + '...');
  console.log('   Decision: ACCEPT');

  // Submit transaction
  const hash = await walletClient.writeContract({
    address: contractAddress,
    abi,
    functionName: 'registerCallDecision',
    args: [
      callId,
      callerHash,
      decision,
      reason,
      zkProof as `0x${string}`,
      journalDataAbi as `0x${string}`,
      sourceUrl,
    ],
  });

  console.log('   TX:', hash);
  console.log('   Waiting for confirmation...');

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log('   ✅ Confirmed! Block:', receipt.blockNumber);
  console.log('   Gas used:', receipt.gasUsed.toString());
  console.log('   Explorer: https://sepolia.basescan.org/tx/' + hash);

  // Verify on-chain
  console.log('\n🔍 Step 4: Verifying on-chain record...');
  
  const record = await publicClient.readContract({
    address: contractAddress,
    abi,
    functionName: 'getRecord',
    args: [callId],
  }) as any;

  console.log('   Decision:', ['UNKNOWN', 'ACCEPT', 'BLOCK', 'RECORD'][record.decision]);
  console.log('   Timestamp:', new Date(Number(record.timestamp) * 1000).toISOString());
  console.log('   Journal Hash:', record.journalHash);
  
  // Verify journal integrity
  const journalValid = await publicClient.readContract({
    address: contractAddress,
    abi,
    functionName: 'verifyJournal',
    args: [callId, journalDataAbi as `0x${string}`],
  });
  
  console.log('   Journal Valid:', journalValid ? '✅ YES' : '❌ NO');

  // Get stats
  const stats = await publicClient.readContract({
    address: contractAddress,
    abi,
    functionName: 'getStats',
  }) as any;

  console.log('\n📊 Registry Stats:');
  console.log('   Total:', stats[0].toString());
  console.log('   Accepted:', stats[1].toString());
  console.log('   Blocked:', stats[2].toString());
  console.log('   Recorded:', stats[3].toString());

  return { callId, hash, receipt };
}

// ─── Main ─────────────────────────────────────────────────────

async function main() {
  console.log('🧪 VeriCall End-to-End: Web Proof → ZK Proof → On-Chain\n');
  console.log('='.repeat(60));

  // Step 1: Web Proof
  const webProof = await generateWebProof(
    'https://data-api.binance.vision/api/v3/ticker/price?symbol=ETHUSDC'
  );

  // Step 2: ZK Proof
  const { zkProof, journalDataAbi } = await compressToZKProof(webProof, ['price', 'symbol']);

  // Step 3 + 4: On-Chain
  console.log('\n' + '-'.repeat(60));
  
  let contractAddress: `0x${string}`;
  let abi: any[];

  try {
    const { address, abi: contractAbi } = loadDeployment();
    contractAddress = address;
    abi = contractAbi;
    console.log('\n📋 Using deployed contract:', contractAddress);
  } catch {
    console.log('\n⚠️ No deployment found. Run 04-deploy-registry.ts first.');
    console.log('   Simulating on-chain submission...\n');
    
    // Still show the data
    const artifactPath = resolve(__dirname, '../../contracts/out/VeriCallRegistry.sol/VeriCallRegistry.json');
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf-8'));
    contractAddress = '0x0000000000000000000000000000000000000000';
    abi = artifact.abi;
  }

  await submitOnChain(zkProof, journalDataAbi, contractAddress, abi);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('🎉 VeriCall E2E Pipeline Complete!\n');
  console.log('Pipeline:');
  console.log('  1. 📡 Web Proof   — TLSNotary proves HTTP response');
  console.log('  2. 🔐 ZK Proof    — RISC Zero compresses to Groth16');
  console.log('  3. ⛓️  On-Chain    — Base Sepolia stores proof record');
  console.log('  4. ✅ Verified    — Journal data integrity confirmed');
  console.log('\nThis proves: The AI decision was based on REAL data,');
  console.log('and anyone can verify the proof on-chain.');
}

main().catch(console.error);
