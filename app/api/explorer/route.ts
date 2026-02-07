import { NextResponse } from 'next/server';
import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { VERICALL_REGISTRY_ABI } from '@/lib/witness/abi';

// ─── Config ────────────────────────────────────────────────────

const CONTRACT = (
  process.env.VERICALL_CONTRACT_ADDRESS ||
  '0xe454ca755219310b2728d39db8039cbaa7abc3b8'
) as `0x${string}`;

const RPC_URL = process.env.ETHEREUM_RPC_URL || 'https://sepolia.base.org';
const BASESCAN = 'https://sepolia.basescan.org';

const DECISION_LABELS = ['UNKNOWN', 'ACCEPT', 'BLOCK', 'RECORD'] as const;
const DECISION_EMOJI: Record<string, string> = {
  UNKNOWN: '❓',
  ACCEPT: '✅',
  BLOCK: '🚫',
  RECORD: '📝',
};

// ─── Journal Decoder ────────────────────────────────────────

function decodeJournal(hex: string) {
  try {
    const buf = Buffer.from(hex.replace(/^0x/, ''), 'hex');
    const strings: string[] = [];
    let i = 0;
    while (i < buf.length) {
      let start = i;
      while (i < buf.length && buf[i] >= 0x20 && buf[i] < 0x7f) i++;
      if (i - start >= 3) {
        strings.push(buf.subarray(start, i).toString('utf-8'));
      }
      i++;
    }

    const method = strings.find((s) => /^(GET|POST|PUT|DELETE|PATCH)$/.test(s));
    const url = strings.find((s) => s.startsWith('https://'));
    const knownNonValues = new Set([method, url].filter(Boolean));
    const extractedValues = strings.filter(
      (s) =>
        !knownNonValues.has(s) &&
        s.length >= 3 &&
        !s.startsWith('0x') &&
        !s.startsWith('http') &&
        /^[\x20-\x7e]+$/.test(s) &&
        /[a-zA-Z0-9]/.test(s) &&
        !/^[^a-zA-Z0-9]*$/.test(s),
    );

    // Categorize values
    const price = extractedValues.find((v) => /^\d+\.\d+$/.test(v));
    const symbol = extractedValues.find((v) => /^[A-Z]{3,10}$/.test(v));

    return { method: method || 'GET', url, price, symbol, raw: extractedValues };
  } catch {
    return { method: 'GET', url: undefined, price: undefined, symbol: undefined, raw: [] };
  }
}

// ─── API Route ──────────────────────────────────────────────

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const client = createPublicClient({
      chain: baseSepolia,
      transport: http(RPC_URL),
    });

    // Get stats
    const stats = (await client.readContract({
      address: CONTRACT,
      abi: VERICALL_REGISTRY_ABI,
      functionName: 'getStats',
    })) as [bigint, bigint, bigint, bigint];

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

    const totalRecords = Number(stats[0]);

    // Fetch all records
    const records = [];
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
      const decisionLabel = DECISION_LABELS[decision] || 'UNKNOWN';
      const journal = decodeJournal(record.journalDataAbi);
      const timestamp = Number(record.timestamp);

      // Verify journal
      let journalVerified = false;
      try {
        journalVerified = (await client.readContract({
          address: CONTRACT,
          abi: VERICALL_REGISTRY_ABI,
          functionName: 'verifyJournal',
          args: [callId, record.journalDataAbi],
        })) as boolean;
      } catch { /* ignore */ }

      records.push({
        index: i,
        callId,
        callerHash: record.callerHash,
        decision: decisionLabel,
        decisionEmoji: DECISION_EMOJI[decisionLabel],
        reason: record.reason,
        sourceUrl: record.sourceUrl,
        timestamp,
        timestampISO: new Date(timestamp * 1000).toISOString(),
        submitter: record.submitter,
        zkProofSeal: record.zkProofSeal,
        journalHash: record.journalHash,
        journalVerified,
        provenData: {
          method: journal.method,
          url: journal.url || record.sourceUrl,
          price: journal.price,
          symbol: journal.symbol,
        },
      });
    }

    return NextResponse.json({
      contract: CONTRACT,
      network: 'Base Sepolia',
      chainId: 84532,
      basescan: `${BASESCAN}/address/${CONTRACT}`,
      owner,
      guestId,
      stats: {
        total: totalRecords,
        accepted: Number(stats[1]),
        blocked: Number(stats[2]),
        recorded: Number(stats[3]),
      },
      records,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to read contract' },
      { status: 500 },
    );
  }
}
