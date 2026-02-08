/**
 * PoC: GitHub Code Attestation via vlayer Web Prover
 *
 * Tests whether vlayer's TLSNotary Web Prover can attest
 * the contents of a file from GitHub's Raw API.
 *
 * If this works, we can prove on-chain that:
 *   SHA-256(GitHub file content) === on-chain systemPromptHash
 *   → The system prompt used by VeriCall matches the public GitHub repo
 *
 * Usage:
 *   npx tsx playground/github-attestation/01-test-github-web-proof.ts
 *
 * Requires: VLAYER_API_KEY, VLAYER_CLIENT_ID in .env.local
 */

import 'dotenv/config';
import { config } from 'dotenv';
import { resolve } from 'path';
import crypto from 'crypto';

// Load .env.local from project root
config({ path: resolve(process.cwd(), '.env.local') });

const VLAYER_WEB_PROVER_URL = process.env.VLAYER_WEB_PROVER_URL || 'https://web-prover.vlayer.xyz';
const VLAYER_ZK_PROVER_URL = process.env.VLAYER_ZK_PROVER_URL || 'https://zk-prover.vlayer.xyz';
const VLAYER_API_KEY = process.env.VLAYER_API_KEY || '';
const VLAYER_CLIENT_ID = process.env.VLAYER_CLIENT_ID || '';

// ── Configuration ─────────────────────────────────────────────

const GITHUB_OWNER = 'rtree';
const GITHUB_REPO = 'veriCall';
const GITHUB_REF = 'master';  // branch or commit SHA
const TARGET_FILE = 'lib/voice-ai/gemini.ts';

const GITHUB_RAW_URL = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_REF}/${TARGET_FILE}`;

// ── Helpers ───────────────────────────────────────────────────

function sha256(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

// ── Step 1: Fetch file directly (baseline) ────────────────────

async function fetchBaseline() {
  console.log(`\n📄 Step 0: Direct fetch (baseline)`);
  console.log(`   URL: ${GITHUB_RAW_URL}`);

  const res = await fetch(GITHUB_RAW_URL);
  if (!res.ok) throw new Error(`GitHub fetch failed: ${res.status}`);

  const content = await res.text();
  const hash = sha256(content);

  console.log(`   ✅ Fetched ${content.length} bytes`);
  console.log(`   📊 SHA-256: ${hash}`);
  console.log(`   📊 First 100 chars: ${content.slice(0, 100).replace(/\n/g, '\\n')}`);

  return { content, hash };
}

// ── Step 2: Web Proof via vlayer ──────────────────────────────

async function generateWebProof() {
  console.log(`\n🔐 Step 1: Generating Web Proof (TLSNotary) for GitHub Raw URL`);
  console.log(`   URL: ${GITHUB_RAW_URL}`);

  if (!VLAYER_API_KEY || !VLAYER_CLIENT_ID) {
    throw new Error('VLAYER_API_KEY / VLAYER_CLIENT_ID not set');
  }

  const startTime = Date.now();
  const response = await fetch(`${VLAYER_WEB_PROVER_URL}/api/v1/prove`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-client-id': VLAYER_CLIENT_ID,
      'Authorization': `Bearer ${VLAYER_API_KEY}`,
    },
    body: JSON.stringify({
      url: GITHUB_RAW_URL,
      headers: [],
    }),
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Web Proof failed (${response.status}) after ${elapsed}s: ${body}`);
  }

  const webProof = await response.json();
  console.log(`   ✅ Web Proof generated in ${elapsed}s`);
  console.log(`   📊 Proof data: ${webProof.data?.length || 0} chars`);
  console.log(`   📊 Version: ${webProof.version || 'unknown'}`);
  console.log(`   📊 Notary: ${webProof.meta?.notaryUrl || 'unknown'}`);

  return webProof;
}

// ── Step 3: ZK Compression ────────────────────────────────────

/**
 * For a raw file (not JSON), JMESPath won't work in the usual way.
 * We test with an empty extraction to see if ZK compression works at all.
 * The journal will contain URL, method, notary FP, etc. — that's already valuable.
 *
 * If the GitHub response is not JSON (it's raw text), the ZK prover
 * might need a different extraction strategy. Let's find out.
 */
async function compressToZK(webProof: any) {
  console.log(`\n🧮 Step 2: Compressing to ZK Proof (RISC Zero)`);

  const startTime = Date.now();
  const response = await fetch(`${VLAYER_ZK_PROVER_URL}/api/v0/compress-web-proof`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-client-id': VLAYER_CLIENT_ID,
      'Authorization': `Bearer ${VLAYER_API_KEY}`,
    },
    body: JSON.stringify({
      presentation: webProof,
      extraction: {
        // Empty extraction — just prove the URL and response existence
        'response.body': { jmespath: [] },
      },
    }),
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.log(`   ❌ ZK compression failed (${response.status}) after ${elapsed}s`);
    console.log(`   Body: ${body.slice(0, 500)}`);
    return null;
  }

  const result = await response.json();
  console.log(`   ✅ ZK Proof compressed in ${elapsed}s`);
  console.log(`   📊 Success: ${result.success}`);

  if (result.data) {
    console.log(`   📊 Seal: ${result.data.zkProof?.slice(0, 40)}...`);
    console.log(`   📊 Journal: ${result.data.journalDataAbi?.slice(0, 60)}...`);
  }

  return result;
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  GitHub Code Attestation PoC — vlayer Web Prover');
  console.log('═══════════════════════════════════════════════════════');

  // Baseline
  const baseline = await fetchBaseline();

  // Web Proof
  try {
    const webProof = await generateWebProof();

    // ZK Compression (may fail for raw text — that's OK, we want to know)
    try {
      const zkResult = await compressToZK(webProof);

      if (zkResult?.success) {
        console.log('\n🎉 FULL SUCCESS: GitHub Raw URL → Web Proof → ZK Proof');
        console.log('   This means we can prove on-chain that GitHub hosts this exact code.');
      }
    } catch (err) {
      console.log(`\n⚠️  ZK compression failed (expected for raw text — see notes below)`);
      console.log(`   Error: ${err}`);
      console.log(`\n   📝 Note: If ZK fails because the response is not JSON,`);
      console.log(`      we could wrap the file content in a JSON API endpoint on GitHub`);
      console.log(`      (e.g., use GitHub API's contents endpoint instead of raw).`);
    }

    console.log('\n─── RESULT ─────────────────────────────────────────');
    console.log(`✅ Web Proof WORKS for GitHub Raw URL`);
    console.log(`   File hash (baseline): ${baseline.hash}`);
    console.log(`   This hash can be compared against on-chain systemPromptHash`);
    console.log('');
    console.log('   Next steps:');
    console.log('   1. Test with GitHub API (JSON) for JMESPath extraction');
    console.log('   2. Design V4 contract with dual-proof verification');
    console.log('   3. Integrate into witness pipeline');
  } catch (err) {
    console.error(`\n❌ Web Proof generation failed:`, err);
    console.log('\n   This might mean:');
    console.log('   - raw.githubusercontent.com is not in vlayer\'s allowlist');
    console.log('   - TLSNotary cannot MPC-attest this particular TLS session');
    console.log('   - API credentials are wrong');
  }
}

main().catch(console.error);
