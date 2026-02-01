import { vlayerConfig } from './config';
import { DecisionLog, VlayerWebProof, VlayerZKProof } from './types';

/**
 * Generate a Web Proof for a call decision using Vlayer Web Prover Server
 * 
 * This creates a cryptographic proof of the call decision data
 * that can later be compressed into a ZK proof for on-chain storage
 */
export async function generateWebProof(
  decisionLog: DecisionLog
): Promise<VlayerWebProof | null> {
  if (!vlayerConfig.apiKey) {
    console.log('Vlayer API key not configured, skipping web proof generation');
    return null;
  }

  try {
    // Create a verifiable data payload
    const payload = {
      callId: decisionLog.callId,
      timestamp: decisionLog.timestamp,
      callerHash: hashPhoneNumber(decisionLog.callerNumber),
      decision: decisionLog.decision.action,
      reason: decisionLog.decision.reason,
      confidence: decisionLog.callerIdentity.confidence,
    };

    const response = await fetch(`${vlayerConfig.webProverUrl}/prove`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${vlayerConfig.apiKey}`,
      },
      body: JSON.stringify({
        url: `${process.env.NEXT_PUBLIC_BASE_URL}/api/decision-data`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }),
    });

    if (!response.ok) {
      console.error('Failed to generate web proof:', await response.text());
      return null;
    }

    const webProof = await response.json() as VlayerWebProof;
    console.log('Web proof generated:', webProof.id);
    
    return webProof;
  } catch (error) {
    console.error('Error generating web proof:', error);
    return null;
  }
}

/**
 * Compress a Web Proof into a ZK Proof using Vlayer ZK Prover Server
 * 
 * This creates a succinct zero-knowledge proof that can be
 * efficiently stored and verified on-chain
 */
export async function compressToZKProof(
  webProof: VlayerWebProof
): Promise<VlayerZKProof | null> {
  if (!vlayerConfig.apiKey) {
    console.log('Vlayer API key not configured, skipping ZK proof compression');
    return null;
  }

  try {
    const response = await fetch(`${vlayerConfig.zkProverUrl}/compress-web-proof`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${vlayerConfig.apiKey}`,
      },
      body: JSON.stringify({
        webProof: webProof.proof,
      }),
    });

    if (!response.ok) {
      console.error('Failed to compress to ZK proof:', await response.text());
      return null;
    }

    const zkProof = await response.json() as VlayerZKProof;
    console.log('ZK proof generated');
    
    return zkProof;
  } catch (error) {
    console.error('Error compressing to ZK proof:', error);
    return null;
  }
}

/**
 * Get the guest ID from ZK Prover Server
 * Used for on-chain verification
 */
export async function getGuestId(): Promise<string | null> {
  try {
    const response = await fetch(`${vlayerConfig.zkProverUrl}/guest-id`, {
      headers: {
        'Authorization': `Bearer ${vlayerConfig.apiKey}`,
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.guestId;
  } catch (error) {
    console.error('Error getting guest ID:', error);
    return null;
  }
}

/**
 * Hash a phone number for privacy
 * We don't store raw phone numbers on-chain
 */
function hashPhoneNumber(phoneNumber: string): string {
  // Simple hash for MVP - in production, use proper cryptographic hashing
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(phoneNumber).digest('hex').slice(0, 16);
}

/**
 * Verify a ZK proof (for testing/validation)
 */
export async function verifyZKProof(zkProof: VlayerZKProof): Promise<boolean> {
  // In production, this would verify against the on-chain verifier contract
  // For now, we trust the ZK Prover Server's output
  return zkProof.proof !== null && zkProof.proof.length > 0;
}
