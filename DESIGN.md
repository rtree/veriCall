# VeriCall — System Design Document

> Anchoring AI call-screening decisions on-chain with ZK proofs

---

## 1. Overview

### 1.1 What Is VeriCall?

VeriCall is a system that combines **AI phone screening** with **blockchain-backed proofs**.

1. When a phone call arrives, an AI converses with the caller and screens the call
2. The AI decides whether the call is "spam/sales (BLOCK)" or "legitimate (RECORD)"
3. That **decision is made tamper-proof via vlayer TLSNotary + ZK proofs**
4. The proof-backed decision is recorded on **Base Sepolia (EVM chain)**

This allows anyone to verify that "the AI truly made this decision."

### 1.2 End-to-End Flow

```
┌──────────┐    ┌──────────┐    ┌──────────────────────────────────────┐
│  Caller  │───→│  Twilio  │───→│  VeriCall (Cloud Run)                │
│ (Phone)  │    │  (PSTN)  │    │                                      │
└──────────┘    └──────────┘    │  ┌──────────┐    ┌──────────────┐   │
                                │  │ Incoming  │───→│ AI Screening  │   │
                                │  │ Webhook   │    │ (Gemini+STT   │   │
                                │  └──────────┘    │  +TTS+WS)     │   │
                                │                   └──────┬───────┘   │
                                │                          │           │
                                │                   ┌──────▼───────┐   │
                                │                   │  Decision     │   │
                                │                   │  (BLOCK or    │   │
                                │                   │   RECORD)     │   │
                                │                   └──────┬───────┘   │
                                │                          │           │
                                │          ┌───────────────┼──────┐    │
                                │          │               │      │    │
                                │          ▼               ▼      ▼    │
                                │  ┌──────────┐  ┌──────┐  ┌──────┐   │
                                │  │ Email    │  │Cloud │  │Witness│   │
                                │  │ Notify   │  │ SQL  │  │Pipeln│   │
                                │  └──────────┘  └──┬───┘  └──┬───┘   │
                                │                   │         │        │
                                └───────────────────┼─────────┼────────┘
                                                    │         │
                                    ┌───────────────▼─┐  ┌────▼──────────┐
                                    │ Decision API    │  │ vlayer        │
                                    │ /api/witness/   │  │ Web Prover    │
                                    │ decision/[sid]  │  │ (TLSNotary)   │
                                    └────────┬────────┘  └────┬──────────┘
                                             │                │
                                             │    ┌───────────▼──────────┐
                                             │    │ vlayer ZK Prover     │
                                             │    │ (RISC Zero→Groth16) │
                                             │    └───────────┬──────────┘
                                             │                │
                                             │    ┌───────────▼──────────┐
                                             └───→│ Base Sepolia         │
                                                  │ VeriCallRegistry     │
                                                  │ (on-chain record)    │
                                                  └──────────────────────┘
```

### 1.3 Why This Architecture?

| Question | Answer |
|----------|--------|
| Why AI phone screening? | To automatically block spam/sales calls and only forward or record legitimate ones |
| Why ZK proofs? | So a third party can verify that the AI's decision has not been tampered with after the fact |
| Why TLSNotary? | To cryptographically prove "this server really returned this JSON" for the VeriCall Decision API response |
| Why on-chain? | To store proof data in a permanent, tamper-proof location that anyone can view and verify |

---

## 2. Component Details

### 2.1 Incoming Call → AI Screening

#### Call Routing

```
Twilio (PSTN) ──POST──→ /phone/incoming (Webhook)
                              │
                              ├─ Whitelisted number → Forward immediately (TwiML <Dial>)
                              │
                              └─ Unknown number → AI screening
                                   │
                                   └─ TwiML <Connect><Stream> to open WebSocket
```

**File**: [app/phone/incoming/route.ts](app/phone/incoming/route.ts)
- Webhook endpoint that Twilio POSTs to on incoming calls
- `router.ts` decides: whitelist → forward / otherwise → AI

**File**: [app/phone/_lib/twiml-builder.ts](app/phone/_lib/twiml-builder.ts)
- For AI screening, returns `<Connect><Stream>` TwiML
- Twilio opens a WebSocket connection to `wss://{host}/stream`

#### WebSocket Streaming

```
Twilio Media Stream ──WS──→ server.ts (/stream)
                                  │
                                  └─ Create VoiceAISession
                                       │
                                       ├─ μ-law audio → Linear16 conversion
                                       ├─ Google STT (real-time speech recognition)
                                       ├─ Gemini AI (conversation + decision)
                                       ├─ Google TTS (speech synthesis)
                                       └─ μ-law audio → send to Twilio
```

**File**: [server.ts](server.ts)
- Custom server: Next.js + WebSocket
- Handles `ws.upgrade` on the `/stream` path
- Creates and manages `VoiceAISession` per callSid

**File**: [lib/voice-ai/session.ts](lib/voice-ai/session.ts) — **Core file**
- 1 call = 1 session. Manages:
  - **STT**: Google Cloud Speech-to-Text (real-time streaming)
  - **Gemini**: `@google/genai` SDK for conversation + decision
  - **TTS**: Google Cloud Text-to-Speech → μ-law 8kHz
  - **Barge-in**: Interruption handling when the caller talks over the AI
  - **Utterance buffering**: Merges short utterances with a 1.5s buffer

#### AI Decision Logic (Gemini)

**File**: [lib/voice-ai/gemini.ts](lib/voice-ai/gemini.ts)

Intent-based classification via System Prompt:

| Decision | Meaning | Example Signals |
|----------|---------|-----------------|
| `BLOCK` | Spam / sales | "I have a proposal", "Cut your costs", "Found you on a list" |
| `RECORD` | Legitimate business | "Returning a call", "Is Mr. X available?", "Sent a quote" |

- After 3+ turns of conversation, decides when confidence is high
- Returns JSON: `{ decision: "BLOCK" | "RECORD", response: "..." }`
- After deciding, finishes the last response before ending the call

### 2.2 Post-Decision Processing (3 Parallel Tasks)

When the AI decides `BLOCK` or `RECORD`, `handleDecision()` kicks off 3 tasks:

```
handleDecision()
    │
    ├─ 1. Email Notification (SendGrid)
    │     └─ Send decision + summary + conversation history via email
    │
    ├─ 2. Cloud SQL Persistence (storeDecisionForProof)
    │     └─ Persist data for vlayer Web Proof generation
    │
    └─ 3. Witness Pipeline (createWitness) ← fire-and-forget
          └─ Web Proof → ZK Proof → On-chain (details in 2.3)
```

### 2.3 Witness Pipeline (Proof Generation and On-Chain Recording)

This is the heart of VeriCall — generating **cryptographic proof that "the AI made this decision."**

#### Step 1: Store Decision in Cloud SQL

```
session.ts handleDecision()
    │
    └─ storeDecisionForProof()
         └─ INSERT INTO decision_records (call_sid, decision, reason, transcript, ...)
```

**File**: [lib/witness/decision-store.ts](lib/witness/decision-store.ts)
- UPSERT into the `decision_records` table
- 1-hour TTL (`expires_at`) — retained only long enough for proof generation
- `systemPromptHash`: Also stores the SHA-256 hash of the Gemini System Prompt

> **What this proves**: Nothing yet — this step simply persists the raw decision data so that a publicly accessible API can serve it to the vlayer prover in the next step.

#### Step 2: Decision API Serves the Data

```
vlayer Web Prover ──GET──→ /api/witness/decision/{callSid}
                                  │
                                  └─ Read from Cloud SQL → return JSON
```

**File**: [app/api/witness/decision/[callSid]/route.ts](app/api/witness/decision/%5BcallSid%5D/route.ts)

Response JSON:
```json
{
  "service": "VeriCall",
  "version": "1.0",
  "callSid": "CA...",
  "decision": "BLOCK",
  "reason": "Caller was selling SEO services...",
  "transcript": "AI: Hello... Caller: Hi, I have a proposal...",
  "systemPromptHash": "a3f2...",
  "callerHashShort": "8b2c...",
  "timestamp": "2026-02-07T...",
  "conversationTurns": 4
}
```

**Why Cloud SQL is needed**: The vlayer Web Prover accesses this URL via an external HTTP GET.
Cloud Run instance memory is not persistent, so decision data must be stored in a database.

> **What this proves**: Nothing yet — this is the data source that the vlayer Web Prover will fetch and cryptographically attest to. The key point is that this URL is served via HTTPS (TLS), making it eligible for TLSNotary attestation.

#### Step 3: vlayer Web Proof (TLSNotary)

```
pipeline.ts
    │
    └─ vlayerWebProof(proofUrl)
         │
         └─ POST https://web-prover.vlayer.xyz/api/v1/prove
              body: { url: "https://vericall-.../api/witness/decision/{sid}" }
              │
              └─ vlayer performs TLSNotary MPC protocol:
                   1. Establishes TLS connection to VeriCall server
                   2. Co-executes TLS session via MPC
                   3. Proves "this server returned this JSON"
                   4. Returns a WebProof object
```

**File**: [lib/witness/vlayer-api.ts](lib/witness/vlayer-api.ts)
- `generateWebProof()`: Calls the vlayer Web Prover REST API
- Authentication: `x-client-id` + `Authorization: Bearer {apiKey}`

**What is TLSNotary?**: A protocol that splits TLS execution via MPC (Multi-Party Computation),
enabling third-party verification of server responses.
vlayer offers this as a SaaS.

> **What this proves**: That the VeriCall Decision API server genuinely returned a specific JSON response containing a specific `decision` and `reason` for a specific `callSid`. The Notary cryptographically co-signs the TLS session without ever seeing the plaintext — it only holds half the encryption key. This guarantees the data was not fabricated or tampered with after the fact.

#### Step 4: vlayer ZK Proof (RISC Zero → Groth16)

```
pipeline.ts
    │
    └─ vlayerZKProof(webProof, ["decision", "reason"])
         │
         └─ POST https://zk-prover.vlayer.xyz/api/v0/compress-web-proof
              body: {
                presentation: webProof,
                extraction: { "response.body": { jmespath: ["decision", "reason"] } }
              }
              │
              └─ vlayer performs:
                   1. Feeds WebProof into RISC Zero zkVM guest program
                   2. Validates the TLSNotary proof inside the zkVM
                   3. Extracts specified fields (decision, reason) via JMESPath
                   4. Outputs { zkProof (seal), journalDataAbi }
```

**What each sub-step proves**:

| Sub-step | Operation | What It Proves |
|----------|-----------|----------------|
| **4-1. zkVM ingestion** | Load WebProof into RISC Zero guest program | The proof is processed inside a deterministic execution environment — the same input always produces the same output |
| **4-2. TLSNotary verification inside zkVM** | Verify the Notary's cryptographic signature over the TLS transcript | The WebProof from Step 3 is authentic — the Notary genuinely attested to this TLS session and the server response has not been altered |
| **4-3. JMESPath field extraction** | Extract `["decision", "reason"]` from the proven HTTP response body | The specific values (`BLOCK`, `Caller was selling SEO services...`) were genuinely present in the server's response — not injected or modified after the TLS session |
| **4-4. Seal + Journal output** | Generate the RISC Zero seal (proof) and ABI-encoded journal (public outputs) | All of the above verifications passed, and the results are bundled into a single cryptographic artifact (seal) with public outputs (journal) that can be verified on-chain by any smart contract |

**JMESPath `["decision", "reason"]`**: Specifies which fields to extract from the JSON response.
These values are encoded into the ZK Proof's public output (journal).

> **What this proves (combined)**: The entire chain from "this HTTPS server returned this JSON" to "these specific fields were extracted from that response" is verified inside a zkVM. The resulting seal and journal constitute a succinct, on-chain-verifiable cryptographic proof of the data's authenticity and integrity.

#### Step 5: On-Chain Recording on Base Sepolia

```
pipeline.ts
    │
    └─ submitDecisionOnChain({
         callSid, callerPhone, decision, reason,
         zkProofSeal, journalDataAbi, sourceUrl
       })
         │
         └─ VeriCallRegistryV2.registerCallDecision(
              callId,        // keccak256(callSid + timestamp)
              callerHash,    // keccak256(phoneNumber) — privacy-preserving
              decision,      // 1=ACCEPT, 2=BLOCK, 3=RECORD
              reason,        // AI's decision reason (≤200 chars)
              zkProofSeal,   // RISC Zero seal
              journalDataAbi,// ABI-encoded public outputs
              sourceUrl      // The URL that was proven
            )
```

**File**: [lib/witness/on-chain.ts](lib/witness/on-chain.ts)
- Sends TX to Base Sepolia via `viem`
- Wallet: Derived from `DEPLOYER_MNEMONIC`

**File**: [contracts/VeriCallRegistryV2.sol](contracts/VeriCallRegistryV2.sol)
- `registerCallDecision()`: Registers record + verifies ZK proof on-chain
- `verifyJournal()`: Checks `keccak256(journalDataAbi) == journalHash`
- `getRecord()` / `getProvenData()` / `getStats()` / `callIds[]`: Read functions

> **What this proves**: The smart contract calls `verifier.verify(seal, imageId, sha256(journalDataAbi))`, which verifies the ZK proof on-chain. If verification fails, the transaction reverts and no record is stored. A `verified: true` record on-chain means the ZK proof was cryptographically validated by the blockchain itself — creating an immutable, tamper-proof audit trail that anyone can independently verify.

### 2.4 Proof Verification Methods

The proofs recorded on-chain can be verified through the following means:

#### CLI Inspector

```bash
npx tsx scripts/check-registry.ts        # Human-readable output
npx tsx scripts/check-registry.ts --json  # JSON output
```

**File**: [scripts/check-registry.ts](scripts/check-registry.ts)
- Reads all on-chain records and decodes them
- Decodes ZK Journal binary data to extract method, URL, and extracted values
- Verifies journal hash integrity via `verifyJournal()`

Output example:
```
━━━ Record #2 ━━━━━━━━━━━━━━━━━━━━
  Call ID:     0x8a3f2b...
  Decision:    🚫 BLOCK
  Reason:      Caller was selling SEO services...
  Time:        2026-02-07T10:30:00Z

  📡 Proven Data (from ZK Journal):
  Source:      https://vericall-.../api/witness/decision/CA...
  Method:      GET
  Values:
    📄 BLOCK
    📄 Caller was selling SEO services...

  🔐 ZK Proof:
  Seal:        0x1a2b3c4d5e6f...
  Integrity:   ✅ Journal hash matches on-chain commitment
```

#### Explorer API

```
GET /api/explorer
```

**File**: [app/api/explorer/route.ts](app/api/explorer/route.ts)
- Browse on-chain data as JSON from a browser
- API for the future web dashboard

#### BaseScan

```
https://sepolia.basescan.org/address/{contract}
```

Call `getRecord()`, `getStats()`, `getProvenData()` directly from Read Contract on BaseScan.

---

## 3. Infrastructure, Authentication, and Component Layout

### 3.1 Application Components

```
veriCall/
├── server.ts                           # Custom server (Next.js + WebSocket)
├── app/
│   ├── phone/
│   │   ├── incoming/route.ts           # Twilio Webhook (incoming call)
│   │   ├── status/route.ts             # Twilio Status Callback
│   │   ├── logs/route.ts               # Call log API
│   │   └── _lib/
│   │       ├── router.ts               # Routing logic (whitelist/AI)
│   │       ├── twiml-builder.ts        # TwiML XML generation
│   │       ├── twilio.ts               # Twilio SDK wrapper
│   │       └── email.ts                # Email notification
│   ├── api/
│   │   ├── health/route.ts             # Health check
│   │   ├── explorer/route.ts           # On-chain data Explorer API
│   │   └── witness/
│   │       └── decision/[callSid]/     # Decision API (target of vlayer Web Proof)
│   │           └── route.ts
│   └── witness/                        # Witness-related pages (future)
│       ├── list/
│       └── verify/
├── lib/
│   ├── config.ts                       # Shared configuration
│   ├── db.ts                           # Cloud SQL client (IAM auth)
│   ├── voice-ai/
│   │   ├── session.ts                  # Call session management (★ core)
│   │   ├── gemini.ts                   # Gemini AI (screening decisions)
│   │   ├── speech-to-text.ts           # Google Cloud STT
│   │   ├── text-to-speech.ts           # Google Cloud TTS
│   │   ├── audio-utils.ts             # μ-law ↔ Linear16 conversion
│   │   └── email-notify.ts            # SendGrid email notification
│   └── witness/
│       ├── pipeline.ts                 # Witness pipeline (★ proof generation)
│       ├── vlayer-api.ts               # vlayer REST API client
│       ├── on-chain.ts                 # Base Sepolia TX submission
│       ├── decision-store.ts           # Cloud SQL decision data store
│       └── abi.ts                      # VeriCallRegistryV2 ABI
├── contracts/
│   ├── VeriCallRegistry.sol            # V1 Solidity contract
│   ├── VeriCallRegistryV2.sol          # V2 Solidity contract (with ZK verification)
│   ├── RiscZeroMockVerifier.sol        # Mock Verifier for development
│   ├── interfaces/
│   │   └── IRiscZeroVerifier.sol       # RISC Zero standard interface
│   └── deployment.json                 # Deployment info (Single Source of Truth)
├── scripts/
│   ├── check-registry.ts              # CLI registry inspector (V1/V2)
│   └── deploy-v2.ts                   # V2 deployment script (with auto-sync)
└── .github/workflows/
    └── deploy.yml                      # GitHub Actions CI/CD
```

### 3.2 Infrastructure Layout

```
┌─────────────────────────────────────────────────────────┐
│  Google Cloud Platform (ethglobal-479011)                │
│  Region: us-central1                                    │
│                                                          │
│  ┌──────────────────────┐   ┌─────────────────────────┐ │
│  │  Cloud Run            │   │  Cloud SQL               │ │
│  │  (vericall)           │──→│  (vericall-db)           │ │
│  │                       │   │                           │ │
│  │  - Next.js + WS       │   │  - PostgreSQL 15          │ │
│  │  - 512Mi / 1 CPU      │   │  - db-f1-micro           │ │
│  │  - min=1, max=10      │   │  - IAM auth              │ │
│  │  - session-affinity   │   │  - SSL required           │ │
│  │  - timeout=600s       │   │  - Public IP + Connector │ │
│  └──────────┬───────────┘   └─────────────────────────┘ │
│             │                                            │
│  ┌──────────▼───────────┐   ┌─────────────────────────┐ │
│  │  Secret Manager       │   │  Artifact Registry      │ │
│  │  (15+ secrets)        │   │  (Docker images)        │ │
│  └──────────────────────┘   └─────────────────────────┘ │
└─────────────────────────────────────────────────────────┘

┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐
│  Twilio           │  │  vlayer          │  │  Base Sepolia │
│  (PSTN Gateway)   │  │  (ZK SaaS)      │  │  (L2 Chain)   │
│                    │  │                  │  │               │
│  - Phone number   │  │  - Web Prover   │  │  - V2 Contract│
│  - Media Stream   │  │  - ZK Prover    │  │  - MockVerifier│
│  - WebSocket      │  │  - TLSNotary    │  │               │
└──────────────────┘  └──────────────────┘  └──────────────┘
```

### 3.3 Authentication & Security

#### Service Account

```
vericall-deploy@ethglobal-479011.iam.gserviceaccount.com
  │
  ├─ roles/editor                     # GCP general
  ├─ roles/cloudsql.client            # Cloud SQL connection
  ├─ roles/cloudsql.instanceUser      # IAM DB auth
  ├─ roles/secretmanager.admin        # Secret Manager management
  ├─ roles/secretmanager.secretAccessor # Secret read access
  ├─ roles/artifactregistry.writer    # Docker push
  ├─ roles/run.admin                  # Cloud Run deployment
  └─ roles/iam.serviceAccountUser     # SA impersonation
```

#### Authentication Flows

| Connection | Auth Method | Details |
|------------|-------------|---------|
| GitHub Actions → GCP | Workload Identity Federation | OIDC token exchange, passwordless |
| Cloud Run → Cloud SQL | IAM DB auth | `@google-cloud/cloud-sql-connector` + ADC |
| Cloud Run → Secret Manager | IAM (automatic) | `secretAccessor` role on SA |
| Cloud Run → Gemini/STT/TTS | ADC (automatic) | SA's GCP credentials |
| Pipeline → vlayer | API Key + Client ID | `VLAYER_API_KEY`, `VLAYER_CLIENT_ID` |
| Pipeline → Base Sepolia | Mnemonic → private key | Derived from `DEPLOYER_MNEMONIC` |
| Twilio → VeriCall | URL-based | Twilio Webhook URL |

#### Cloud SQL Security

```
Cloud SQL (vericall-db)
  │
  ├─ IAM auth ON (cloudsql.iam_authentication=on)
  │   └─ IAM DB user: vericall-deploy@ethglobal-479011.iam
  │       └─ No password — authenticates via ADC token
  │
  ├─ SSL required (--require-ssl)
  │   └─ All non-SSL connections rejected
  │
  └─ postgres admin password
      └─ Random value, stored in Secret Manager (CLOUDSQL_POSTGRES_ADMIN_PASSWORD)
```

### 3.4 CI/CD Pipeline

```
git push origin master
    │
    └─ GitHub Actions (.github/workflows/deploy.yml)
         │
         ├─ 1. Checkout
         ├─ 2. GCP Auth (Workload Identity Federation)
         ├─ 3. Sync Contract Address from deployment.json
         ├─ 4. Docker Build (Buildx, layer cache)
         ├─ 5. Push to Artifact Registry
         └─ 6. gcloud run deploy
              │
              ├─ --service-account vericall-deploy@...
              ├─ --add-cloudsql-instances ethglobal-479011:us-central1:vericall-db
              ├─ --set-env-vars NODE_ENV, DB config, BASE_URL
              └─ --set-secrets 15 secrets
```

### 3.5 Overall Data Flow

```
            ①                ②               ③              ④
  Phone Call ───→ AI Screening ───→ Decision ───→ Cloud SQL ───→ Decision API
                  (Gemini)         (BLOCK/       (PostgreSQL)    /api/witness/
                                    RECORD)                     decision/{sid}
                                                                     │
            ⑧                ⑦               ⑥              ⑤     │
  On-chain  ←─── TX Submit  ←─── ZK Proof  ←─── Web Proof ←────────┘
  Record          (viem)         (Groth16)       (TLSNotary)
  (Base Sepolia)                 (vlayer)        (vlayer)
                                                                     │
            ⑨                                                        │
  Verify    ←───────────────────────────────────────────────────────┘
  (CLI / Explorer / BaseScan)
```

| Step | Processing | Estimated Time |
|------|-----------|----------------|
| ① | Incoming call → WebSocket connection | ~1s |
| ② | AI screening conversation | 15–60s |
| ③ | Decision → Cloud SQL persistence | ~100ms |
| ④ | Decision API response | ~50ms |
| ⑤ | vlayer Web Proof (TLSNotary) | 10–30s |
| ⑥ | vlayer ZK Proof (RISC Zero → Groth16) | 30–120s |
| ⑦ | Base Sepolia TX submission + confirmation | 2–5s |
| ⑧ | On-chain recording complete | — |
| ⑨ | CLI / Explorer verification | ~2s |

**Total**: From call end to ⑧ completion, approximately 1–3 minutes (⑤–⑦ run in the background, not blocking the call).

### 3.6 External Service Dependencies

| Service | Purpose | Auth Method |
|---------|---------|-------------|
| Twilio | Phone PSTN gateway + Media Stream | Account SID + Auth Token |
| Google Gemini | AI conversation + screening decisions | ADC (Google Cloud) |
| Google Cloud STT | Real-time speech recognition | ADC |
| Google Cloud TTS | Speech synthesis (μ-law 8kHz) | ADC |
| vlayer Web Prover | TLSNotary-based Web Proof generation | API Key + Client ID |
| vlayer ZK Prover | RISC Zero → Groth16 BN254 compression | API Key + Client ID |
| SendGrid | Email notifications | API Key |
| Base Sepolia RPC | EVM transaction submission | Public RPC |

### 3.7 Contract Design

**VeriCallRegistryV2** (deployed on Base Sepolia)

```solidity
struct CallRecord {
    bytes32 callerHash;        // keccak256(phoneNumber) — privacy-preserving
    Decision decision;         // ACCEPT(1) / BLOCK(2) / RECORD(3)
    string reason;             // AI's decision reason (≤200 chars)
    bytes32 journalHash;       // keccak256(journalDataAbi) — commitment
    bytes zkProofSeal;         // RISC Zero seal (Mock: 36B / Prod: ~256B)
    bytes journalDataAbi;      // ABI-encoded public outputs (all 6 fields)
    string sourceUrl;          // URL that was proven
    uint256 timestamp;         // block.timestamp
    address submitter;         // TX sender
    bool verified;             // ZK verification passed flag
}
```

**Verifiability**:
- `verifier.verify(seal, imageId, sha256(journalDataAbi))` → on-chain ZK proof verification
- `journalHash == keccak256(journalDataAbi)` → journal integrity
- Decoding `journalDataAbi` yields `decision`, `reason` values
- `sourceUrl` indicates which API endpoint was proven
- `verified == true` means the ZK proof passed on-chain verification

**Phase Plan**:
- Phase 1 (complete): On-chain storage of proof data (Proof of Existence) — VeriCallRegistry V1
- **Phase 2 (current): MockVerifier + on-chain ZK verification** — VeriCallRegistryV2
- Phase 3 (future): vlayer production → switch to RiscZeroVerifierRouter
- Phase 4 (future): Cross-chain verification on Sui

---

## 4. ZK Proof Verification Architecture

> This chapter describes VeriCall's ZK verification architecture, designed through
> investigation of vlayer's ZK proof behavior and the MockVerifier pattern used by
> RISC Zero-based dApps in development mode.

### 4.1 vlayer ZK Proof Investigation Results

vlayer's ZK Prover API (`/api/v0/compress-web-proof`) currently operates in an **"Under Development"** status.
The actual proof data returned has the following structure:

```
┌──────────────────────────────────────────────────────────────┐
│  vlayer /compress-web-proof response                          │
│                                                               │
│  {                                                            │
│    "success": true,                                           │
│    "data": {                                                  │
│      "zkProof": "0xffffffff...",     ← seal (36 bytes)       │
│      "journalDataAbi": "0x00..."     ← ABI-encoded journal  │
│    }                                                          │
│  }                                                            │
└──────────────────────────────────────────────────────────────┘
```

#### zkProof (Seal) Structure: 36 bytes

```
Offset  Size    Field              Value
──────  ──────  ─────────────────  ──────────────────────────────
0x00    4 byte  selector           0xFFFFFFFF (RISC Zero SELECTOR_FAKE)
0x04    32 byte imageId            Variable (RISC Zero guest program ID)

Total: 36 bytes
```

**Key Findings**:
- `0xFFFFFFFF` is RISC Zero's `SELECTOR_FAKE` — a selector indicating **Mock Proof**
- Production Groth16 BN254 proofs should be ~256 bytes (currently only 36 bytes)
- The imageId within the seal varies per proof and does not match the guestId from vlayer's `/guest-id` API
- **Calling `verify()` on the RISC Zero RiscZeroVerifierRouter (`0x0b144e...`) on Base Sepolia REVERTS**

```
Experiment: Executed on Base Sepolia
  contract: RiscZeroVerifierRouter (0x0b144e07a0826182b6b59788c34b32bfa86fb711)
  call:     verify(seal, guestId, sha256(journal))
  result:   ❌ REVERTED (error signature: 0xe4ea6542)
```

#### The MockVerifier Pattern

The standard approach for RISC Zero-based dApps during development is to deploy a **RiscZeroMockVerifier** that accepts any seal prefixed with `0xFFFFFFFF`:

```
1. Deploy RiscZeroMockVerifier(0xFFFFFFFF)
   └─ If seal[0:4] == 0xFFFFFFFF → pass (accept Mock proofs)

2. Application contract calls verify()
   └─ verifier.verify(seal, IMAGE_ID, sha256(journalData))

3. Decode and validate journalData via abi.decode
   └─ notaryKeyFingerprint, method, url, timestamp, queriesHash, extractedData

4. Production migration path
   └─ Switch verifier address to the production RiscZeroVerifierRouter at deploy time
```

**Conclusion**: vlayer's Mock Proof is not a bug — it is the expected behavior in development mode.
VeriCall adopts the same MockVerifier pattern, with a clear upgrade path to production Groth16 verification.

### 4.2 Journal Data Format Specification (Byte-Level)

The `journalDataAbi` returned by vlayer's `/compress-web-proof` is the following Solidity ABI encoding:

```solidity
abi.encode(
    bytes32 notaryKeyFingerprint,  // Slot 0: TLSNotary public key fingerprint
    string  method,                // Slot 1+: HTTP method ("GET")
    string  url,                   // Slot N+: Proven URL (full URL)
    uint256 timestamp,             // Slot M:  Proof generation time (Unix epoch seconds)
    bytes32 queriesHash,           // Slot M+1: keccak256 of URL query parameters
    string  extractedData          // Slot P+: JMESPath extraction result (JSON string)
)
```

#### ABI Encoding Details (Byte Layout)

```
Offset  Description
──────  ─────────────────────────────────────────────────────
0x0000  bytes32 notaryKeyFingerprint (32 bytes, left-padded)
0x0020  uint256 offset_method        (→ start position of method string)
0x0040  uint256 offset_url           (→ start position of url string)
0x0060  uint256 timestamp            (32 bytes, right-padded)
0x0080  bytes32 queriesHash          (32 bytes, left-padded)
0x00A0  uint256 offset_extractedData (→ start position of extractedData string)
...
        [method string data: length + UTF-8 bytes + padding]
        [url string data: length + UTF-8 bytes + padding]
        [extractedData string data: length + UTF-8 bytes + padding]
```

#### VeriCall Concrete Example

```
notaryKeyFingerprint: 0xa1b2c3d4...              (SHA-256 of TLSNotary notary public key)
method:               "GET"                       (HTTP method for the Decision API)
url:                  "https://vericall-kkz6k4jema-uc.a.run.app/api/witness/decision/CA1234..."
timestamp:            1738900000                  (2025-02-07T...)
queriesHash:          0x0000...0000               (no query parameters = zero)
extractedData:        '["BLOCK","Caller was selling SEO services and cold-calling from a list"]'
```

**extractedData** is a JSON array of values extracted by JMESPath `["decision", "reason"]`.
The Solidity side stores this string as-is; off-chain consumers JSON-parse it.

#### Solidity Decoding

```solidity
(
    bytes32 notaryKeyFingerprint,
    string memory method,
    string memory url,
    uint256 proofTimestamp,
    bytes32 queriesHash,
    string memory extractedData
) = abi.decode(journalDataAbi, (bytes32, string, string, uint256, bytes32, string));
```

### 4.3 IRiscZeroVerifier Interface

The standard RISC Zero verification interface. All Verifiers (Mock / Groth16 / STARK) implement this.

```solidity
// SPDX-License-Identifier: Apache-2.0
interface IRiscZeroVerifier {
    /// @notice Verify a ZK proof. Reverts on failure.
    /// @param seal       Proof data (Mock: 36 bytes / Groth16: ~256 bytes)
    /// @param imageId    RISC Zero guest program ID (vlayer's guestId)
    /// @param journalDigest  sha256(journalDataAbi) — the journal digest
    function verify(
        bytes calldata seal,
        bytes32 imageId,
        bytes32 journalDigest
    ) external view;
}
```

**Important**: `journalDigest` uses `sha256`, not `keccak256`.
RISC Zero uses SHA-256 internally, so the Solidity side must also use `sha256()`.

### 4.4 Mock vs Production Verifier

```
┌─────────────────────────────────────────────────────────────────────┐
│                    IRiscZeroVerifier                                 │
│                    verify(seal, imageId, journalDigest)             │
│                                                                     │
│  ┌──────────────────────────┐    ┌──────────────────────────────┐  │
│  │  RiscZeroMockVerifier    │    │  RiscZeroVerifierRouter       │  │
│  │  (Development)           │    │  (Production)                 │  │
│  │                          │    │                               │  │
│  │  Verification logic:     │    │  Verification logic:          │  │
│  │  seal[0:4] == 0xFFFFFFFF │    │  Full Groth16 BN254 check    │  │
│  │  → true (always passes)  │    │  → Cryptographically secure   │  │
│  │                          │    │                               │  │
│  │  Deployment: Self-deploy │    │  Pre-deployed (RISC Zero):    │  │
│  │  Selector: 0xFFFFFFFF    │    │  0x0b144e07a0826182b6b59788  │  │
│  │                          │    │  c34b32bfa86fb711             │  │
│  └──────────────────────────┘    └──────────────────────────────┘  │
│                                                                     │
│  Injected via VeriCallRegistryV2 constructor:                       │
│  constructor(IRiscZeroVerifier _verifier, bytes32 _imageId)         │
│                                                                     │
│  Switching: Change verifier address at deploy time only             │
│             No contract code changes required                       │
└─────────────────────────────────────────────────────────────────────┘
```

| | RiscZeroMockVerifier | RiscZeroVerifierRouter |
|---|---|---|
| Base Sepolia Address | Self-deployed | `0x0b144e07a0826182b6b59788c34b32bfa86fb711` |
| Verification | `seal[0:4] == 0xFFFFFFFF` | Groth16 BN254 cryptographic verification |
| Security | Test-only (anyone can forge) | Cryptographically secure |
| vlayer Compatibility | Accepts current dev-mode seals | Will accept future production seals |
| Gas Cost | ~3,000 gas | ~300,000 gas (pairing operations) |
| Use Case | Development / hackathon | Production |

### 4.5 VeriCallRegistryV2 Architecture

Changes from V1:
1. **`IRiscZeroVerifier.verify()` call** — On-chain ZK proof verification
2. **`abi.decode(journalDataAbi)`** — Journal decoding in Solidity
3. **Field validation** — TLSNotary/HTTP metadata consistency checks
4. **`getProvenData()` view function** — Read decoded data
5. **`verified` flag** — Explicit proof-verified indicator

```
VeriCallRegistryV2
│
├── State (immutable)
│   ├── verifier: IRiscZeroVerifier     ← Injected via constructor
│   └── imageId: bytes32                ← vlayer guestId
│
├── State (mutable)
│   ├── owner: address
│   ├── records: mapping(bytes32 → CallRecord)
│   ├── callIds: bytes32[]
│   └── totalAccepted / totalBlocked / totalRecorded
│
├── registerCallDecision(callId, callerHash, decision, reason, seal, journal, url)
│   │
│   ├── Step 1: ZK Proof Verification
│   │   └── verifier.verify(seal, imageId, sha256(journalDataAbi))
│   │       └── Mock: seal[0:4] == 0xFFFFFFFF → pass
│   │       └── Prod: Groth16 BN254 pairing check → pass or revert
│   │
│   ├── Step 2: Journal Decode & Validation
│   │   └── abi.decode(journalDataAbi) → 6 fields:
│   │       ├── notaryKeyFingerprint ≠ bytes32(0)   ← TLSNotary key exists
│   │       ├── method == "GET"                      ← Valid HTTP method
│   │       ├── bytes(url).length > 0                ← URL exists
│   │       └── bytes(extractedData).length > 0      ← Extracted data exists
│   │
│   ├── Step 3: CallRecord Storage
│   │   └── journalHash = keccak256(journalDataAbi) stored as commitment
│   │
│   └── Step 4: Event Emission
│       ├── ProofVerified(callId, imageId, journalDigest)
│       └── CallDecisionRecorded(callId, callerHash, decision, timestamp, submitter)
│
├── getRecord(callId) → CallRecord
├── getProvenData(callId) → (notaryKeyFP, method, url, timestamp, queriesHash, extractedData)
├── verifyJournal(callId, journalData) → bool
├── getStats() → (total, accepted, blocked, recorded)
│
└── Admin
    ├── updateImageId(bytes32)     [onlyOwner]
    └── transferOwnership(address) [onlyOwner]
```

#### CallRecord Struct (V2)

```solidity
struct CallRecord {
    bytes32 callerHash;        // keccak256(phoneNumber) — privacy-preserving
    Decision decision;         // ACCEPT(1) / BLOCK(2) / RECORD(3)
    string reason;             // AI's decision reason (≤200 chars)
    bytes32 journalHash;       // keccak256(journalDataAbi) — commitment
    bytes zkProofSeal;         // RISC Zero seal (Mock: 36B / Prod: ~256B)
    bytes journalDataAbi;      // ABI-encoded public outputs (all 6 fields)
    string sourceUrl;          // URL that was proven
    uint256 timestamp;         // block.timestamp
    address submitter;         // TX sender
    bool verified;             // ZK verification passed flag (always true — unreachable if reverted)
}
```

### 4.6 End-to-End Processing Flow (Byte-Level Detail)

```
═══════════════════════════════════════════════════════════════════════
 Step 1: Incoming Call → AI Screening → Decision
═══════════════════════════════════════════════════════════════════════

  Caller ──PSTN──→ Twilio ──POST──→ /phone/incoming
                              │
                              └─ TwiML <Connect><Stream> ──WS──→ server.ts
                                                                     │
                                                              VoiceAISession
                                                              ├─ STT (Google)
                                                              ├─ Gemini AI
                                                              └─ TTS (Google)
                                                                     │
                                                              Decision: BLOCK
                                                              Reason: "Caller was selling..."

═══════════════════════════════════════════════════════════════════════
 Step 2: Decision Data Persistence (Cloud SQL)
═══════════════════════════════════════════════════════════════════════

  handleDecision()
    └─ storeDecisionForProof()
         └─ INSERT INTO decision_records
              call_sid:          'CA1234abcdef...'
              decision:          'BLOCK'
              reason:            'Caller was selling SEO services...'
              transcript:        'AI: Hello... Caller: Hi...'
              system_prompt_hash: 'a3f2b1...'
              expires_at:         NOW() + interval '1 hour'

═══════════════════════════════════════════════════════════════════════
 Step 3: vlayer Web Proof (TLSNotary MPC)
═══════════════════════════════════════════════════════════════════════

  pipeline.ts: generateWebProof(proofUrl)

  Request:
    POST https://web-prover.vlayer.xyz/api/v1/prove
    Headers:
      Content-Type: application/json
      x-client-id: 4f028e97-b7c7-4a81-ade2-6b1a2917380c
      Authorization: Bearer {VLAYER_API_KEY}
    Body:
      {
        "url": "https://vericall-kkz6k4jema-uc.a.run.app/api/witness/decision/CA1234...",
        "headers": []
      }

  vlayer internal processing:
    1. Establish TLS connection to VeriCall server
    2. Co-execute TLS session via TLSNotary MPC protocol
       ├─ Prover (vlayer) holds part of the TLS handshake
       └─ Notary (vlayer notary) holds the rest → jointly decrypt
    3. Cryptographically prove the HTTP response content
    4. Construct WebProof object
       ├─ data: TLSNotary presentation (base64)
       ├─ version: Protocol version
       └─ meta.notaryUrl: Notary server URL

  Response:
    {
      "data": "base64-encoded-tlsnotary-presentation...",
      "version": "...",
      "meta": { "notaryUrl": "https://..." }
    }

  Duration: 10–30 seconds

═══════════════════════════════════════════════════════════════════════
 Step 4: vlayer ZK Proof (RISC Zero zkVM → Mock Seal)
═══════════════════════════════════════════════════════════════════════

  pipeline.ts: compressToZKProof(webProof, ["decision", "reason"])

  Request:
    POST https://zk-prover.vlayer.xyz/api/v0/compress-web-proof
    Headers:
      Content-Type: application/json
      x-client-id: 4f028e97-b7c7-4a81-ade2-6b1a2917380c
      Authorization: Bearer {VLAYER_API_KEY}
    Body:
      {
        "presentation": { "data": "...", "version": "...", "meta": {...} },
        "extraction": {
          "response.body": {
            "jmespath": ["decision", "reason"]
          }
        }
      }

  vlayer internal processing:
    1. Feed WebProof into RISC Zero zkVM guest program
       → Proves: Execution happens in a deterministic, verifiable environment
    2. Validate TLSNotary proof inside zkVM
       → Proves: The WebProof is authentic — the Notary genuinely attested
    3. Extract values via JMESPath ["decision", "reason"] from the HTTP response body
       → Proves: These specific values were present in the authentic server response
    4. Construct Journal (public outputs):
       ├─ notaryKeyFingerprint: SHA-256 of TLSNotary public key
       ├─ method: "GET"
       ├─ url: "https://vericall-.../api/witness/decision/CA1234..."
       ├─ timestamp: 1738900000
       ├─ queriesHash: 0x00...00
       └─ extractedData: '["BLOCK","Caller was selling SEO services..."]'
    5. ABI-encode Journal → journalDataAbi
    6. Generate Seal (proof) → currently Mock: 0xFFFFFFFF + imageId (36 bytes)
       → Proves: All verifications above passed within the zkVM

  Response:
    {
      "success": true,
      "data": {
        "zkProof": "0xffffffff6e251f4d993427d02a4199e1201f3b54462365d7c672a51be57f776d509b47eb",
        "journalDataAbi": "0x000000...（ABI-encoded data）"
      }
    }

  Duration: 30–120 seconds

═══════════════════════════════════════════════════════════════════════
 Step 5: On-Chain Registration + ZK Verification (VeriCallRegistryV2)
═══════════════════════════════════════════════════════════════════════

  pipeline.ts: submitDecisionOnChain({...})

  TX construction (viem):
    to:       VeriCallRegistryV2 (0x...)
    function: registerCallDecision(
      callId:          keccak256("vericall_CA1234..._1738900000"),
      callerHash:      keccak256("+1234567890"),
      decision:        2 (BLOCK),
      reason:          "Caller was selling SEO services...",
      zkProofSeal:     0xffffffff6e251f4d...,
      journalDataAbi:  0x000000... (ABI-encoded),
      sourceUrl:       "https://vericall-.../api/witness/decision/CA1234..."
    )

  Contract internal processing:

    ┌─ Step 5a: ZK Proof Verification ─────────────────────────────┐
    │                                                              │
    │  bytes32 journalDigest = sha256(journalDataAbi);             │
    │  verifier.verify(zkProofSeal, imageId, journalDigest);       │
    │                                                              │
    │  MockVerifier:                                               │
    │    require(bytes4(seal[:4]) == 0xFFFFFFFF)  → ✅ PASS        │
    │                                                              │
    │  ProductionVerifier (future):                                │
    │    Groth16 BN254 pairing check  → ✅ PASS or ❌ REVERT      │
    │                                                              │
    │  emit ProofVerified(callId, imageId, journalDigest)          │
    │                                                              │
    │  → Proves: The ZK proof is valid (the seal matches the       │
    │    expected format and the journal digest is consistent)      │
    └──────────────────────────────────────────────────────────────┘

    ┌─ Step 5b: Journal Decode & Validation ───────────────────────┐
    │                                                              │
    │  (notaryKeyFP, method, url, ts, queriesHash, extractedData)  │
    │    = abi.decode(journalDataAbi,                              │
    │        (bytes32, string, string, uint256, bytes32, string))   │
    │                                                              │
    │  require(notaryKeyFP != bytes32(0))      → TLSNotary key OK │
    │  require(method == "GET")                → HTTP method valid  │
    │  require(bytes(url).length > 0)          → URL exists        │
    │  require(bytes(extractedData).length > 0) → Extracted data OK│
    │                                                              │
    │  → Proves: The journal contains well-formed, non-empty data  │
    │    that matches expected TLSNotary attestation patterns       │
    └──────────────────────────────────────────────────────────────┘

    ┌─ Step 5c: Record Storage ────────────────────────────────────┐
    │                                                              │
    │  records[callId] = CallRecord({                              │
    │    callerHash:     keccak256("+1234567890"),                  │
    │    decision:       BLOCK,                                    │
    │    reason:         "Caller was selling SEO services...",      │
    │    journalHash:    keccak256(journalDataAbi),                │
    │    zkProofSeal:    0xffffffff...,                             │
    │    journalDataAbi: 0x000000...,                              │
    │    sourceUrl:      "https://vericall-.../.../CA1234...",      │
    │    timestamp:      block.timestamp,                          │
    │    submitter:      0xBC5e73A464...,                          │
    │    verified:       true                                      │
    │  })                                                          │
    │                                                              │
    │  emit CallDecisionRecorded(callId, callerHash, BLOCK, ts, …) │
    │                                                              │
    │  → Proves: An immutable, timestamped record now exists       │
    │    on-chain that can never be altered or deleted              │
    └──────────────────────────────────────────────────────────────┘

  Result:
    txHash: 0xabcdef...
    blockNumber: 37329000
    gasUsed: ~150,000 (Mock) / ~450,000 (Production)

═══════════════════════════════════════════════════════════════════════
 Step 6: Verification (Anyone Can Perform)
═══════════════════════════════════════════════════════════════════════

  A) CLI Inspector (check-registry.ts):
     npx tsx scripts/check-registry.ts
     → getRecord(callId) to retrieve full data
     → verifyJournal(callId, journalDataAbi) to verify integrity
     → getProvenData(callId) to display decoded data

  B) Explorer API:
     GET /api/explorer
     → Returns all records as JSON

  C) BaseScan:
     https://sepolia.basescan.org/address/{contract}
     → Read Contract → getRecord / getProvenData / verifyJournal

  D) Independent Verification:
     1. getRecord(callId) to retrieve seal + journalDataAbi
     2. Verify sha256(journalDataAbi) == expected journalDigest
     3. Confirm verifier.verify(seal, imageId, journalDigest) does not revert
     4. abi.decode(journalDataAbi) to read extractedData
     5. JSON-parse extractedData to confirm decision/reason
```

### 4.7 Deployment Flow

```
scripts/deploy-v2.ts

  ┌─ Step 1: Deploy RiscZeroMockVerifier ───────────────────────┐
  │                                                              │
  │  bytecode: Read from contracts/out                           │
  │  constructor: (bytes4 selector = 0xFFFFFFFF)                 │
  │  → mockVerifierAddress                                       │
  └──────────────────────────────────────────────────────────────┘
          │
  ┌─ Step 2: Deploy VeriCallRegistryV2 ─────────────────────────┐
  │                                                              │
  │  bytecode: Read from contracts/out                           │
  │  constructor: (                                              │
  │    IRiscZeroVerifier _verifier = mockVerifierAddress,         │
  │    bytes32 _imageId = 0x6e251f4d993427d02a4199e1201f3b5446…  │
  │  )                                                           │
  │  → registryV2Address                                         │
  └──────────────────────────────────────────────────────────────┘
          │
  ┌─ Step 3: Verification (5 checks) ──────────────────────────┐
  │                                                              │
  │  1. getCode(mockVerifier) — bytecode exists                  │
  │  2. getCode(registry) — bytecode exists                      │
  │  3. registry.verifier() == mockVerifier address              │
  │  4. registry.imageId() == expected imageId                   │
  │  5. registry.owner() == deployer address                     │
  └──────────────────────────────────────────────────────────────┘
          │
  ┌─ Step 4: Auto-sync (Single Source of Truth) ────────────────┐
  │                                                              │
  │  4a. Update deployment.json                                  │
  │  {                                                           │
  │    "network": "base-sepolia",                                │
  │    "chainId": 84532,                                         │
  │    "contractAddress": registryV2Address,                     │
  │    "mockVerifierAddress": mockVerifierAddress,                │
  │    "guestId": "0x6e251f4d...",                               │
  │    "version": "v2",                                          │
  │    "v1Address": "0xe454ca755219310b2728d39db8039cbaa7abc3b8"  │
  │  }                                                           │
  │                                                              │
  │  4b. Update .env.local                                       │
  │  VERICALL_CONTRACT_ADDRESS=registryV2Address                 │
  │                                                              │
  │  4c. Update GCP Secret Manager                               │
  │  gcloud secrets versions add VERICALL_CONTRACT_ADDRESS ...   │
  └──────────────────────────────────────────────────────────────┘
```

#### Production Migration (Future)

When vlayer starts returning production Groth16 proofs:

```
1. Redeploy VeriCallRegistryV2
   constructor(
     IRiscZeroVerifier(0x0b144e07a0826182b6b59788c34b32bfa86fb711),  // RiscZeroVerifierRouter
     guestId
   )

2. Pipeline code requires no changes (only the seal format changes)

3. Past MockVerifier records and new Production records
   will be on different contracts (V2-Mock / V2-Prod)
```

### 4.8 File Structure (V2 Additions)

```
contracts/
├── VeriCallRegistry.sol              # V1 (Phase 1, existing, 0xe454ca...)
├── VeriCallRegistryV2.sol            # V2 (Phase 2, new) ← CURRENT
├── RiscZeroMockVerifier.sol          # Mock Verifier (new)
├── interfaces/
│   └── IRiscZeroVerifier.sol         # RISC Zero standard interface (new)
├── deployment.json                   # Deployment info (Single Source of Truth)
└── out/                              # Forge build output
    ├── VeriCallRegistry.sol/
    ├── VeriCallRegistryV2.sol/
    └── RiscZeroMockVerifier.sol/

scripts/
├── check-registry.ts                 # CLI inspector (V1/V2 compatible)
└── deploy-v2.ts                      # V2 deploy script (with auto-sync)

lib/witness/
├── abi.ts                            # V2 ABI (updated)
├── on-chain.ts                       # On-chain operations (V2 compatible)
├── pipeline.ts                       # Pipeline (no changes — same function interface)
├── vlayer-api.ts                     # vlayer API client (no changes)
└── decision-store.ts                 # Cloud SQL store (no changes)
```
