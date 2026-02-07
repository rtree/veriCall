#!/usr/bin/env npx tsx
/**
 * VeriCall Registry Inspector — CLI
 *
 * Read on-chain records from the VeriCallRegistry contract and
 * decode the vlayer ZK proof journal data.
 *
 * Usage: npx tsx scripts/check-registry.ts [--json]
 */

import { createPublicClient, http, decodeAbiParameters, hexToString } from 'viem';
import { baseSepolia } from 'viem/chains';
import { VERICALL_REGISTRY_ABI } from '../lib/witness/abi';

// ─── Config ────────────────────────────────────────────────────

const CONTRACT = (
  process.env.VERICALL_CONTRACT_ADDRESS ||
  '0xe454ca755219310b2728d39db8039cbaa7abc3b8'
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

// ─── vlayer Journal Decoder ────────────────────────────────────

/**
 * Decode the vlayer journalDataAbi.
 * Format: ABI-encoded struct with nested fields including
 * extracted values (price, symbol), request method, URL, etc.
 */
function decodeJournal(hex: string): {
  method?: string;
  url?: string;
  extractedValues: string[];
  guestId?: string;
  timestamp?: number;
} {
  try {
    // The journal is a complex nested ABI struct from vlayer.
    // We extract readable strings by scanning for UTF-8 sequences.
    const buf = Buffer.from(hex.replace(/^0x/, ''), 'hex');
    const strings: string[] = [];
    let i = 0;
    while (i < buf.length) {
      // Look for printable ASCII runs >= 3 chars
      let start = i;
      while (i < buf.length && buf[i] >= 0x20 && buf[i] < 0x7f) i++;
      if (i - start >= 3) {
        strings.push(buf.subarray(start, i).toString('utf-8'));
      }
      i++;
    }

    // Clean up: strip single-char ABI-prefix from URLs (e.g. "Bhttps://..." → "https://...")
    const cleaned = strings.map((s) => {
      const m = s.match(/^.{1}(https?:\/\/.+)$/);
      return m ? m[1] : s;
    });

    // Heuristic categorization
    const method = cleaned.find((s) => /^(GET|POST|PUT|DELETE|PATCH)$/.test(s));
    const url = cleaned.find((s) => /^https?:\/\//.test(s));
    const knownNonValues = new Set([method, url].filter(Boolean));
    const extractedValues = cleaned.filter(
      (s) =>
        !knownNonValues.has(s) &&
        // Must be meaningful length
        s.length >= 4 &&
        !s.startsWith('0x') &&
        !s.startsWith('http') &&
        /^[\x20-\x7e]+$/.test(s) &&
        // At least 50% alphanumeric characters (filter ABI garbage like ">O}:")
        (s.replace(/[^a-zA-Z0-9]/g, '').length / s.length) >= 0.5,
    );

    return { method, url, extractedValues };
  } catch {
    return { extractedValues: [] };
  }
}

// ─── Main ──────────────────────────────────────────────────────

async function main() {
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  // Header
  if (!JSON_MODE) {
    console.log(`\n${BOLD}⛓️  VeriCall Registry Inspector${RESET}`);
    console.log(`${DIM}Contract: ${CONTRACT}${RESET}`);
    console.log(`${DIM}Network:  Base Sepolia (chainId 84532)${RESET}`);
    console.log(`${DIM}Explorer: ${BASESCAN}/address/${CONTRACT}${RESET}\n`);
  }

  // Get stats
  const stats = (await client.readContract({
    address: CONTRACT,
    abi: VERICALL_REGISTRY_ABI,
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

  // Get owner & guestId
  const owner = (await client.readContract({
    address: CONTRACT,
    abi: VERICALL_REGISTRY_ABI,
    functionName: 'owner',
  })) as string;

  const guestId = (await client.readContract({
    address: CONTRACT,
    abi: VERICALL_REGISTRY_ABI,
    functionName: 'guestId',
  })) as string;

  if (!JSON_MODE) {
    console.log(`${BOLD}🔑 Contract Info${RESET}`);
    console.log(`   Owner:    ${owner}`);
    console.log(`   Guest ID: ${(guestId as string).slice(0, 18)}...`);
    console.log('');
  }

  // Iterate all records
  const allRecords: any[] = [];

  for (let i = 0; i < totalRecords; i++) {
    const callId = (await client.readContract({
      address: CONTRACT,
      abi: VERICALL_REGISTRY_ABI,
      functionName: 'callIds',
      args: [BigInt(i)],
    })) as `0x${string}`;

    const record = (await client.readContract({
      address: CONTRACT,
      abi: VERICALL_REGISTRY_ABI,
      functionName: 'getRecord',
      args: [callId],
    })) as any;

    const decision = Number(record.decision);
    const timestamp = Number(record.timestamp);
    const date = new Date(timestamp * 1000);
    const journal = decodeJournal(record.journalDataAbi);

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
      zkProofSeal: `${record.zkProofSeal.slice(0, 20)}...${record.zkProofSeal.slice(-8)}`,
      zkProofSealFull: record.zkProofSeal,
      journalHash: record.journalHash,
      journalDataAbi: record.journalDataAbi,
      provenData: {
        method: journal.method || 'N/A',
        url: journal.url || record.sourceUrl,
        values: journal.extractedValues,
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
      console.log('');
      console.log(`  ${BOLD}📡 Proven Data (from ZK Journal):${RESET}`);
      console.log(`  ${CYAN}Source:${RESET}      ${journal.url || record.sourceUrl}`);
      console.log(`  ${CYAN}Method:${RESET}      ${journal.method || 'GET'}`);
      if (journal.extractedValues.length > 0) {
        console.log(`  ${CYAN}Values:${RESET}`);
        for (const val of journal.extractedValues) {
          // Try to identify what the value is
          if (/^\d+\.\d+$/.test(val)) {
            console.log(`    💰 Price: ${BOLD}$${val}${RESET}`);
          } else if (/^[A-Z]{3,10}$/.test(val)) {
            console.log(`    🏷️  Symbol: ${BOLD}${val}${RESET}`);
          } else {
            console.log(`    📄 ${val}`);
          }
        }
      }
      console.log('');
      console.log(`  ${BOLD}🔐 ZK Proof:${RESET}`);
      console.log(`  ${CYAN}Seal:${RESET}        ${record.zkProofSeal.slice(0, 30)}...`);
      console.log(`  ${CYAN}Journal:${RESET}     ${record.journalHash.slice(0, 18)}...`);

      // Verify journal integrity
      const verified = (await client.readContract({
        address: CONTRACT,
        abi: VERICALL_REGISTRY_ABI,
        functionName: 'verifyJournal',
        args: [callId, record.journalDataAbi],
      })) as boolean;
      console.log(`  ${CYAN}Integrity:${RESET}   ${verified ? '✅ Journal hash matches on-chain commitment' : '❌ MISMATCH'}`);

      console.log('');
      console.log(`  ${BOLD}🔗 Links:${RESET}`);
      console.log(`  ${DIM}Contract: ${BASESCAN}/address/${CONTRACT}${RESET}`);
      console.log('');
    }
  }

  if (JSON_MODE) {
    console.log(JSON.stringify({
      contract: CONTRACT,
      network: 'base-sepolia',
      chainId: 84532,
      stats: { total: totalRecords, accepted, blocked, recorded },
      owner,
      guestId,
      records: allRecords,
    }, null, 2));
  } else {
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
