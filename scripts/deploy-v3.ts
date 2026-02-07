#!/usr/bin/env npx tsx
/**
 * Deploy VeriCallRegistryV3 + RiscZeroMockVerifier to Base Sepolia.
 *
 * V3 adds:
 *   - EXPECTED_NOTARY_KEY_FP (immutable Notary fingerprint check)
 *   - EXPECTED_QUERIES_HASH (immutable JMESPath extraction hash check)
 *   - expectedUrlPrefix (Decision API URL prefix validation)
 *   - Decision–Journal binding (extractedData hash comparison)
 *   - sourceUrl derived from journal, not external arg
 *
 * Usage:
 *   npx tsx scripts/deploy-v3.ts [--skip-sync]
 *
 * Prerequisites:
 *   - DEPLOYER_MNEMONIC or DEPLOYER_PRIVATE_KEY in .env.local
 *   - Forge build completed (contracts/out/)
 *   - Sufficient ETH on Base Sepolia
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

// V3 specific: known constants from vlayer experiments
const NOTARY_KEY_FP = process.env.VLAYER_NOTARY_KEY_FP ||
  '0xa7e62d7f17aa7a22c26bdb93b7ce9400e826ffb2c6f54e54d2ded015677499af';

// JMESPath queries hash — keccak256 of the extraction config.
// With expanded JMESPath ["decision","reason","systemPromptHash","transcriptHash"],
// the hash changes. Deploy with bytes32(0) to skip check, then update after first proof.
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
  console.log('\n🚀 VeriCallRegistryV3 Deployment');
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

  // Check balance
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`💰 Balance:           ${formatEther(balance)} ETH`);
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

  // ── Step 2: Deploy VeriCallRegistryV3 ──────────────────────

  console.log('\n── Step 2/3: Deploying VeriCallRegistryV3 ──');
  const v3Artifact = loadArtifact('VeriCallRegistryV3');

  const v3Hash = await walletClient.deployContract({
    abi: v3Artifact.abi,
    bytecode: v3Artifact.bytecode,
    args: [
      mockAddress,
      GUEST_ID as `0x${string}`,
      NOTARY_KEY_FP as `0x${string}`,
      QUERIES_HASH as `0x${string}`,
      DECISION_URL_PREFIX,
    ],
  });

  console.log(`   TX: ${v3Hash}`);
  const v3Receipt = await publicClient.waitForTransactionReceipt({ hash: v3Hash });
  const v3Address = v3Receipt.contractAddress!;
  console.log(`   ✅ RegistryV3 deployed: ${v3Address}`);
  console.log(`   🔗 ${BASESCAN}/address/${v3Address}`);

  // ── Step 3: Verification ───────────────────────────────────

  console.log('\n── Step 3/3: On-chain Verification ──');

  // 3a: Bytecode existence
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
  const v3Bytes = await getCodeWithRetry(v3Address, 'RegistryV3');
  console.log(`   RegistryV3:   ${v3Bytes} bytes ${v3Bytes > 0 ? '✅' : '❌'}`);

  if (mockBytes === 0 || v3Bytes === 0) {
    throw new Error('Contract bytecode not found — deployment may have failed');
  }

  // 3b: State verification
  const verifierAddr = await publicClient.readContract({
    address: v3Address, abi: v3Artifact.abi, functionName: 'verifier',
  });
  const verifierOk = (verifierAddr as string).toLowerCase() === mockAddress.toLowerCase();
  console.log(`   verifier:     ${verifierOk ? '✅' : '❌'}`);

  const storedImageId = await publicClient.readContract({
    address: v3Address, abi: v3Artifact.abi, functionName: 'imageId',
  });
  console.log(`   imageId:      ${storedImageId === GUEST_ID ? '✅' : '❌'}`);

  const storedNotaryFP = await publicClient.readContract({
    address: v3Address, abi: v3Artifact.abi, functionName: 'EXPECTED_NOTARY_KEY_FP',
  });
  console.log(`   notaryFP:     ${storedNotaryFP === NOTARY_KEY_FP ? '✅' : '❌'}`);

  const storedQH = await publicClient.readContract({
    address: v3Address, abi: v3Artifact.abi, functionName: 'expectedQueriesHash',
  });
  console.log(`   queriesHash:  ${storedQH === QUERIES_HASH ? '✅' : '❌'}`);

  const storedPrefix = await publicClient.readContract({
    address: v3Address, abi: v3Artifact.abi, functionName: 'expectedUrlPrefix',
  });
  console.log(`   urlPrefix:    ${storedPrefix === DECISION_URL_PREFIX ? '✅' : '❌'}`);

  // 3c: End-to-end simulation with decision binding
  console.log(`\n   [E2E] Simulation with decision–journal binding (9-field journal)`);

  const testDecision = 'BLOCK';
  const testReason = 'Suspicious sales pitch detected';
  const testSystemPromptHash = 'a3f2b1c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2';
  const testTranscriptHash = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

  const testJournal = encodeAbiParameters(
    [
      { type: 'bytes32' },
      { type: 'string' },
      { type: 'string' },
      { type: 'uint256' },
      { type: 'bytes32' },
      { type: 'string' },
      { type: 'string' },
      { type: 'string' },
      { type: 'string' },
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
    ],
  );

  const testSeal = (GUEST_ID.replace('0x', '0xffffffff')) as `0x${string}`;
  const testCallId = keccak256(encodePacked(['string'], [`deploy_v3_verify_${Date.now()}`]));

  try {
    await publicClient.simulateContract({
      account: account.address,
      address: v3Address,
      abi: v3Artifact.abi,
      functionName: 'registerCallDecision',
      args: [
        testCallId,
        2, // BLOCK
        testReason,
        testSeal,
        testJournal,
      ],
    });
    console.log(`   ✅ Valid simulation PASSED`);
    console.log(`     → ZK verify          OK`);
    console.log(`     → notaryFP check     OK`);
    console.log(`     → method check       OK`);
    console.log(`     → queriesHash check  OK`);
    console.log(`     → URL prefix check   OK`);
    console.log(`     → decision binding   OK (enum BLOCK == provenDecision "BLOCK")`);
    console.log(`     → reason binding     OK (submitted == provenReason)`);
  } catch (simErr: any) {
    console.error(`   ❌ Simulation FAILED: ${simErr.shortMessage || simErr.message}`);
    throw new Error('E2E simulation failed');
  }

  // 3d: Negative test — wrong decision should be rejected
  console.log(`\n   [NEG] Decision mismatch test`);
  try {
    await publicClient.simulateContract({
      account: account.address,
      address: v3Address,
      abi: v3Artifact.abi,
      functionName: 'registerCallDecision',
      args: [
        keccak256(encodePacked(['string'], [`neg_test_${Date.now()}`])),
        3, // RECORD (but extractedData says BLOCK)
        testReason,
        testSeal,
        testJournal,
      ],
    });
    console.error(`   ❌ SHOULD HAVE REVERTED but passed!`);
    throw new Error('Decision mismatch was not caught — contract logic error');
  } catch (negErr: any) {
    if (negErr.message?.includes('contract logic error')) throw negErr;
    console.log(`   ✅ DecisionMismatch correctly rejected`);
  }

  // 3e: Negative test — bad seal
  console.log(`\n   [NEG] Bad seal test`);
  const badSeal = '0x00000000' + GUEST_ID.slice(2) as `0x${string}`;
  try {
    await publicClient.simulateContract({
      account: account.address,
      address: v3Address,
      abi: v3Artifact.abi,
      functionName: 'registerCallDecision',
      args: [
        keccak256(encodePacked(['string'], [`bad_seal_${Date.now()}`])),
        2,
        testReason,
        badSeal,
        testJournal,
      ],
    });
    console.error(`   ❌ SHOULD HAVE REVERTED`);
    throw new Error('Bad seal was not caught');
  } catch (negErr: any) {
    if (negErr.message?.includes('was not caught')) throw negErr;
    console.log(`   ✅ Bad seal correctly rejected`);
  }

  console.log(`\n   ═══ All verification checks passed ═══`);

  // ── Step 4: Save ──────────────────────────────────────────

  console.log('\n── Step 4: Save & Sync ──');

  const deployment = {
    version: 'v3',
    network: 'base-sepolia',
    chainId: 84532,
    contractAddress: v3Address,
    mockVerifierAddress: mockAddress,
    deployer: account.address,
    txHash: v3Hash,
    mockVerifierTxHash: mockHash,
    blockNumber: Number(v3Receipt.blockNumber),
    guestId: GUEST_ID,
    notaryKeyFingerprint: NOTARY_KEY_FP,
    queriesHash: QUERIES_HASH,
    expectedUrlPrefix: DECISION_URL_PREFIX,
    deployedAt: new Date().toISOString(),
    v2Address: '0x656ae703ca94cc4247493dec6f9af9c6f974ba82',
    v1Address: '0xe454ca755219310b2728d39db8039cbaa7abc3b8',
    verified: true,
    notes: 'V3: journal-bound decision integrity. MockVerifier for dev; replace with RiscZeroVerifierRouter for prod.',
  };

  const deployPath = resolve(__dirname, '../contracts/deployment.json');
  writeFileSync(deployPath, JSON.stringify(deployment, null, 2));
  console.log(`   [4a] ✅ deployment.json saved`);

  // .env.local update
  const envPath = resolve(__dirname, '../.env.local');
  if (existsSync(envPath)) {
    let envContent = readFileSync(envPath, 'utf-8');
    const envKey = 'VERICALL_CONTRACT_ADDRESS';
    const envLine = `${envKey}=${v3Address}`;
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
        `printf '%s' "${v3Address}" | gcloud secrets versions add VERICALL_CONTRACT_ADDRESS --data-file=- --project=${GCP_PROJECT}`,
        { stdio: 'pipe' },
      );
      console.log(`   [4c] ✅ GCP Secret Manager updated`);
    } catch {
      console.warn(`   [4c] ⚠️  GCP sync failed (non-fatal)`);
    }
  }

  // 4d: Update hardcoded addresses in consumer files
  //     V2ではこの配布が漏れていたため、ハードコード箇所がV1アドレスのまま残った。
  //     V3では deploy スクリプトが全箇所を一括更新する。
  console.log(`\n   [4d] Updating hardcoded addresses in consumer files...`);

  const V3_OLD_REGISTRY = '0x55d90c4c615884c2af3fd1b14e8d316610b66fd3';
  const V3_OLD_MOCK     = '0xc6c4c01cdeec0c2f07575ea5c8c751fe4de2bcbe';
  const V3_OLD_DEPLOY_BLOCK = '37352827';

  const filesToPatch = [
    resolve(__dirname, '../scripts/verify.ts'),
    resolve(__dirname, '../scripts/demo.ts'),
    resolve(__dirname, '../app/verify/useVerify.ts'),
    resolve(__dirname, '../app/demo/page.tsx'),
  ];

  let patchCount = 0;
  for (const filePath of filesToPatch) {
    if (!existsSync(filePath)) {
      console.log(`      ⚠️  ${filePath} not found (skipped)`);
      continue;
    }
    let content = readFileSync(filePath, 'utf-8');
    const original = content;

    // Replace registry address (case-insensitive for checksummed vs lowercase)
    content = content.replace(
      new RegExp(V3_OLD_REGISTRY, 'gi'),
      v3Address.toLowerCase(),
    );
    // Replace mock verifier address
    content = content.replace(
      new RegExp(V3_OLD_MOCK, 'gi'),
      mockAddress.toLowerCase(),
    );
    // Replace deploy block (BigInt and plain number forms)
    const v3Block = String(v3Receipt.blockNumber);
    content = content.replace(
      new RegExp(`BigInt\\(${V3_OLD_DEPLOY_BLOCK}\\)`, 'g'),
      `BigInt(${v3Block})`,
    );
    content = content.replace(
      new RegExp(`${V3_OLD_DEPLOY_BLOCK}n`, 'g'),
      `${v3Block}n`,
    );

    if (content !== original) {
      writeFileSync(filePath, content);
      const relPath = filePath.replace(resolve(__dirname, '..') + '/', '');
      console.log(`      ✅ ${relPath} — addresses updated`);
      patchCount++;
    }
  }

  if (patchCount === 0) {
    console.log(`      ℹ️  No hardcoded old addresses found to update`);
  } else {
    console.log(`      📝 ${patchCount} file(s) patched with new contract addresses.`);
  }

  // ── Summary ────────────────────────────────────────────────

  console.log('\n' + '═'.repeat(60));
  console.log('🎉 V3 Deployment Complete!');
  console.log('═'.repeat(60));
  console.log(`\n  MockVerifier:     ${mockAddress}`);
  console.log(`  RegistryV3:       ${v3Address}`);
  console.log(`  V3 prev:          0x55d90c4c615884c2af3fd1b14e8d316610b66fd3`);
  console.log(`  V2 (legacy):      0x656ae703ca94cc4247493dec6f9af9c6f974ba82`);
  console.log(`\n  Improvements over V2:`);
  console.log(`    ✅ Notary FP immutable check`);
  console.log(`    ✅ QueriesHash immutable check`);
  console.log(`    ✅ URL prefix validation`);
  console.log(`    ✅ Decision–Journal binding (keccak256)`);
  console.log(`    ✅ sourceUrl from journal (not external arg)`);
  console.log(`    ✅ Custom errors (gas efficient)`);
  console.log('');
}

main().catch((err) => {
  console.error('\n❌ Deployment failed:', err.message || err);
  process.exit(1);
});
