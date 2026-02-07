#!/usr/bin/env npx tsx
/**
 * VeriCall Registry Inspector — CLI (V2)
 *
 * Read on-chain records from VeriCallRegistryV2 and decode the
 * vlayer ZK proof journal data using on-chain getProvenData().
 *
 * Usage:
 *   npx tsx scripts/check-registry.ts [--json] [--v1]
 *
 * V2 uses on-chain getProvenData() for journal decoding — no more
 * heuristic byte-scanning. Each record also has a `verified` flag.
 */

import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { VERICALL_REGISTRY_ABI } from '../lib/witness/abi';

// ─── V1 ABI (legacy, for --v1 mode) ──────────────────────────

const V1_ABI = [
  { type: 'function', name: 'getStats', inputs: [], outputs: [{ name: 'total', type: 'uint256' }, { name: 'accepted', type: 'uint256' }, { name: 'blocked', type: 'uint256' }, { name: 'recorded', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'owner', inputs: [], outputs: [{ name: '', type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'guestId', inputs: [], outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view' },
  { type: 'function', name: 'callIds', inputs: [{ name: '', type: 'uint256' }], outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view' },
  { type: 'function', name: 'getRecord', inputs: [{ name: 'callId', type: 'bytes32' }], outputs: [{ name: '', type: 'tuple', components: [{ name: 'callerHash', type: 'bytes32' }, { name: 'decision', type: 'uint8' }, { name: 'reason', type: 'string' }, { name: 'journalHash', type: 'bytes32' }, { name: 'zkProofSeal', type: 'bytes' }, { name: 'journalDataAbi', type: 'bytes' }, { name: 'sourceUrl', type: 'string' }, { name: 'timestamp', type: 'uint256' }, { name: 'submitter', type: 'address' }] }], stateMutability: 'view' },
  { type: 'function', name: 'verifyJournal', inputs: [{ name: 'callId', type: 'bytes32' }, { name: 'journalData', type: 'bytes' }], outputs: [{ name: '', type: 'bool' }], stateMutability: 'view' },
] as const;

// ─── Config ────────────────────────────────────────────────────

const V1_CONTRACT = '0xe454ca755219310b2728d39db8039cbaa7abc3b8' as `0x${string}`;

const USE_V1 = process.argv.includes('--v1');
const CONTRACT = (
  USE_V1
    ? V1_CONTRACT
    : (process.env.VERICALL_CONTRACT_ADDRESS || (() => {
        // Read V2 address from deployment.json if available
        try {
          const { readFileSync } = require('fs');
          const { resolve } = require('path');
          const dep = JSON.parse(readFileSync(resolve(__dirname, '../contracts/deployment.json'), 'utf-8'));
          return dep.contractAddress;
        } catch {
          return '0x0000000000000000000000000000000000000000';
        }
      })())
) as `0x${string}`;

const RPC_URL = process.env.ETHEREUM_RPC_URL || 'https://sepolia.base.org';
const BASESCAN = 'https://sepolia.basescan.org';
const JSON_MODE = process.argv.includes('--json');

// ─── Decision Labels ──────────────────────────────────────────

const DECISION_LABEL: Record<number, string> = {
  0: '❓ UNKNOWN',
  1: '✅ ACCEPT',
  2: '🚫 BLOCK',
  3: '📝 RECORD',
};

const DECISION_COLOR: Record<number, string> = {
  0: '\x1b[90m',  // gray
  1: '\x1b[32m',  // green
  2: '\x1b[31m',  // red
  3: '\x1b[33m',  // yellow
};

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';

// ─── Main ──────────────────────────────────────────────────────

async function main() {
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  // Select ABI based on version
  const ABI = USE_V1 ? V1_ABI : VERICALL_REGISTRY_ABI;

  // Header
  if (!JSON_MODE) {
    console.log(`\n${BOLD}⛓️  VeriCall Registry Inspector (${USE_V1 ? 'V1' : 'V2'})${RESET}`);
    console.log(`${DIM}Contract: ${CONTRACT}${RESET}`);
    console.log(`${DIM}Network:  Base Sepolia (chainId 84532)${RESET}`);
    console.log(`${DIM}Explorer: ${BASESCAN}/address/${CONTRACT}${RESET}\n`);
  }

  // Verify bytecode exists
  const code = await client.getCode({ address: CONTRACT });
  if (!code || code === '0x') {
    throw new Error(`No bytecode at ${CONTRACT} — wrong address or not deployed`);
  }

  // Get stats
  const stats = (await client.readContract({
    address: CONTRACT,
    abi: ABI,
    functionName: 'getStats',
  })) as [bigint, bigint, bigint, bigint];

  const totalRecords = Number(stats[0]);
  const accepted = Number(stats[1]);
  const blocked = Number(stats[2]);
  const recorded = Number(stats[3]);

  if (!JSON_MODE) {
    console.log(`${BOLD}📊 Registry Stats${RESET}`);
    console.log(`   Total:    ${totalRecords}`);
    console.log(`   ${DECISION_COLOR[1]}Accepted: ${accepted}${RESET}`);
    console.log(`   ${DECISION_COLOR[2]}Blocked:  ${blocked}${RESET}`);
    console.log(`   ${DECISION_COLOR[3]}Recorded: ${recorded}${RESET}`);
    console.log('');
  }

  // Get owner & V2-specific fields
  const owner = (await client.readContract({
    address: CONTRACT,
    abi: ABI,
    functionName: 'owner',
  })) as string;

  // V2: imageId + verifier (V1 had guestId)
  let imageId = '';
  let verifierAddr = '';
  let guestId = '';
  if (USE_V1) {
    guestId = (await client.readContract({
      address: CONTRACT,
      abi: ABI,
      functionName: 'guestId',
    })) as string;
  } else {
    imageId = (await client.readContract({
      address: CONTRACT,
      abi: ABI,
      functionName: 'imageId',
    })) as string;

    verifierAddr = (await client.readContract({
      address: CONTRACT,
      abi: ABI,
      functionName: 'verifier',
    })) as string;
  }

  if (!JSON_MODE) {
    console.log(`${BOLD}🔑 Contract Info${RESET}`);
    console.log(`   Owner:     ${owner}`);
    if (USE_V1) {
      console.log(`   Guest ID:  ${guestId.slice(0, 18)}...`);
    } else {
      console.log(`   Image ID:  ${imageId.slice(0, 18)}...`);
      console.log(`   Verifier:  ${verifierAddr}`);
    }
    console.log('');
  }

  // Iterate all records
  const allRecords: any[] = [];

  for (let i = 0; i < totalRecords; i++) {
    const callId = (await client.readContract({
      address: CONTRACT,
      abi: ABI,
      functionName: 'callIds',
      args: [BigInt(i)],
    })) as `0x${string}`;

    const record = (await client.readContract({
      address: CONTRACT,
      abi: ABI,
      functionName: 'getRecord',
      args: [callId],
    })) as any;

    const decision = Number(record.decision);
    const timestamp = Number(record.timestamp);
    const date = new Date(timestamp * 1000);

    // V2: use on-chain getProvenData() for journal decoding
    let provenData = {
      notaryKeyFingerprint: '' as string,
      method: '' as string,
      url: '' as string,
      proofTimestamp: 0,
      queriesHash: '' as string,
      extractedData: '' as string,
    };

    if (!USE_V1) {
      try {
        const pd = (await client.readContract({
          address: CONTRACT,
          abi: ABI,
          functionName: 'getProvenData',
          args: [callId],
        })) as any;
        provenData = {
          notaryKeyFingerprint: pd[0] || pd.notaryKeyFingerprint || '',
          method: pd[1] || pd.method || '',
          url: pd[2] || pd.url || '',
          proofTimestamp: Number(pd[3] || pd.proofTimestamp || 0),
          queriesHash: pd[4] || pd.queriesHash || '',
          extractedData: pd[5] || pd.extractedData || '',
        };
      } catch {
        // getProvenData may fail for records without journal data
      }
    }

    // Journal integrity check
    let journalIntegrity = false;
    try {
      journalIntegrity = (await client.readContract({
        address: CONTRACT,
        abi: ABI,
        functionName: 'verifyJournal',
        args: [callId, record.journalDataAbi],
      })) as boolean;
    } catch { /* V1 may not have verifyJournal */ }

    const entry = {
      index: i,
      callId,
      callerHash: record.callerHash,
      decision: DECISION_LABEL[decision]?.replace(/[^\w ]/g, '').trim() || 'UNKNOWN',
      decisionNum: decision,
      reason: record.reason,
      sourceUrl: record.sourceUrl,
      timestamp: date.toISOString(),
      submitter: record.submitter,
      verified: !USE_V1 ? record.verified : undefined,
      zkProofSeal: `${record.zkProofSeal.slice(0, 20)}...${record.zkProofSeal.slice(-8)}`,
      zkProofSealFull: record.zkProofSeal,
      journalHash: record.journalHash,
      journalIntegrity,
      provenData: {
        notaryKeyFingerprint: provenData.notaryKeyFingerprint,
        method: provenData.method || 'N/A',
        url: provenData.url || record.sourceUrl,
        proofTimestamp: provenData.proofTimestamp
          ? new Date(provenData.proofTimestamp * 1000).toISOString()
          : 'N/A',
        queriesHash: provenData.queriesHash,
        extractedData: provenData.extractedData,
      },
      links: {
        contract: `${BASESCAN}/address/${CONTRACT}`,
        callId: `${BASESCAN}/address/${CONTRACT}#readContract`,
      },
    };

    allRecords.push(entry);

    if (!JSON_MODE) {
      const color = DECISION_COLOR[decision] || '';
      console.log(`${BOLD}━━━ Record #${i} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
      console.log(`  ${CYAN}Call ID:${RESET}     ${callId.slice(0, 18)}...`);
      console.log(`  ${CYAN}Decision:${RESET}    ${color}${DECISION_LABEL[decision]}${RESET}`);
      console.log(`  ${CYAN}Reason:${RESET}      ${record.reason}`);
      console.log(`  ${CYAN}Time:${RESET}        ${date.toISOString()}`);
      console.log(`  ${CYAN}Submitter:${RESET}   ${record.submitter}`);
      console.log(`  ${CYAN}Caller Hash:${RESET} ${record.callerHash.slice(0, 18)}...`);
      if (!USE_V1) {
        console.log(`  ${CYAN}Verified:${RESET}    ${record.verified ? `${GREEN}✅ ZK Proof Verified${RESET}` : `${RED}❌ NOT Verified${RESET}`}`);
      }
      console.log('');

      // V2: on-chain proven data (not heuristic)
      console.log(`  ${BOLD}📡 Proven Data (on-chain getProvenData):${RESET}`);
      console.log(`  ${CYAN}Method:${RESET}      ${provenData.method || 'N/A'}`);
      console.log(`  ${CYAN}URL:${RESET}         ${provenData.url || record.sourceUrl}`);
      if (provenData.proofTimestamp > 0) {
        console.log(`  ${CYAN}Proof Time:${RESET}  ${new Date(provenData.proofTimestamp * 1000).toISOString()}`);
      }
      if (provenData.extractedData) {
        console.log(`  ${CYAN}Extracted:${RESET}   ${provenData.extractedData}`);
      }
      if (provenData.notaryKeyFingerprint && provenData.notaryKeyFingerprint !== '0x' + '0'.repeat(64)) {
        console.log(`  ${CYAN}Notary FP:${RESET}  ${(provenData.notaryKeyFingerprint as string).slice(0, 18)}...`);
      }
      if (provenData.queriesHash && provenData.queriesHash !== '0x' + '0'.repeat(64)) {
        console.log(`  ${CYAN}Queries ♯:${RESET}  ${(provenData.queriesHash as string).slice(0, 18)}...`);
      }
      console.log('');

      console.log(`  ${BOLD}🔐 ZK Proof:${RESET}`);
      console.log(`  ${CYAN}Seal:${RESET}        ${record.zkProofSeal.slice(0, 30)}...`);
      console.log(`  ${CYAN}Journal:${RESET}     ${record.journalHash.slice(0, 18)}...`);
      console.log(`  ${CYAN}Integrity:${RESET}   ${journalIntegrity ? '✅ Journal hash matches on-chain commitment' : '❌ MISMATCH'}`);

      console.log('');
      console.log(`  ${BOLD}🔗 Links:${RESET}`);
      console.log(`  ${DIM}Contract: ${BASESCAN}/address/${CONTRACT}${RESET}`);
      console.log('');
    }
  }

  if (JSON_MODE) {
    console.log(JSON.stringify({
      version: USE_V1 ? 'v1' : 'v2',
      contract: CONTRACT,
      network: 'base-sepolia',
      chainId: 84532,
      stats: { total: totalRecords, accepted, blocked, recorded },
      owner,
      ...(USE_V1 ? { guestId } : { imageId, verifier: verifierAddr }),
      records: allRecords,
    }, null, 2));
  } else {
    if (totalRecords === 0) {
      console.log(`${DIM}   (no records yet)${RESET}\n`);
    }
    console.log(`${BOLD}🔗 Quick Links:${RESET}`);
    console.log(`   Contract:  ${BASESCAN}/address/${CONTRACT}`);
    console.log(`   Owner:     ${BASESCAN}/address/${owner}`);
    console.log('');
  }
}

main().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
