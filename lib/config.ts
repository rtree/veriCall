/**
 * VeriCall Configuration
 * 共通設定ファイル
 */

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
};

// Blockchain Configuration
export const chainConfig = {
  rpcUrl: process.env.ETHEREUM_RPC_URL || 'https://sepolia.base.org',
  chainId: parseInt(process.env.CHAIN_ID || '84532', 10),
};

// Server Configuration
export const serverConfig = {
  baseUrl: process.env.NEXT_PUBLIC_BASE_URL || '',
  nodeEnv: process.env.NODE_ENV || 'development',
};
