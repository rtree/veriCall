import { NextResponse } from 'next/server';
import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { VERICALL_REGISTRY_ABI } from '@/lib/witness/abi';
import { contractConfig, chainConfig } from '@/lib/config';

// ─── Config ────────────────────────────────────────────────────

const CONTRACT = contractConfig.address as `0x${string}`;
const RPC_URL = chainConfig.rpcUrl;
const BASESCAN = 'https://sepolia.basescan.org';

const DECISION_LABELS = ['UNKNOWN', 'ACCEPT', 'BLOCK', 'RECORD'] as const;
const DECISION_EMOJI: Record<string, string> = {
  UNKNOWN: '❓',
  ACCEPT: '✅',
  BLOCK: '🚫',
  RECORD: '📝',
};

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

    // V3: imageId + verifier
    const imageId = (await client.readContract({
      address: CONTRACT,
      abi: VERICALL_REGISTRY_ABI,
      functionName: 'imageId',
    })) as string;

    const verifier = (await client.readContract({
      address: CONTRACT,
      abi: VERICALL_REGISTRY_ABI,
      functionName: 'verifier',
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
      const timestamp = Number(record.timestamp);

      // V3: use on-chain getProvenData() for journal decoding
      let provenData = {
        method: 'N/A',
        url: record.sourceUrl,
        proofTimestamp: 0,
        extractedData: '',
        notaryKeyFingerprint: '',
        queriesHash: '',
      };
      try {
        const pd = (await client.readContract({
          address: CONTRACT,
          abi: VERICALL_REGISTRY_ABI,
          functionName: 'getProvenData',
          args: [callId],
        })) as any;
        provenData = {
          notaryKeyFingerprint: pd[0] || '',
          method: pd[1] || 'N/A',
          url: pd[2] || record.sourceUrl,
          proofTimestamp: Number(pd[3] || 0),
          queriesHash: pd[4] || '',
          extractedData: pd[5] || '',
        };
      } catch { /* journal may not be decodable */ }

      // Verify journal integrity
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
        decision: decisionLabel,
        decisionEmoji: DECISION_EMOJI[decisionLabel],
        reason: record.reason,
        sourceUrl: record.sourceUrl,
        timestamp,
        timestampISO: new Date(timestamp * 1000).toISOString(),
        submitter: record.submitter,
        verified: record.verified ?? false,
        zkProofSeal: record.zkProofSeal,
        journalHash: record.journalHash,
        journalVerified,
        provenData,
      });
    }

    return NextResponse.json({
      version: 'v3',
      contract: CONTRACT,
      network: 'Base Sepolia',
      chainId: 84532,
      basescan: `${BASESCAN}/address/${CONTRACT}`,
      owner,
      imageId,
      verifier,
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
