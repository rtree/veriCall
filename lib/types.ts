/**
 * Call record from Twilio webhook
 */
export interface CallRecord {
  callSid: string;
  from: string;
  to: string;
  callerCity?: string;
  callerState?: string;
  callerCountry?: string;
  timestamp: string;
}

/**
 * Decision action types
 */
export type DecisionAction = 'forward' | 'reject' | 'voicemail';

/**
 * Call forwarding decision
 */
export interface CallDecision {
  action: DecisionAction;
  reason: string;
  forwardTo?: string;
  confidence: number;
}

/**
 * On-chain decision log entry
 */
export interface DecisionLog {
  callId: string;
  timestamp: string;
  callerNumber: string;
  callerIdentity: {
    known: boolean;
    type: 'customer' | 'colleague' | 'vendor' | 'unknown';
    confidence: number;
  };
  decision: {
    action: DecisionAction;
    reason: string;
    forwardTo?: string;
  };
  vlayerProof?: {
    webProofId?: string;
    zkProofHash?: string;
    txHash?: string;
    verified: boolean;
  };
}

/**
 * Call status update from Twilio
 */
export interface CallStatus {
  callSid: string;
  callStatus: string;
  dialCallStatus?: string;
  duration?: number;
  timestamp: string;
}

/**
 * Vlayer Web Proof response
 */
export interface VlayerWebProof {
  id: string;
  proof: string;
  transcript: {
    request: string;
    response: string;
  };
  notaryPublicKey: string;
  timestamp: string;
}

/**
 * Vlayer ZK Proof response
 */
export interface VlayerZKProof {
  proof: string;
  publicInputs: string[];
  journalDataAbi: string;
  guestId: string;
}
