/**
 * VeriCall Configuration
 * 共通設定ファイル
 *
 * コントラクトアドレスの優先順位:
 *   1. 環境変数 VERICALL_CONTRACT_ADDRESS（Cloud Run / .env.local）
 *   2. contracts/deployment.json（deploy-v3.ts が自動生成）
 *   ハードコードフォールバックは持たない。設定漏れは起動時に検知する。
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// ─── deployment.json loader ───────────────────────────────────

function loadDeploymentAddress(): string {
  try {
    const depPath = resolve(process.cwd(), 'contracts/deployment.json');
    const dep = JSON.parse(readFileSync(depPath, 'utf-8'));
    return dep.contractAddress || '';
  } catch {
    return '';
  }
}

// Twilio Configuration
export const twilioConfig = {
  accountSid: process.env.TWILIO_ACCOUNT_SID || '',
  authToken: process.env.TWILIO_AUTH_TOKEN || '',
  phoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
};

// Call Forwarding Configuration
export const forwardingConfig = {
  defaultDestination: process.env.DESTINATION_PHONE_NUMBER || '',
  timeout: parseInt(process.env.FORWARD_TIMEOUT || '30', 10),
  whitelist: (process.env.WHITELIST_NUMBERS || '').split(',').filter(Boolean),
};

// Vlayer Configuration
export const vlayerConfig = {
  webProverUrl: process.env.VLAYER_WEB_PROVER_URL || 'https://web-prover.vlayer.xyz',
  zkProverUrl: process.env.VLAYER_ZK_PROVER_URL || 'https://zk-prover.vlayer.xyz',
  apiKey: process.env.VLAYER_API_KEY || '',
  clientId: process.env.VLAYER_CLIENT_ID || '',
};

// Blockchain Configuration
export const chainConfig = {
  rpcUrl: process.env.ETHEREUM_RPC_URL || 'https://sepolia.base.org',
  chainId: parseInt(process.env.CHAIN_ID || '84532', 10),
};

// VeriCallRegistry Contract (Base Sepolia)
// Single Source of Truth: env var > deployment.json > error
const _contractAddr = process.env.VERICALL_CONTRACT_ADDRESS || loadDeploymentAddress();
if (!_contractAddr) {
  console.warn(
    '⚠️  VERICALL_CONTRACT_ADDRESS not set and contracts/deployment.json not found. ' +
    'Run `npx tsx scripts/deploy-v3.ts` to deploy and generate it.',
  );
}
export const contractConfig = {
  address: _contractAddr,
};

// Server Configuration
export const serverConfig = {
  baseUrl: process.env.NEXT_PUBLIC_BASE_URL || '',
  nodeEnv: process.env.NODE_ENV || 'development',
};
