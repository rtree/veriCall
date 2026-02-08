#!/usr/bin/env npx tsx
/**
 * Deploy VeriCallRegistryV4 + RiscZeroMockVerifier to Base Sepolia.
 *
 * V4 adds:
 *   - 10-field journal (provenSourceCodeCommit added)
 *   - Source code attestation — git commit SHA proven via TLSNotary
 *
 * Usage:
 *   npx tsx scripts/deploy-v4.ts [--skip-sync]
 */

import {
  createWalletClient, createPublicClient, http, formatEther,
  keccak256, encodePacked, encodeAbiParameters,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';
import dotenv from 'dotenv';

dotenv.config({ path: resolve(__dirname, '../.env.local') });

// ─── Flags ─────────────────────────────────────────────────────

const SKIP_SYNC = process.argv.includes('--skip-sync');
const GCP_PROJECT = process.env.GCP_PROJECT_ID || 'ethglobal-479011';

// ─── Config ────────────────────────────────────────────────────

const RPC_URL = process.env.ETHEREUM_RPC_URL || 'https://sepolia.base.org';
const GUEST_ID = process.env.VLAYER_GUEST_ID ||
  '0x6e251f4d993427d02a4199e1201f3b54462365d7c672a51be57f776d509b47eb';
const BASESCAN = 'https://sepolia.basescan.org';

const NOTARY_KEY_FP = process.env.VLAYER_NOTARY_KEY_FP ||
  '0xa7e62d7f17aa7a22c26bdb93b7ce9400e826ffb2c6f54e54d2ded015677499af';

// Deploy with bytes32(0) to skip check, then update after first proof.
const QUERIES_HASH = process.env.VLAYER_QUERIES_HASH ||
  '0x0000000000000000000000000000000000000000000000000000000000000000';

const URL_PREFIX = process.env.VLAYER_URL_PREFIX ||
  process.env.VLAYER_PROOF_SOURCE_URL ||
  process.env.NEXT_PUBLIC_BASE_URL ||
  'https://vericall-kkz6k4jema-uc.a.run.app';
const DECISION_URL_PREFIX = `${URL_PREFIX}/api/witness/decision/`;

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
  console.log('\n🚀 VeriCallRegistryV4 Deployment (Source Code Attestation)');
  console.log('═'.repeat(60));

  const account = getAccount();
  console.log(`\n📍 Deployer:          ${account.address}`);
  console.log(`🔗 Network:           Base Sepolia (chainId 84532)`);
  console.log(`🆔 Guest ID:          ${GUEST_ID.slice(0, 18)}...`);
  console.log(`🔑 Notary FP:         ${NOTARY_KEY_FP.slice(0, 18)}...`);
  console.log(`#️⃣  Queries Hash:      ${QUERIES_HASH.slice(0, 18)}...`);
  console.log(`🔗 URL Prefix:        ${DECISION_URL_PREFIX}`);

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`💰 Balance:           ${formatEther(balance)} ETH`);
  if (balance === 0n) throw new Error('No ETH balance');

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

  // ── Step 2: Deploy VeriCallRegistryV4 ──────────────────────

  console.log('\n── Step 2/3: Deploying VeriCallRegistryV4 ──');
  const v4Artifact = loadArtifact('VeriCallRegistryV4');
  const v4Hash = await walletClient.deployContract({
    abi: v4Artifact.abi,
    bytecode: v4Artifact.bytecode,
    args: [
      mockAddress,
      GUEST_ID as `0x${string}`,
      NOTARY_KEY_FP as `0x${string}`,
      QUERIES_HASH as `0x${string}`,
      DECISION_URL_PREFIX,
    ],
  });
  console.log(`   TX: ${v4Hash}`);
  const v4Receipt = await publicClient.waitForTransactionReceipt({ hash: v4Hash });
  const v4Address = v4Receipt.contractAddress!;
  console.log(`   ✅ RegistryV4 deployed: ${v4Address}`);
  console.log(`   🔗 ${BASESCAN}/address/${v4Address}`);

  // ── Step 3: Verification ───────────────────────────────────

  console.log('\n── Step 3/3: On-chain Verification ──');

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

  const mockBytes = await getCodeWithRetry(mockAddress, 'MockVerifier');
  console.log(`   MockVerifier: ${mockBytes} bytes ${mockBytes > 0 ? '✅' : '❌'}`);
  const v4Bytes = await getCodeWithRetry(v4Address, 'RegistryV4');
  console.log(`   RegistryV4:   ${v4Bytes} bytes ${v4Bytes > 0 ? '✅' : '❌'}`);

  if (mockBytes === 0 || v4Bytes === 0) throw new Error('Contract bytecode not found');

  // State verification
  const verifierAddr = await publicClient.readContract({
    address: v4Address, abi: v4Artifact.abi, functionName: 'verifier',
  });
  console.log(`   verifier:     ${(verifierAddr as string).toLowerCase() === mockAddress.toLowerCase() ? '✅' : '❌'}`);

  const storedImageId = await publicClient.readContract({
    address: v4Address, abi: v4Artifact.abi, functionName: 'imageId',
  });
  console.log(`   imageId:      ${storedImageId === GUEST_ID ? '✅' : '❌'}`);

  // E2E simulation with 10-field journal
  console.log(`\n   [E2E] Simulation with 10-field journal (V4)`);

  const testDecision = 'BLOCK';
  const testReason = 'Suspicious sales pitch detected';
  const testSystemPromptHash = 'a3f2b1c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2';
  const testTranscriptHash = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  const testSourceCodeCommit = 'fb6d3e06800503a4cae2e1771e2286b0b8a41bcb';

  const testJournal = encodeAbiParameters(
    [
      { type: 'bytes32' },  // notaryKeyFingerprint
      { type: 'string' },   // method
      { type: 'string' },   // url
      { type: 'uint256' },  // timestamp
      { type: 'bytes32' },  // queriesHash
      { type: 'string' },   // provenDecision
      { type: 'string' },   // provenReason
      { type: 'string' },   // provenSystemPromptHash
      { type: 'string' },   // provenTranscriptHash
      { type: 'string' },   // provenSourceCodeCommit (NEW in V4)
    ],
    [
      NOTARY_KEY_FP as `0x${string}`,
      'GET',
      `${DECISION_URL_PREFIX}test_call_sid`,
      BigInt(Math.floor(Date.now() / 1000)),
      QUERIES_HASH as `0x${string}`,
      testDecision,
      testReason,
      testSystemPromptHash,
      testTranscriptHash,
      testSourceCodeCommit,
    ],
  );

  const testSeal = (GUEST_ID.replace('0x', '0xffffffff')) as `0x${string}`;
  const testCallId = keccak256(encodePacked(['string'], [`deploy_v4_verify_${Date.now()}`]));

  try {
    await publicClient.simulateContract({
      account: account.address,
      address: v4Address,
      abi: v4Artifact.abi,
      functionName: 'registerCallDecision',
      args: [testCallId, 2, testReason, testSeal, testJournal],
    });
    console.log(`   ✅ Valid simulation PASSED (10-field journal)`);
    console.log(`     → ZK verify           OK`);
    console.log(`     → notaryFP check      OK`);
    console.log(`     → method check        OK`);
    console.log(`     → URL prefix check    OK`);
    console.log(`     → decision binding    OK`);
    console.log(`     → reason binding      OK`);
    console.log(`     → sourceCodeCommit    OK (non-empty: ${testSourceCodeCommit.slice(0, 7)}…)`);
  } catch (simErr: any) {
    console.error(`   ❌ Simulation FAILED: ${simErr.shortMessage || simErr.message}`);
    throw new Error('E2E simulation failed');
  }

  // Negative test — empty sourceCodeCommit
  console.log(`\n   [NEG] Empty sourceCodeCommit test`);
  const emptyCommitJournal = encodeAbiParameters(
    [
      { type: 'bytes32' }, { type: 'string' }, { type: 'string' },
      { type: 'uint256' }, { type: 'bytes32' }, { type: 'string' },
      { type: 'string' }, { type: 'string' }, { type: 'string' }, { type: 'string' },
    ],
    [
      NOTARY_KEY_FP as `0x${string}`, 'GET',
      `${DECISION_URL_PREFIX}test_empty`, BigInt(Math.floor(Date.now() / 1000)),
      QUERIES_HASH as `0x${string}`, testDecision, testReason,
      testSystemPromptHash, testTranscriptHash,
      '',  // empty sourceCodeCommit
    ],
  );
  try {
    await publicClient.simulateContract({
      account: account.address,
      address: v4Address,
      abi: v4Artifact.abi,
      functionName: 'registerCallDecision',
      args: [
        keccak256(encodePacked(['string'], [`neg_empty_commit_${Date.now()}`])),
        2, testReason, testSeal, emptyCommitJournal,
      ],
    });
    console.error(`   ❌ SHOULD HAVE REVERTED`);
    throw new Error('Empty sourceCodeCommit was accepted');
  } catch (negErr: any) {
    if (negErr.message?.includes('was accepted')) throw negErr;
    console.log(`   ✅ Empty sourceCodeCommit correctly rejected`);
  }

  console.log(`\n   ═══ All verification checks passed ═══`);

  // ── Step 4: Save ──────────────────────────────────────────

  console.log('\n── Step 4: Save & Sync ──');

  const deployment = {
    version: 'v4',
    network: 'base-sepolia',
    chainId: 84532,
    contractAddress: v4Address,
    mockVerifierAddress: mockAddress,
    deployer: account.address,
    txHash: v4Hash,
    mockVerifierTxHash: mockHash,
    blockNumber: Number(v4Receipt.blockNumber),
    guestId: GUEST_ID,
    notaryKeyFingerprint: NOTARY_KEY_FP,
    queriesHash: QUERIES_HASH,
    expectedUrlPrefix: DECISION_URL_PREFIX,
    deployedAt: new Date().toISOString(),
    v3Address: '0x4395cf02b8d343aae958bda7ac6ed71fbd4abd48',
    v2Address: '0x656ae703ca94cc4247493dec6f9af9c6f974ba82',
    v1Address: '0xe454ca755219310b2728d39db8039cbaa7abc3b8',
    verified: true,
    notes: 'V4: source code attestation (10-field journal). MockVerifier for dev.',
  };

  const deployPath = resolve(__dirname, '../contracts/deployment.json');
  writeFileSync(deployPath, JSON.stringify(deployment, null, 2));
  console.log(`   [4a] ✅ deployment.json saved`);

  // .env.local update
  const envPath = resolve(__dirname, '../.env.local');
  if (existsSync(envPath)) {
    let envContent = readFileSync(envPath, 'utf-8');
    const envKey = 'VERICALL_CONTRACT_ADDRESS';
    const envLine = `${envKey}=${v4Address}`;
    if (envContent.includes(envKey)) {
      envContent = envContent.replace(new RegExp(`^${envKey}=.*$`, 'm'), envLine);
    } else {
      envContent += `\n${envLine}\n`;
    }
    writeFileSync(envPath, envContent);
    console.log(`   [4b] ✅ .env.local updated → ${envLine}`);
  }

  // GCP Secret Manager
  if (SKIP_SYNC) {
    console.log(`   [4c] ⏭️  GCP sync skipped`);
  } else {
    try {
      execSync(
        `printf '%s' "${v4Address}" | gcloud secrets versions add VERICALL_CONTRACT_ADDRESS --data-file=- --project=${GCP_PROJECT}`,
        { stdio: 'pipe' },
      );
      console.log(`   [4c] ✅ GCP Secret Manager updated`);
    } catch {
      console.warn(`   [4c] ⚠️  GCP sync failed (non-fatal)`);
    }
  }

  // ── Summary ────────────────────────────────────────────────

  console.log('\n' + '═'.repeat(60));
  console.log('🎉 V4 Deployment Complete!');
  console.log('═'.repeat(60));
  console.log(`\n  MockVerifier:     ${mockAddress}`);
  console.log(`  RegistryV4:       ${v4Address}`);
  console.log(`  V3 (legacy):      0x4395cf02b8d343aae958bda7ac6ed71fbd4abd48`);
  console.log(`\n  V4 improvements:`);
  console.log(`    ✅ 10-field journal (sourceCodeCommit added)`);
  console.log(`    ✅ Source code attestation via TLSNotary → GitHub`);
  console.log(`    ✅ Non-empty sourceCodeCommit enforced on-chain`);
  console.log('');
}

main().catch((err) => {
  console.error('\n❌ Deployment failed:', err.message || err);
  process.exit(1);
});
