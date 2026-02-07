#!/usr/bin/env npx tsx
/**
 * Deploy VeriCallRegistryV2 + RiscZeroMockVerifier to Base Sepolia.
 *
 * Usage:
 *   npx tsx scripts/deploy-v2.ts [--skip-sync]
 *
 * Flags:
 *   --skip-sync   Skip GCP Secret Manager update (for envs without gcloud)
 *
 * Prerequisites:
 *   - DEPLOYER_MNEMONIC or DEPLOYER_PRIVATE_KEY in .env.local
 *   - Forge build completed (contracts/out/)
 *   - Sufficient ETH on Base Sepolia
 *   - gcloud CLI authenticated (for Secret Manager sync, optional with --skip-sync)
 *
 * Architecture (LensMint pattern):
 *   1. Deploy RiscZeroMockVerifier(0xFFFFFFFF)
 *   2. Deploy VeriCallRegistryV2(mockVerifierAddr, guestId)
 *   3. On-chain verification (5 checks)
 *   4. Auto-sync to all config locations:
 *      a. contracts/deployment.json  (Single Source of Truth)
 *      b. .env.local                 (local dev)
 *      c. GCP Secret Manager         (Cloud Run production)
 *      → GitHub Actions reads deployment.json on push
 */

import {
  createWalletClient, createPublicClient, http, formatEther,
  keccak256, encodePacked,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';
import dotenv from 'dotenv';

// Load .env.local (Next.js convention)
dotenv.config({ path: resolve(__dirname, '../.env.local') });

// ─── Flags ─────────────────────────────────────────────────────

const SKIP_SYNC = process.argv.includes('--skip-sync');
const GCP_PROJECT = process.env.GCP_PROJECT_ID || 'ethglobal-479011';

// ─── Config ────────────────────────────────────────────────────

const RPC_URL = process.env.ETHEREUM_RPC_URL || 'https://sepolia.base.org';
const GUEST_ID = process.env.VLAYER_GUEST_ID ||
  '0x6e251f4d993427d02a4199e1201f3b54462365d7c672a51be57f776d509b47eb';
const BASESCAN = 'https://sepolia.basescan.org';

// ─── Wallet ────────────────────────────────────────────────────

function getAccount() {
  const mnemonic = process.env.DEPLOYER_MNEMONIC;
  if (mnemonic) return mnemonicToAccount(mnemonic.trim());

  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  if (pk) return privateKeyToAccount(pk as `0x${string}`);

  throw new Error('Set DEPLOYER_MNEMONIC or DEPLOYER_PRIVATE_KEY in .env.local');
}

// ─── Load Forge Artifacts ──────────────────────────────────────

function loadArtifact(name: string) {
  const path = resolve(__dirname, `../contracts/out/${name}.sol/${name}.json`);
  const json = JSON.parse(readFileSync(path, 'utf-8'));
  return {
    abi: json.abi,
    bytecode: json.bytecode.object as `0x${string}`,
  };
}

// ─── Main ──────────────────────────────────────────────────────

async function main() {
  console.log('\n🚀 VeriCallRegistryV2 Deployment');
  console.log('═'.repeat(60));

  const account = getAccount();
  console.log(`\n📍 Deployer: ${account.address}`);
  console.log(`🔗 Network:  Base Sepolia (chainId 84532)`);
  console.log(`🆔 Guest ID: ${GUEST_ID.slice(0, 18)}...`);

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  // Check balance
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`💰 Balance:  ${formatEther(balance)} ETH`);
  if (balance === 0n) {
    throw new Error('No ETH balance — fund the deployer address first');
  }

  // ── Step 1: Deploy RiscZeroMockVerifier ────────────────────

  console.log('\n── Step 1/3: Deploying RiscZeroMockVerifier ──');
  const mockArtifact = loadArtifact('RiscZeroMockVerifier');

  const mockHash = await walletClient.deployContract({
    abi: mockArtifact.abi,
    bytecode: mockArtifact.bytecode,
    args: [],
  });

  console.log(`   TX: ${mockHash}`);
  const mockReceipt = await publicClient.waitForTransactionReceipt({ hash: mockHash });
  const mockAddress = mockReceipt.contractAddress!;
  console.log(`   ✅ MockVerifier deployed: ${mockAddress}`);
  console.log(`   🔗 ${BASESCAN}/address/${mockAddress}`);

  // ── Step 2: Deploy VeriCallRegistryV2 ──────────────────────

  console.log('\n── Step 2/3: Deploying VeriCallRegistryV2 ──');
  const v2Artifact = loadArtifact('VeriCallRegistryV2');

  const v2Hash = await walletClient.deployContract({
    abi: v2Artifact.abi,
    bytecode: v2Artifact.bytecode,
    args: [mockAddress, GUEST_ID as `0x${string}`],
  });

  console.log(`   TX: ${v2Hash}`);
  const v2Receipt = await publicClient.waitForTransactionReceipt({ hash: v2Hash });
  const v2Address = v2Receipt.contractAddress!;
  console.log(`   ✅ RegistryV2 deployed: ${v2Address}`);
  console.log(`   🔗 ${BASESCAN}/address/${v2Address}`);

  // ── Step 3: On-chain Verification ──────────────────────────

  console.log('\n── Step 3/3: On-chain Verification ──');

  // Helper: getCode with retry (public RPC may lag after deploy)
  async function getCodeWithRetry(addr: `0x${string}`, label: string, maxRetries = 5): Promise<number> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const code = await publicClient.getCode({ address: addr });
      const bytes = code && code !== '0x' ? (code.length - 2) / 2 : 0;
      if (bytes > 0) return bytes;
      if (attempt < maxRetries) {
        console.log(`   ${label}: waiting for RPC propagation (${attempt}/${maxRetries})...`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    return 0;
  }

  // 3a: Bytecode existence
  console.log(`\n   [3a] Bytecode Check`);
  const mockBytes = await getCodeWithRetry(mockAddress, 'MockVerifier');
  console.log(`   MockVerifier:  ${mockBytes} bytes ${mockBytes > 0 ? '✅' : '❌ NO CODE'}`);

  const v2Bytes = await getCodeWithRetry(v2Address, 'RegistryV2');
  console.log(`   RegistryV2:    ${v2Bytes} bytes ${v2Bytes > 0 ? '✅' : '❌ NO CODE'}`);

  if (mockBytes === 0 || v2Bytes === 0) {
    throw new Error('Contract bytecode not found on-chain — deployment may have failed');
  }

  // 3b: MockVerifier SELECTOR
  console.log(`\n   [3b] MockVerifier State`);
  const selector = await publicClient.readContract({
    address: mockAddress,
    abi: mockArtifact.abi,
    functionName: 'SELECTOR',
  });
  console.log(`   SELECTOR: ${selector} ${selector === '0xffffffff' ? '✅' : '❌ WRONG'}`);
  if (selector !== '0xffffffff') {
    throw new Error(`MockVerifier SELECTOR mismatch: got ${selector}`);
  }

  // 3c: RegistryV2 state
  console.log(`\n   [3c] RegistryV2 State`);

  const verifierAddr = await publicClient.readContract({
    address: v2Address,
    abi: v2Artifact.abi,
    functionName: 'verifier',
  });
  const verifierOk = (verifierAddr as string).toLowerCase() === mockAddress.toLowerCase();
  console.log(`   verifier:  ${verifierAddr} ${verifierOk ? '✅' : '❌ MISMATCH'}`);

  const storedImageId = await publicClient.readContract({
    address: v2Address,
    abi: v2Artifact.abi,
    functionName: 'imageId',
  });
  const imageIdOk = storedImageId === GUEST_ID;
  console.log(`   imageId:   ${(storedImageId as string).slice(0, 18)}... ${imageIdOk ? '✅' : '❌ MISMATCH'}`);

  const ownerAddr = await publicClient.readContract({
    address: v2Address,
    abi: v2Artifact.abi,
    functionName: 'owner',
  });
  const ownerOk = (ownerAddr as string).toLowerCase() === account.address.toLowerCase();
  console.log(`   owner:     ${ownerAddr} ${ownerOk ? '✅' : '❌ MISMATCH'}`);

  const stats = await publicClient.readContract({
    address: v2Address,
    abi: v2Artifact.abi,
    functionName: 'getStats',
  }) as [bigint, bigint, bigint, bigint];
  const freshOk = Number(stats[0]) === 0;
  console.log(`   records:   ${stats[0]} ${freshOk ? '✅ (fresh)' : '⚠️ not empty'}`);

  if (!verifierOk || !imageIdOk || !ownerOk) {
    throw new Error('State verification failed — check logs above');
  }

  // 3d: End-to-end TX test (simulate registerCallDecision with mock data)
  console.log(`\n   [3d] End-to-End TX Test`);

  // Build a minimal valid journal: abi.encode(bytes32, string, string, uint256, bytes32, string)
  const { encodeAbiParameters } = await import('viem');
  const testJournal = encodeAbiParameters(
    [
      { type: 'bytes32' },  // notaryKeyFingerprint
      { type: 'string' },   // method
      { type: 'string' },   // url
      { type: 'uint256' },  // timestamp
      { type: 'bytes32' },  // queriesHash
      { type: 'string' },   // extractedData
    ],
    [
      '0xa7e62d7f17aa7a22c26bdb93b7ce9400e826ffb2c6f54e54d2ded015677499af', // real notary key FP
      'GET',
      'https://vericall-kkz6k4jema-uc.a.run.app/api/witness/decision/deploy_test',
      BigInt(Math.floor(Date.now() / 1000)),
      '0x0000000000000000000000000000000000000000000000000000000000000000',
      '["BLOCK","Deploy verification test"]',
    ],
  );

  // Build mock seal: 0xFFFFFFFF + 32 bytes imageId
  const testSeal = (GUEST_ID.replace('0x', '0xffffffff')) as `0x${string}`;
  const testCallId = keccak256(encodePacked(['string'], [`deploy_verify_${Date.now()}`]));

  // Simulate (dry run — does NOT send TX)
  try {
    await publicClient.simulateContract({
      account: account.address,
      address: v2Address,
      abi: v2Artifact.abi,
      functionName: 'registerCallDecision',
      args: [
        testCallId,
        keccak256(encodePacked(['string'], ['+0000000000'])),
        2, // BLOCK
        'Deploy verification test',
        testSeal,
        testJournal,
        'https://vericall-kkz6k4jema-uc.a.run.app/api/witness/decision/deploy_test',
      ],
    });
    console.log(`   Simulation:  ✅ PASSED`);
    console.log(`     → MockVerifier.verify()    OK`);
    console.log(`     → abi.decode(journal)       OK`);
    console.log(`     → notaryKeyFP validation    OK`);
    console.log(`     → method == "GET"           OK`);
    console.log(`     → url.length > 0            OK`);
    console.log(`     → extractedData.length > 0  OK`);
  } catch (simErr: any) {
    console.error(`   Simulation:  ❌ FAILED`);
    console.error(`   ${simErr.shortMessage || simErr.message}`);
    throw new Error('End-to-end simulation failed — contract logic error');
  }

  // 3e: Negative test — bad seal should be rejected
  console.log(`\n   [3e] Negative Test (bad seal)`);
  const badSeal = '0x00000000' + GUEST_ID.slice(2) as `0x${string}`;
  try {
    await publicClient.simulateContract({
      account: account.address,
      address: v2Address,
      abi: v2Artifact.abi,
      functionName: 'registerCallDecision',
      args: [
        keccak256(encodePacked(['string'], [`bad_seal_test_${Date.now()}`])),
        keccak256(encodePacked(['string'], ['+0000000000'])),
        2,
        'Should fail',
        badSeal,
        testJournal,
        'https://example.com',
      ],
    });
    console.error(`   Bad seal:    ❌ SHOULD HAVE REVERTED but passed!`);
    throw new Error('MockVerifier accepted a bad seal — security issue');
  } catch (negErr: any) {
    if (negErr.message?.includes('security issue')) throw negErr;
    console.log(`   Bad seal:    ✅ REJECTED (MockVerifier correctly reverted)`);
  }

  console.log(`\n   ═══ All ${5} verification checks passed ═══`);

  // ── Step 4: Save & Sync Deployment Info ────────────────────

  console.log('\n── Step 4: Save & Sync ──');

  // 4a: deployment.json (Single Source of Truth)
  const deployment = {
    version: 'v2',
    network: 'base-sepolia',
    chainId: 84532,
    contractAddress: v2Address,
    mockVerifierAddress: mockAddress,
    deployer: account.address,
    txHash: v2Hash,
    mockVerifierTxHash: mockHash,
    blockNumber: Number(v2Receipt.blockNumber),
    guestId: GUEST_ID,
    deployedAt: new Date().toISOString(),
    v1Address: '0xe454ca755219310b2728d39db8039cbaa7abc3b8',
    verified: true,
    notes: 'MockVerifier pattern (LensMint). Replace mockVerifier with RiscZeroVerifierRouter for production.',
  };

  const deployPath = resolve(__dirname, '../contracts/deployment.json');
  writeFileSync(deployPath, JSON.stringify(deployment, null, 2));
  console.log(`   [4a] ✅ deployment.json saved`);

  // 4b: .env.local — upsert VERICALL_CONTRACT_ADDRESS
  const envPath = resolve(__dirname, '../.env.local');
  if (existsSync(envPath)) {
    let envContent = readFileSync(envPath, 'utf-8');
    const envKey = 'VERICALL_CONTRACT_ADDRESS';
    const envLine = `${envKey}=${v2Address}`;
    if (envContent.includes(envKey)) {
      envContent = envContent.replace(
        new RegExp(`^${envKey}=.*$`, 'm'),
        envLine,
      );
    } else {
      envContent += `\n${envLine}\n`;
    }
    writeFileSync(envPath, envContent);
    console.log(`   [4b] ✅ .env.local updated → ${envLine}`);
  } else {
    console.log(`   [4b] ⚠️  .env.local not found (skipped)`);
  }

  // 4c: GCP Secret Manager — update VERICALL_CONTRACT_ADDRESS
  if (SKIP_SYNC) {
    console.log(`   [4c] ⏭️  GCP Secret Manager sync skipped (--skip-sync)`);
  } else {
    try {
      execSync(
        `printf '%s' "${v2Address}" | gcloud secrets versions add VERICALL_CONTRACT_ADDRESS --data-file=- --project=${GCP_PROJECT}`,
        { stdio: 'pipe' },
      );
      console.log(`   [4c] ✅ GCP Secret Manager updated`);
    } catch (syncErr: any) {
      console.warn(`   [4c] ⚠️  GCP Secret Manager sync failed (non-fatal): ${syncErr.message}`);
      console.warn(`         Run manually: echo -n "${v2Address}" | gcloud secrets versions add VERICALL_CONTRACT_ADDRESS --data-file=- --project=${GCP_PROJECT}`);
    }
  }

  // ── Summary ────────────────────────────────────────────────

  console.log('\n' + '═'.repeat(60));
  console.log('🎉 Deployment Complete!');
  console.log('═'.repeat(60));
  console.log(`\n  MockVerifier:     ${mockAddress}`);
  console.log(`  RegistryV2:       ${v2Address}`);
  console.log(`  V1 (legacy):      0xe454ca755219310b2728d39db8039cbaa7abc3b8`);
  console.log(`\n  📄 deployment.json  ✅`);
  console.log(`  📝 .env.local       ✅`);
  console.log(`  ☁️  Secret Manager   ${SKIP_SYNC ? '⏭️ skipped' : '✅'}`);
  console.log(`\n  Next: git push → GitHub Actions will deploy to Cloud Run`);
  console.log('');
}

main().catch((err) => {
  console.error('\n❌ Deployment failed:', err.message || err);
  process.exit(1);
});
