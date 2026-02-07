/**
 * On-Chain Operations for VeriCallRegistry
 * Submit call decisions and verify proofs on Base Sepolia.
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  keccak256,
  encodePacked,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { chainConfig, contractConfig } from '@/lib/config';
import { VERICALL_REGISTRY_ABI } from './abi';

// ─── Types ────────────────────────────────────────────────────

export interface OnChainSubmitParams {
  callSid: string;
  callerPhone: string;        // raw phone number (hashed before sending)
  decision: number;            // 1=ACCEPT, 2=BLOCK, 3=RECORD
  reason: string;
  zkProofSeal: string;         // 0x-prefixed hex
  journalDataAbi: string;      // 0x-prefixed hex
  sourceUrl: string;
}

export interface OnChainResult {
  txHash: string;
  blockNumber: number;
  callId: string;
  contractAddress: string;
}

// ─── Wallet ───────────────────────────────────────────────────

function getAccount() {
  const mnemonic = process.env.DEPLOYER_MNEMONIC;
  if (mnemonic) {
    return mnemonicToAccount(mnemonic.trim());
  }

  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  if (pk) {
    return privateKeyToAccount(pk as `0x${string}`);
  }

  throw new Error(
    'No wallet configured — set DEPLOYER_MNEMONIC or DEPLOYER_PRIVATE_KEY in .env.local',
  );
}

// ─── Clients (lazy singleton) ─────────────────────────────────

function getPublicClient() {
  return createPublicClient({
    chain: baseSepolia,
    transport: http(chainConfig.rpcUrl),
  });
}

// ─── Submit Decision ──────────────────────────────────────────

/**
 * Submit a call decision with ZK proof to the VeriCallRegistry contract.
 */
export async function submitDecisionOnChain(
  params: OnChainSubmitParams,
): Promise<OnChainResult> {
  const account = getAccount();
  const address = contractConfig.address as `0x${string}`;

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(chainConfig.rpcUrl),
  });

  // Deterministic callId from callSid + timestamp
  const callId = keccak256(
    encodePacked(['string'], [`vericall_${params.callSid}_${Date.now()}`]),
  );

  // Privacy: hash the phone number
  const callerHash = keccak256(
    encodePacked(['string'], [params.callerPhone]),
  );

  const hash = await walletClient.writeContract({
    address,
    abi: VERICALL_REGISTRY_ABI,
    functionName: 'registerCallDecision',
    args: [
      callId,
      callerHash,
      params.decision,
      params.reason,
      params.zkProofSeal as `0x${string}`,
      params.journalDataAbi as `0x${string}`,
      params.sourceUrl,
    ],
  });

  const receipt = await getPublicClient().waitForTransactionReceipt({ hash });

  return {
    txHash: hash,
    blockNumber: Number(receipt.blockNumber),
    callId,
    contractAddress: address,
  };
}

// ─── Read / Verify ────────────────────────────────────────────

/**
 * Verify journal data integrity for a given callId on-chain.
 */
export async function verifyJournalOnChain(
  callId: string,
  journalDataAbi: string,
): Promise<boolean> {
  const address = contractConfig.address as `0x${string}`;

  const result = await getPublicClient().readContract({
    address,
    abi: VERICALL_REGISTRY_ABI,
    functionName: 'verifyJournal',
    args: [callId as `0x${string}`, journalDataAbi as `0x${string}`],
  });

  return result as boolean;
}

/**
 * Get registry-wide statistics.
 */
export async function getRegistryStats(): Promise<{
  total: bigint;
  accepted: bigint;
  blocked: bigint;
  recorded: bigint;
}> {
  const address = contractConfig.address as `0x${string}`;

  const result = (await getPublicClient().readContract({
    address,
    abi: VERICALL_REGISTRY_ABI,
    functionName: 'getStats',
  })) as [bigint, bigint, bigint, bigint];

  return {
    total: result[0],
    accepted: result[1],
    blocked: result[2],
    recorded: result[3],
  };
}
