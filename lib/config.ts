// Twilio Configuration
export const twilioConfig = {
  accountSid: process.env.TWILIO_ACCOUNT_SID || '',
  authToken: process.env.TWILIO_AUTH_TOKEN || '',
  phoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
};

// Call Forwarding Configuration
export const forwardingConfig = {
  // Default destination for forwarded calls
  defaultDestination: process.env.DESTINATION_PHONE_NUMBER || '',
  
  // Timeout in seconds before going to voicemail
  timeout: parseInt(process.env.FORWARD_TIMEOUT || '30', 10),
  
  // Allowed caller patterns (for MVP, simple whitelist)
  whitelist: (process.env.WHITELIST_NUMBERS || '').split(',').filter(Boolean),
};

// Vlayer Configuration
export const vlayerConfig = {
  // Web Prover Server URL
  webProverUrl: process.env.VLAYER_WEB_PROVER_URL || 'https://web-prover.vlayer.xyz',
  
  // ZK Prover Server URL
  zkProverUrl: process.env.VLAYER_ZK_PROVER_URL || 'https://zk-prover.vlayer.xyz',
  
  // API Key for Vlayer
  apiKey: process.env.VLAYER_API_KEY || '',
};

// Blockchain Configuration
export const blockchainConfig = {
  rpcUrl: process.env.ETHEREUM_RPC_URL || 'https://sepolia.base.org',
  chainId: parseInt(process.env.CHAIN_ID || '84532', 10), // Base Sepolia
  contractAddress: process.env.VERICALL_CONTRACT_ADDRESS || '',
  privateKey: process.env.DEPLOYER_PRIVATE_KEY || '',
};

// Server Configuration
export const serverConfig = {
  baseUrl: process.env.NEXT_PUBLIC_BASE_URL || '',
  nodeEnv: process.env.NODE_ENV || 'development',
};

// Validate required configuration
export function validateConfig(): { valid: boolean; missing: string[] } {
  const required = [
    ['TWILIO_ACCOUNT_SID', twilioConfig.accountSid],
    ['TWILIO_AUTH_TOKEN', twilioConfig.authToken],
    ['TWILIO_PHONE_NUMBER', twilioConfig.phoneNumber],
    ['DESTINATION_PHONE_NUMBER', forwardingConfig.defaultDestination],
  ];

  const missing = required.filter(([_, value]) => !value).map(([name]) => name as string);

  return {
    valid: missing.length === 0,
    missing,
  };
}
