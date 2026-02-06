# VeriCall

**Verifiable AI Call Screening — Proving Fairness On-Chain**

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
4. **Generates a Web Proof** — a cryptographic attestation via TLSNotary that the AI service (Gemini) actually produced this specific output for this specific input
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

VeriCall is the **reference implementation** — phone calls are the first use case, but the verification framework is designed to be reusable.

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
│   └── voice-ai/
│       ├── session.ts           # Call session lifecycle + utterance buffering
│       ├── gemini.ts            # AI screening (system prompt + chat + decision parsing)
│       ├── speech-to-text.ts    # Google STT streaming (phone_call model)
│       ├── text-to-speech.ts    # Google TTS (μ-law output)
│       ├── audio-utils.ts       # μ-law ↔ Linear16 codec
│       ├── email-notify.ts      # SendGrid email (OK/SCAM templates)
│       └── index.ts             # Session store (create/get/remove)
│
├── app/
│   ├── phone/
│   │   ├── incoming/route.ts    # Twilio incoming call webhook → TwiML + Stream
│   │   ├── status/route.ts      # Call status callbacks
│   │   └── logs/route.ts        # Call log API
│   │
│   ├── witness/
│   │   ├── _lib/
│   │   │   ├── vlayer-client.ts # vlayer API integration (Web Proof → ZK Proof)
│   │   │   ├── store.ts         # Witness records (in-memory MVP)
│   │   │   └── types.ts         # WitnessRecord, DecisionData, ProofStatus
│   │   ├── list/route.ts        # GET /witness/list — proof records
│   │   └── verify/[id]/route.ts # GET /witness/verify/:id — verify a proof
│   │
│   ├── monitoring/page.tsx      # Dashboard UI
│   └── api/health/route.ts      # Health check
│
├── playground/
│   └── vlayer/                  # Experimental vlayer scripts
│
├── Dockerfile                   # Cloud Run deployment
└── docs/                        # Additional documentation
```

## How vlayer Integration Works

### The Core Idea

When VeriCall's AI screens a call, it sends the conversation to **Gemini 2.5 Flash** via HTTPS. That HTTPS request-response is a TLS session. Using vlayer's **TLSNotary** protocol, we can have a third-party Notary cryptographically attest that Gemini genuinely produced a specific response for a specific input — without the Notary ever seeing the plaintext.

This attestation (Web Proof) is then compressed into a **ZK Proof** and stored **on-chain**, creating an immutable record that anyone can verify.

### The Verification Pipeline

#### Step 1: Capture Decision Data

At the moment the AI makes a decision, VeriCall captures everything needed for verification:

```typescript
interface DecisionData {
  callId: string;           // Unique call identifier
  timestamp: string;        // ISO 8601 timestamp
  callerHash: string;       // SHA-256 of caller's phone number (privacy)
  systemPromptHash: string; // SHA-256 of the AI's ruleset (SYSTEM_PROMPT)
  transcript: string;       // Full conversation transcript
  action: 'BLOCK' | 'RECORD';
  reason: string;           // AI's stated reasoning
  confidence: number;       // Decision confidence score
}
```

#### Step 2: Generate Web Proof (vlayer Web Prover)

The Gemini API call is notarized using TLSNotary through vlayer's **server-side proving**:

```
VeriCall Server ──→ vlayer Web Prover ──→ Gemini API
                    (TLSNotary / MPC)
                         │
                         ▼
                    Web Proof
                    (cryptographic attestation of TLS transcript)
```

- The Web Prover joins the TLS connection as a Notary via Multi-Party Computation
- It **never sees the plaintext** — it only holds half the encryption key
- It signs a commitment proving the server (Gemini) genuinely produced the response
- Sensitive headers (API keys) are **redacted** from the proof

```
POST https://web-prover.vlayer.xyz/api/v1/prove
{
  "url": "https://generativelanguage.googleapis.com/...",
  "method": "POST",
  "headers": ["Content-Type: application/json", "Authorization: Bearer <token>"],
  "body": "<system prompt + conversation history>",
  "redaction": [{ "request": { "headers": ["Authorization"] } }]
}

→ Returns: { data: "0x014000...", version: "0.1.0-alpha.12", meta: {...} }
```

#### Step 3: Compress to ZK Proof (vlayer ZK Prover)

The web proof is compressed into a succinct zero-knowledge proof via RISC Zero:

```
POST https://zk-prover.vlayer.xyz/api/v0/compress-web-proof
{
  "presentation": { <web proof from Step 2> },
  "extraction": {
    "response.body": {
      "jmespath": ["candidates[0].content.parts[0].text"]
    }
  }
}

→ Returns: { zkProof: "0xffffffff...", journalDataAbi: "0xa7e62d..." }
```

The `journalDataAbi` is an ABI-encoded tuple containing:
- `notaryKeyFingerprint` — which notary signed the proof
- `method` / `url` — the exact HTTP request proven
- `tlsTimestamp` — when the TLS session occurred (not self-reported)
- `extractionHash` — hash of the extraction query (prevents query substitution)
- `extractedValue0` — the AI's actual response text

#### Step 4: Submit On-Chain (Base Sepolia)

```solidity
// VeriCallRegistry.sol (planned)
contract VeriCallRegistry {

    struct CallProof {
        bytes32 systemPromptHash;   // Hash of AI ruleset — publicly verifiable
        bytes32 transcriptHash;     // Hash of conversation input
        bytes   zkProof;            // vlayer ZK proof (RISC Zero seal)
        bytes   journalDataAbi;     // ABI-encoded verified outputs
        uint256 timestamp;          // TLS session timestamp
        address submitter;          // Who submitted this proof
    }

    mapping(bytes32 => CallProof) public proofs;  // callId → proof

    event ProofSubmitted(bytes32 indexed callId, bytes32 systemPromptHash, uint256 timestamp);

    function submitProof(
        bytes32 callId,
        bytes32 systemPromptHash,
        bytes32 transcriptHash,
        bytes calldata zkProof,
        bytes calldata journalDataAbi
    ) external {
        proofs[callId] = CallProof({
            systemPromptHash: systemPromptHash,
            transcriptHash: transcriptHash,
            zkProof: zkProof,
            journalDataAbi: journalDataAbi,
            timestamp: block.timestamp,
            submitter: msg.sender
        });
        emit ProofSubmitted(callId, systemPromptHash, block.timestamp);
    }
}
```

### What Gets Proven

| Element | How It's Verified |
|---------|-------------------|
| **The AI ruleset** | `systemPromptHash` — anyone can check the hash matches the company's published rules |
| **The input** | `transcriptHash` — the conversation that was fed to the AI is hashed and recorded |
| **The AI actually responded** | Web Proof via TLSNotary — cryptographic proof that Gemini produced this output |
| **The output wasn't tampered** | ZK Proof — compressed, on-chain verifiable attestation via RISC Zero |
| **When it happened** | `tlsTimestamp` from the TLS session itself (not self-reported by the company) |
| **Privacy preserved** | Caller phone is hashed; API keys are redacted; ZK proof hides raw data |

### Verification Flow (for a caller or auditor)

```
1. Caller receives a callId reference after the call
2. Look up: VeriCallRegistry.proofs(callId) on Base Sepolia
3. Retrieve: systemPromptHash, transcriptHash, zkProof, journalDataAbi
4. Check: Does systemPromptHash match the company's publicly published ruleset?
5. Check: Is the zkProof valid? (on-chain verification via RISC Zero)
6. Check: Does journalDataAbi contain the expected decision?
7. Result: Cryptographic proof that this AI made this decision,
           using these specific rules, given this specific input, at this exact time
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/phone/incoming` | Twilio incoming call webhook |
| POST | `/phone/status` | Call status callback |
| GET | `/phone/logs` | Call log history |
| GET | `/witness/list` | On-chain proof records |
| GET | `/witness/verify/:id` | Verify a specific proof |
| GET | `/api/health` | Health check |
| WS | `/stream` | Twilio Media Stream (real-time audio) |

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

## Current Status

| Feature | Status |
|---------|--------|
| Real-time AI call screening | ✅ Production |
| Intent-based BLOCK/RECORD decisions | ✅ Production |
| Email notifications (OK/SCAM templates) | ✅ Production |
| AI-powered call summaries (Gemini) | ✅ Production |
| Utterance buffering for speech quality | ✅ Production |
| vlayer Web Proof generation | 🔧 Scaffolded |
| vlayer ZK Proof compression | 🔧 Scaffolded |
| On-chain proof submission (Base) | 📋 Planned |
| Verifier smart contract | 📋 Planned |
| Public verification dashboard | 📋 Planned |

## License

MIT


