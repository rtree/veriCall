/**
 * vlayer REST API Client
 * Web Proof generation + ZK Proof compression
 *
 * Endpoints:
 *   Web Prover: POST /api/v1/prove
 *   ZK Prover:  POST /api/v0/compress-web-proof
 */

import { vlayerConfig } from '@/lib/config';

// ─── Types ────────────────────────────────────────────────────

export interface WebProof {
  data: string;
  version: string;
  meta: { notaryUrl: string };
}

interface CompressResult {
  success: boolean;
  data?: { zkProof: string; journalDataAbi: string };
  error?: { code: string; message: string };
}

// ─── Web Proof ────────────────────────────────────────────────

/**
 * Generate a Web Proof via vlayer Web Prover (TLSNotary).
 * Proves that an HTTP response came from a specific server.
 */
export async function generateWebProof(url: string): Promise<WebProof> {
  const { webProverUrl, apiKey, clientId } = vlayerConfig;

  if (!apiKey || !clientId) {
    throw new Error('vlayer credentials not configured (VLAYER_API_KEY / VLAYER_CLIENT_ID)');
  }

  const response = await fetch(`${webProverUrl}/api/v1/prove`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-client-id': clientId,
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ url, headers: [] }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Web Proof failed (${response.status}): ${body}`);
  }

  return (await response.json()) as WebProof;
}

// ─── ZK Proof Compression ─────────────────────────────────────

/**
 * Compress a Web Proof into a ZK Proof (RISC Zero → Groth16 BN254).
 * Extracts specified fields from the HTTP response body via JMESPath.
 */
export async function compressToZKProof(
  webProof: WebProof,
  jmespath: string[],
): Promise<{ zkProof: string; journalDataAbi: string }> {
  const { zkProverUrl, apiKey, clientId } = vlayerConfig;

  if (!apiKey || !clientId) {
    throw new Error('vlayer credentials not configured (VLAYER_API_KEY / VLAYER_CLIENT_ID)');
  }

  const response = await fetch(`${zkProverUrl}/api/v0/compress-web-proof`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-client-id': clientId,
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      presentation: webProof,
      extraction: {
        'response.body': { jmespath },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`ZK Proof compression failed (${response.status}): ${body}`);
  }

  const result = (await response.json()) as CompressResult;

  if (!result.success || !result.data) {
    throw new Error(
      `ZK Proof compression error: ${result.error?.message || 'Unknown'}`,
    );
  }

  return result.data;
}
