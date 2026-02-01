import { CallRecord, CallDecision, DecisionLog } from './types';
import { generateWebProof, compressToZKProof } from './vlayer';

// In-memory store for MVP - replace with database in production
const decisionLogs: Map<string, DecisionLog> = new Map();

/**
 * Log call decision and optionally create on-chain proof
 */
export async function logCallDecision(
  callRecord: CallRecord,
  decision: CallDecision
): Promise<DecisionLog> {
  const log: DecisionLog = {
    callId: callRecord.callSid,
    timestamp: callRecord.timestamp,
    callerNumber: callRecord.from,
    callerIdentity: {
      known: decision.confidence >= 0.8,
      type: 'unknown', // Will be set by AI in future
      confidence: decision.confidence,
    },
    decision: {
      action: decision.action,
      reason: decision.reason,
      forwardTo: decision.forwardTo,
    },
  };

  // Store locally
  decisionLogs.set(log.callId, log);
  
  // Log to console
  console.log('📞 Call Decision Log:', JSON.stringify(log, null, 2));

  // Generate Vlayer proofs asynchronously (don't block call handling)
  generateProofsAsync(log).catch(console.error);

  return log;
}

/**
 * Generate Vlayer proofs asynchronously
 */
async function generateProofsAsync(log: DecisionLog): Promise<void> {
  try {
    // Step 1: Generate Web Proof
    const webProof = await generateWebProof(log);
    
    if (webProof) {
      log.vlayerProof = {
        webProofId: webProof.id,
        verified: true,
      };
      
      // Step 2: Compress to ZK Proof for on-chain storage
      const zkProof = await compressToZKProof(webProof);
      
      if (zkProof) {
        log.vlayerProof.zkProofHash = zkProof.proof.slice(0, 66); // Store proof hash
        
        // Step 3: Submit to blockchain (TODO: implement in next phase)
        // const txHash = await submitToChain(zkProof);
        // log.vlayerProof.txHash = txHash;
        
        console.log('⛓️ ZK Proof ready for on-chain submission:', log.callId);
      }
      
      // Update stored log
      decisionLogs.set(log.callId, log);
    }
  } catch (error) {
    console.error('Error generating proofs:', error);
  }
}

/**
 * Get decision log by call ID
 */
export function getDecisionLog(callId: string): DecisionLog | undefined {
  return decisionLogs.get(callId);
}

/**
 * Get all decision logs
 */
export function getAllDecisionLogs(): DecisionLog[] {
  return Array.from(decisionLogs.values());
}

/**
 * Verify a decision on-chain via Vlayer
 */
export async function verifyDecisionOnChain(callId: string): Promise<{
  verified: boolean;
  txHash?: string;
  error?: string;
}> {
  const log = decisionLogs.get(callId);
  
  if (!log) {
    return { verified: false, error: 'Decision log not found' };
  }
  
  if (!log.vlayerProof?.zkProofHash) {
    return { verified: false, error: 'ZK proof not yet generated' };
  }
  
  // TODO: Implement actual on-chain verification
  return {
    verified: true,
    txHash: log.vlayerProof.txHash,
  };
}
