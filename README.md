# VeriCall

<p align="left">
  <a href="https://vericall-kkz6k4jema-uc.a.run.app/demo">
    <img src="https://img.shields.io/badge/▶_LIVE_DEMO-Watch_the_Pipeline-06b6d4?style=for-the-badge" alt="Live Demo" />
  </a>
</p>

**Verifiable AI Call Screening — Proving Fairness On-Chain**

https://vericall-kkz6k4jema-uc.a.run.app/demo

<img width="1764" height="1039" alt="image" src="https://github.com/user-attachments/assets/46d9b0ca-4f05-4421-b9ff-fdf643d71228" />

<img width="1810" height="774" alt="image" src="https://github.com/user-attachments/assets/47026f4e-58e2-47b7-b505-8e490054e4e1" />


## The Problem

Companies increasingly use AI to screen incoming phone calls — blocking spam, scams, and unwanted sales while forwarding legitimate business calls. But this creates a fundamental **trust problem**:

- **How do callers know the AI judged them fairly?**
- **What rules did the company program into the AI?**
- **Was the same ruleset applied consistently to everyone?**
- **What was the actual input the AI used to make its decision?**

Today, there is no official record. The company controls the AI, the rules, and the logs. A legitimate caller blocked by the AI has no recourse and no way to verify that the system treated them fairly.

## The Solution

VeriCall solves this by anchoring AI decisions **on-chain** using [vlayer](https://vlayer.xyz) Web Proofs and ZK Proofs.

Every time the AI makes a call screening decision, VeriCall:

1. **Records the inputs** — the conversation transcript (what the caller actually said)
2. **Records the ruleset** — the system prompt hash (the exact rules the AI was given)
3. **Records the output** — the decision (BLOCK or RECORD) and the AI's reasoning
4. **Generates a Web Proof** — a cryptographic attestation via TLSNotary that VeriCall's Decision API genuinely returned this specific decision for this specific call
5. **Compresses to a ZK Proof** — via RISC Zero, the web proof is compressed into a succinct zero-knowledge proof suitable for on-chain storage
6. **Submits on-chain** — the proof is recorded on Base, creating an immutable, publicly verifiable audit trail

### Why This Matters Beyond Phone Calls

This pattern — **proving that an AI made a specific decision given specific inputs and rules** — is universally applicable:

| Domain | What's Being Verified |
|--------|----------------------|
| 📞 Call Screening | AI fairly classified caller as spam vs. legitimate |
| 📄 Resume Screening | AI fairly evaluated job applicant |
| 🏦 Loan Decisions | AI fairly assessed creditworthiness |
| 🛡️ Content Moderation | AI fairly applied community guidelines |
| ⚖️ Insurance Claims | AI fairly processed or denied a claim |

VeriCall is a **working proof-of-concept** for this pattern — phone calls are the first use case, but the verification framework (Web Proof → ZK Proof → on-chain journal validation) is designed to be reusable for any AI decision pipeline.

> 🔍 **You don't need to trust VeriCall.** Every on-chain record can be independently verified — [from your browser](/verify) or [from the CLI](scripts/verify.ts). No API keys, no VeriCall servers, just you and the chain. See [Trust-Minimized Verification](#trust-minimized-verification).

## Architecture

```
                         VeriCall System Architecture

  ┌─────────────────────────────────────────────────────────────────────┐
  │                        REAL-TIME CALL FLOW                         │
  │                                                                    │
  │   📞 Caller ──→ Twilio ──→ WebSocket ──→ VeriCall Server          │
  │                              (μ-law)      (Cloud Run)              │
  │                                │                                   │
  │                                ▼                                   │
  │                     ┌────────────────────┐                         │
  │                     │   Audio Pipeline   │                         │
  │                     │                    │                         │
  │                     │  μ-law → Linear16  │                         │
  │                     │       │            │                         │
  │                     │  Google STT ◄──┘   │                         │
  │                     │       │            │                         │
  │                     │  Gemini 2.5 Flash  │──→ Decision             │
  │                     │       │            │   (BLOCK/RECORD)        │
  │                     │  Google TTS ◄──┘   │                         │
  │                     │       │            │                         │
  │                     │  Linear16 → μ-law  │                         │
  │                     └────────┬───────────┘                         │
  │                              │                                     │
  │                              ▼                                     │
  │                     ┌────────────────────┐                         │
  │                     │  📧 Email Notify   │                         │
  │                     │  (SendGrid)        │                         │
  │                     │  OK → Blue theme   │                         │
  │                     │  SCAM → Red theme  │                         │
  │                     └────────────────────┘                         │
  └─────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────┐
  │                     ON-CHAIN VERIFICATION FLOW                     │
  │                                                                    │
  │   Decision Made                                                    │
  │       │                                                            │
  │       ▼                                                            │
  │   ┌──────────────────┐     ┌──────────────────┐                    │
  │   │  vlayer Web      │     │  vlayer ZK       │                    │
  │   │  Prover Server   │────→│  Prover Server   │                    │
  │   │                  │     │                  │                    │
  │   │  POST /prove     │     │  POST /compress  │                    │
  │   │  TLSNotary       │     │  RISC Zero       │                    │
  │   │  (MPC Protocol)  │     │  (ZK Compress)   │                    │
  │   └──────────────────┘     └────────┬─────────┘                    │
  │                                     │                              │
  │                                     ▼                              │
  │                            ┌──────────────────┐                    │
  │                            │  Base Sepolia     │                    │
  │                            │  Smart Contract   │                    │
  │                            │                   │                    │
  │                            │  • zkProof        │                    │
  │                            │  • journalDataAbi │                    │
  │                            │  (decision, hash, │                    │
  │                            │   timestamp)      │                    │
  │                            └──────────────────┘                    │
  └─────────────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Component | Technology |
|-------|-----------|------------|
| **Frontend** | Dashboard | Next.js 16 + React 19 |
| **Server** | Runtime | Custom Node.js server with WebSocket ([server.ts](server.ts)) |
| **Hosting** | Infra | GCP Cloud Run (auto-deploy on git push) |
| **Phone** | Telephony | Twilio Programmable Voice + Media Streams |
| **Audio** | Codec | μ-law 8kHz ↔ Linear16 conversion |
| **STT** | Speech-to-Text | Google Cloud Speech v1 (`phone_call` model, Enhanced) |
| **AI** | LLM | Vertex AI Gemini 2.5 Flash (intent-based screening) |
| **TTS** | Text-to-Speech | Google Cloud Text-to-Speech |
| **Email** | Notification | SendGrid (OK/SCAM templates with conversation table) |
| **Proofs** | Web Proofs | vlayer Web Prover Server (TLSNotary / MPC) |
| **Proofs** | ZK Proofs | vlayer ZK Prover Server (RISC Zero) |
| **Chain** | Settlement | Base Sepolia (EVM) |
| **Chain** | Client | viem |

## Project Structure

```
veriCall/
├── server.ts                    # Custom server: Next.js + WebSocket /stream
│
├── lib/
│   ├── config.ts                # Twilio, vlayer, chain configuration
│   ├── db.ts                    # Cloud SQL client (IAM auth, decision persistence)
│   ├── voice-ai/
│   │   ├── session.ts           # Call session lifecycle + utterance buffering (★ core)
│   │   ├── gemini.ts            # AI screening (system prompt + chat + decision parsing)
│   │   ├── speech-to-text.ts    # Google STT streaming (phone_call model)
│   │   ├── text-to-speech.ts    # Google TTS (μ-law output)
│   │   ├── audio-utils.ts       # μ-law ↔ Linear16 codec
│   │   ├── email-notify.ts      # SendGrid email (OK/SCAM templates)
│   │   └── index.ts             # Session store (create/get/remove)
│   ├── witness/
│   │   ├── pipeline.ts          # Witness pipeline: WebProof → ZK → On-Chain (★ proof generation)
│   │   ├── vlayer-api.ts        # vlayer REST API client
│   │   ├── on-chain.ts          # Base Sepolia TX submission (viem)
│   │   ├── decision-store.ts    # Cloud SQL decision data store
│   │   └── abi.ts               # VeriCallRegistryV3 ABI
│   └── demo/
│       └── event-bus.ts         # Global EventEmitter (globalThis singleton for SSE)
│
├── app/
│   ├── page.tsx                 # Home page
│   ├── demo/
│   │   └── page.tsx             # Live demo page (SSE real-time pipeline viewer)
│   ├── verify/
│   │   ├── page.tsx             # Trust-minimized verification page (12 checks)
│   │   └── useVerify.ts         # Client-side verification hook (viem + Base Sepolia RPC)
│   ├── phone/
│   │   ├── incoming/route.ts    # Twilio incoming call webhook → TwiML + Stream
│   │   ├── status/route.ts      # Call status callbacks
│   │   └── logs/route.ts        # Call log API
│   ├── api/
│   │   ├── health/route.ts      # Health check
│   │   ├── explorer/route.ts    # On-chain data Explorer API
│   │   ├── demo/stream/route.ts # SSE endpoint for live demo (Bearer auth)
│   │   └── witness/
│   │       └── decision/[callSid]/route.ts  # Decision API (vlayer Web Proof target)
│   └── monitoring/page.tsx      # Dashboard UI
│
├── scripts/
│   ├── verify.ts                # Trust-minimized verification CLI (14 checks, --deep)
│   ├── demo.ts                  # Live demo CLI (SSE stream viewer)
│   ├── check-registry.ts        # CLI registry inspector (V1/V3)
│   ├── deploy-v3.ts             # V3 deployment script (with auto-sync + address patching)
│   └── deploy-v2.ts             # V2 deployment script (historical)
│
├── contracts/
│   ├── VeriCallRegistryV3.sol   # V3 Solidity contract (journal-bound decision integrity, current)
│   ├── VeriCallRegistryV2.sol   # V2 Solidity contract (historical)
│   ├── RiscZeroMockVerifier.sol # Mock Verifier for development
│   ├── interfaces/
│   │   └── IRiscZeroVerifier.sol # RISC Zero standard interface
│   └── deployment.json          # Deployment info (Single Source of Truth)
│
├── Dockerfile                   # Cloud Run deployment
└── .github/workflows/
    └── deploy.yml               # GitHub Actions CI/CD (auto-deploy on push)
```

## How vlayer Integration Works

### The Core Idea

When VeriCall's AI screens a call, the decision (BLOCK/RECORD) and reasoning are stored and served via VeriCall's **Decision API** (`/api/witness/decision/{callSid}`) over HTTPS. That HTTPS response is a TLS session. Using vlayer's **TLSNotary** protocol, we can have a third-party Notary cryptographically attest that VeriCall's server genuinely returned a specific decision for a specific call — without the Notary ever seeing the plaintext.

This attestation (Web Proof) is then compressed into a **ZK Proof** and stored **on-chain**, creating an immutable record that anyone can verify.

### The Verification Pipeline

#### Step 1: Capture Decision Data

At the moment the AI makes a decision, VeriCall captures everything needed for verification:

```typescript
interface DecisionData {
  callId: string;           // Unique call identifier
  timestamp: string;        // ISO 8601 timestamp
  systemPromptHash: string; // SHA-256 of the AI's ruleset (SYSTEM_PROMPT)
  transcript: string;       // Full conversation transcript
  action: 'BLOCK' | 'RECORD';
  reason: string;           // AI's stated reasoning
  confidence: number;       // Decision confidence score
}
```

#### Step 2: Generate Web Proof (vlayer Web Prover)

VeriCall's **Decision API** response is notarized using TLSNotary through vlayer's **server-side proving**:

```
vlayer Web Prover ──GET──→ VeriCall Decision API
(TLSNotary / MPC)          /api/witness/decision/{callSid}
       │
       ▼
  Web Proof
  (cryptographic attestation that this server returned this JSON)
```

- The Web Prover joins the TLS connection as a Notary via Multi-Party Computation
- It **never sees the plaintext** — it only holds half the encryption key
- It signs a commitment proving VeriCall's server genuinely returned this decision
- The proven URL points to VeriCall's Decision API, which serves the AI's decision, reason, and metadata

```
POST https://web-prover.vlayer.xyz/api/v1/prove
{
  "url": "https://vericall-kkz6k4jema-uc.a.run.app/api/witness/decision/CA1234...",
  "headers": []
}

→ Returns: { data: "base64-encoded-tlsnotary-presentation...", version: "...", meta: {...} }
```

#### Step 3: Compress to ZK Proof (vlayer ZK Prover)

The web proof is compressed into a succinct zero-knowledge proof via RISC Zero:

```
POST https://zk-prover.vlayer.xyz/api/v0/compress-web-proof
{
  "presentation": { <web proof from Step 2> },
  "extraction": {
    "response.body": {
      "jmespath": ["decision", "reason", "systemPromptHash", "transcriptHash"]
    }
  }
}

→ Returns: { zkProof: "0xffffffff...", journalDataAbi: "0x000000..." }
```

The `journalDataAbi` is an ABI-encoded tuple of 9 fields:
- `notaryKeyFingerprint` — which notary signed the proof
- `method` / `url` — the exact HTTP request proven (GET to VeriCall's Decision API)
- `timestamp` — when the TLS session occurred (not self-reported)
- `queriesHash` — hash of the JMESPath extraction config (prevents query substitution)
- `provenDecision` — the decision extracted from VeriCall's response (e.g., `"BLOCK"`)
- `provenReason` — the AI's reasoning extracted from the response
- `provenSystemPromptHash` — SHA-256 of the AI's ruleset, extracted from the response
- `provenTranscriptHash` — SHA-256 of the conversation transcript, extracted from the response

#### Step 4: On-Chain Registration + ZK Verification (Base Sepolia)

The ZK proof and journal are submitted to **VeriCallRegistryV3** on Base Sepolia. The contract performs on-chain ZK proof verification with journal-bound decision integrity before storing the record:

```
registerCallDecision(callId, decision, reason, zkProofSeal, journalDataAbi)
    │
    ├─ Step A: ZK Proof Verification (on-chain)
    │   verifier.verify(seal, imageId, sha256(journalDataAbi))
    │   └─ Calls IRiscZeroVerifier — reverts if proof is invalid
    │   └─ emit ProofVerified(callId, imageId, journalDigest)
    │
    ├─ Step B: Journal Decode & Validation (V3, 9-field journal)
    │   abi.decode(journalDataAbi) → 9 fields:
    │   ├─ notaryKeyFingerprint == EXPECTED_NOTARY_KEY_FP  ← immutable check
    │   ├─ method == "GET"                                 ← Valid HTTP method
    │   ├─ queriesHash == expectedQueriesHash              ← owner-updatable check
    │   ├─ URL starts with expectedUrlPrefix               ← byte-by-byte check
    │   ├─ bytes(provenSystemPromptHash).length > 0        ← AI ruleset hash present
    │   └─ bytes(provenTranscriptHash).length > 0          ← Conversation hash present
    │
    ├─ Step C: Decision–Journal Binding (V3, direct string comparison)
    │   keccak256(decision) == keccak256(provenDecision)   ← decision integrity
    │   keccak256(reason) == keccak256(provenReason)        ← reason integrity
    │   (Why: decision/reason are stored as typed fields for queryability,
    │    but submitted separately from the journal. This binding prevents
    │    a submitter from passing a valid proof with mismatched arguments.)
    │
    ├─ Step D: Immutable Record Storage
    │   records[callId] = CallRecord{ ..., sourceUrl: url (from journal), verified: true }
    │   └─ journalHash = keccak256(journalDataAbi) stored as commitment
    │
    └─ Step E: Event Emission
        └─ emit CallDecisionRecorded(callId, decision, timestamp, submitter)
```

**Key design**: The `verifier` is injected via constructor (`IRiscZeroVerifier` interface), enabling a seamless upgrade path from MockVerifier (development) to RiscZeroVerifierRouter (production Groth16) without changing contract code.

**Reading proven data**: Anyone can call `getProvenData(callId)` to retrieve all 9 decoded journal fields (notary key fingerprint, HTTP method, URL, timestamp, queriesHash, provenDecision, provenReason, provenSystemPromptHash, provenTranscriptHash) directly from the contract.

### What Gets Proven

| Element | How It's Verified |
|---------|-------------------|
| **The AI ruleset** | `provenSystemPromptHash` — SHA-256 of the SYSTEM_PROMPT, extracted via JMESPath and proven in the ZK journal. Anyone can hash the published rules and compare. |
| **The input** | `provenTranscriptHash` — SHA-256 of the conversation transcript, extracted via JMESPath and proven in the ZK journal. Proves which conversation the AI actually evaluated. |
| **The decision is authentic** | Web Proof via TLSNotary — cryptographic proof that VeriCall's Decision API genuinely returned this decision and reason |
| **The output wasn't tampered** | ZK Proof + Decision–Journal binding — on-chain keccak256 comparison ensures submitted decision/reason match `provenDecision`/`provenReason` from the journal |
| **When it happened** | `tlsTimestamp` from the TLS session itself (not self-reported by the company) |
| **Privacy-conscious** | Phone numbers never go on-chain. Conversation content is hashed (`transcriptHash`), not stored in plaintext. Note: the AI's reasoning (`provenReason`) is stored in plaintext — this is intentional, as accountability requires the reasoning to be publicly auditable. |

### Verification Flow (for a caller or auditor)

```
1. Caller receives a callId reference after the call
2. Look up: VeriCallRegistryV3.getRecord(callId) on Base Sepolia
3. Check: record.verified == true (ZK proof was validated on-chain)
4. Read:  VeriCallRegistryV3.getProvenData(callId) → decoded journal fields
5. Check: Does the extractedData contain the expected decision and reason?
6. Check: Does the sourceUrl (from journal) point to the expected VeriCall Decision API?
7. Optionally: verifyJournal(callId, journalDataAbi) to confirm journal integrity
8. Result: Cryptographic proof that VeriCall's AI made this specific decision,
           as attested by TLSNotary and verified by ZK proof on-chain,
           with decision-journal binding preventing post-proof tampering
```

## Trust-Minimized Verification

> **You don't need to trust VeriCall.** Every on-chain record can be independently verified — from your browser or from the command line.

VeriCall provides two verification tools that perform **12–14 automated checks** per record, reading directly from the Base Sepolia blockchain via public RPC. No API keys, no VeriCall servers — just you and the chain.

### Web Verification (`/verify`)

Open **[https://vericall-kkz6k4jema-uc.a.run.app/verify](https://vericall-kkz6k4jema-uc.a.run.app/verify)** in any browser.

- **Phase 1 — Contract Checks (C1–C5)**: Verifies the contract exists, code is deployed, owner is set, verifier address points to MockVerifier, and imageId matches vlayer's guestId
- **Phase 2 — Per-Record Checks (V1–V7)**: For each on-chain record, verifies the ZK seal format, journal hash integrity (`keccak256`), journal ABI decode, extracted decision/reason match, source URL points to VeriCall's Decision API, and TLSNotary notary key is present

No wallet required. Runs entirely client-side using viem + Base Sepolia public RPC.

### CLI Verification (`scripts/verify.ts`)

```bash
# Verify all records (12+ checks)
npx tsx scripts/verify.ts

# Deep mode: re-fetch Decision API URLs to confirm they still return matching data
npx tsx scripts/verify.ts --deep

# Output Foundry cast commands for manual verification
npx tsx scripts/verify.ts --cast

# JSON output for programmatic consumption
npx tsx scripts/verify.ts --json

# Verify a specific record
npx tsx scripts/verify.ts --record 2
```

886 lines. 12 checks minimum (C1–C5 + V1–V7), up to 14 with `--deep` (V8–V9: URL re-fetch and content match). Every check shows the on-chain data, the expected value, and the result.

### Check Reference

| Phase | Check | What It Verifies |
|-------|-------|------------------|
| Contract | C1 | Contract has deployed bytecode |
| Contract | C2 | Owner address is set |
| Contract | C3 | Verifier address points to MockVerifier |
| Contract | C4 | MockVerifier has deployed bytecode |
| Contract | C5 | imageId matches vlayer guestId |
| Record | V1 | ZK seal starts with `0xFFFFFFFF` (RISC Zero Mock selector) |
| Record | V2 | `journalHash == keccak256(journalDataAbi)` |
| Record | V3 | Journal ABI decodes to 9 valid fields |
| Record | V4 | Extracted decision matches record's decision |
| Record | V5 | Extracted reason matches record's reason |
| Record | V6 | Source URL matches VeriCall Decision API pattern |
| Record | V7 | TLSNotary notary key fingerprint is non-zero |
| Deep | V8 | Decision API URL still responds with valid JSON |
| Deep | V9 | Fetched decision/reason match on-chain values |

## Live Demo

Watch the entire pipeline in real-time — from phone call to on-chain record.

### Web Demo (`/demo`)

Open **[https://vericall-kkz6k4jema-uc.a.run.app/demo](https://vericall-kkz6k4jema-uc.a.run.app/demo)** in any browser.

Shows the full pipeline in real-time with a visual step indicator:
📞 Call → 🤖 AI Screen → ⚖️ Decision → 🔐 WebProof → 🧮 ZK → ⛓️ On-Chain

After completion, links directly to the **Verification page** to independently verify the record.

### CLI Demo (`scripts/demo.ts`)

```bash
# Connect to production (Cloud Run SSE stream)
npx tsx scripts/demo.ts

# Connect to local dev server
npx tsx scripts/demo.ts --local
```

When a phone call comes in, you see:
1. 📞 **Call started** — spinner animation while waiting
2. 🗣️ **Conversation log** — real-time STT transcripts and AI responses
3. 🤖 **AI Decision** — BLOCK/RECORD with reasoning
4. 📧 **Email sent** — notification dispatched
5. 🔐 **Web Proof** → **ZK Proof** → **On-Chain TX** — full witness pipeline
6. 🔍 **Auto-Verification** — immediately reads the record back from chain and runs 12 checks (C1–C5 + V1–V7)

The CLI auto-reconnects on disconnect. Bearer auth (`VERICALL_DEMO_TOKEN`) required for CLI.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/phone/incoming` | Twilio incoming call webhook |
| POST | `/phone/status` | Call status callback |
| GET | `/phone/logs` | Call log history |
| GET | `/api/witness/decision/{callSid}` | Decision API (target of vlayer Web Proof) |
| GET | `/api/explorer` | On-chain records as JSON |
| GET | `/api/demo/stream` | SSE stream for live demo (Bearer auth) |
| GET | `/api/health` | Health check |
| WS | `/stream` | Twilio Media Stream (real-time audio) |
| — | `/demo` | Live demo page (SSE real-time pipeline viewer) |
| — | `/verify` | Trust-minimized verification page (client-side) |

## Getting Started

### Prerequisites

- Node.js ≥ 18.17
- pnpm
- GCP project with Speech-to-Text, Text-to-Speech, and Vertex AI enabled
- Twilio account with a phone number
- SendGrid API key
- vlayer API credentials (see [vlayer docs](https://docs.vlayer.xyz))

### Setup

```bash
# Install dependencies
pnpm install

# Configure environment
cp .env.example .env.local
# Edit .env.local with your credentials

# Development (custom server with WebSocket)
pnpm dev

# Build
pnpm build

# Production
pnpm start
```

### Environment Variables

```bash
# Twilio
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=+1XXXXXXXXXX

# Google Cloud (uses Application Default Credentials)
GCP_PROJECT_ID=your-project-id
GCP_REGION=us-central1

# Email (SendGrid)
SENDGRID_API_KEY=
NOTIFICATION_EMAIL=you@example.com
FROM_EMAIL=noreply@vericall.app

# vlayer
VLAYER_API_KEY=
VLAYER_WEB_PROVER_URL=https://web-prover.vlayer.xyz
VLAYER_ZK_PROVER_URL=https://zk-prover.vlayer.xyz

# Blockchain (Base Sepolia)
ETHEREUM_RPC_URL=https://sepolia.base.org
CHAIN_ID=84532

# Server
NEXT_PUBLIC_BASE_URL=https://your-cloud-run-url.run.app
```

### Deploy to Cloud Run

```bash
gcloud builds submit --tag gcr.io/PROJECT/vericall
gcloud run deploy vericall \
  --image gcr.io/PROJECT/vericall \
  --region us-central1 \
  --allow-unauthenticated
```

## Status & Roadmap

### Implemented

| Feature | Status |
|---------|--------|
| Real-time AI call screening | ✅ Production |
| Intent-based BLOCK/RECORD decisions | ✅ Production |
| Email notifications (OK/SCAM templates) | ✅ Production |
| AI-powered call summaries (Gemini) | ✅ Production |
| Utterance buffering for speech quality | ✅ Production |
| vlayer Web Proof generation | ✅ [REST API](DESIGN.md#38-why-rest-api-not-solidity-proververifier) |
| vlayer ZK Proof compression | ✅ [REST API](DESIGN.md#38-why-rest-api-not-solidity-proververifier) |
| On-chain proof submission (Base Sepolia) | ✅ Implemented |
| On-chain ZK verification (VeriCallRegistryV3) | ✅ [Journal-bound integrity, 9-field decode](DESIGN.md#39-verifier-honesty-mockverifier-vs-production) |
| systemPromptHash / transcriptHash in journal | ✅ Proven via JMESPath extraction |
| Trust-minimized verification page (`/verify`) | ✅ 12 checks, client-side |
| Trust-minimized verification CLI (`scripts/verify.ts`) | ✅ 14 checks, `--deep` mode |
| Live demo — web (`/demo`) + CLI (`scripts/demo.ts`) | ✅ SSE real-time pipeline viewer |
| Explorer API (`/api/explorer`) | ✅ On-chain records as JSON |
| CLI registry inspector (V1/V3) | ✅ Implemented |
| Single Source of Truth (`deployment.json`) | ✅ Implemented |
| Cloud SQL decision persistence | ✅ Implemented |

### Next: Upgrade Path

These improvements are ready on VeriCall's side — activation depends on upstream milestones.

| Improvement | Condition | VeriCall Change Required |
|-------------|-----------|--------------------------|
| **Production Groth16 verification** | vlayer ZK Prover transitions from dev mode (`0xFFFFFFFF` seals) to production Groth16 | Deploy new V3 instance with `RiscZeroVerifierRouter` in constructor. No code changes — [all existing verification unchanged](DESIGN.md#39-verifier-honesty-mockverifier-vs-production). |
| **Solidity Prover/Verifier SDK** | vlayer SDK adds custom journal validation hooks in generated Verifier | Migrate from REST API to SDK. Proof data is identical — [only the integration layer changes](DESIGN.md#38-why-rest-api-not-solidity-proververifier). |

### Future

| Feature | Description |
|---------|-------------|
| Cross-chain verification | Verify VeriCall proofs on Sui or other chains |
| Caller-initiated verification | Let callers trigger proof generation for their own calls |
| Multi-tenant | Support multiple companies with independent rulesets and contracts |

### Architecture Decisions

**Why REST API?** Web Proofs are HTTP attestations — vlayer's REST API (`/api/v1/prove`) is the native interface for this. Using it directly lets VeriCall write a custom verifier contract with journal-bound decision integrity, notary fingerprint validation, URL prefix binding, and other checks that vlayer's auto-generated Verifier does not support. → [Full rationale](DESIGN.md#38-why-rest-api-not-solidity-proververifier)

**On-chain verification depth** Every `registerCallDecision()` performs journal ABI decode (9 fields), notary fingerprint check, HTTP method validation, URL prefix binding, queriesHash validation, systemPromptHash/transcriptHash presence checks, and decision–journal keccak256 binding — all fully real and running on-chain today. The contract is production-ready by design: the `verifier` is an `IRiscZeroVerifier` interface injected via constructor. The only component awaiting upstream activation is Groth16 seal verification, which follows [RISC Zero's standard development pattern](https://github.com/risc0/risc0-foundry-template). → [Full breakdown](DESIGN.md#39-verifier-honesty-mockverifier-vs-production)

## License

MIT


