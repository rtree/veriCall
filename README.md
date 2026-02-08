# VeriCall

<p align="left">
  <a href="https://vericall-kkz6k4jema-uc.a.run.app/demo">
    <img src="https://img.shields.io/badge/▶_LIVE_DEMO-Watch_the_Pipeline-06b6d4?style=for-the-badge" alt="Live Demo" />
  </a>
  &nbsp;
  <a href="https://vericall-kkz6k4jema-uc.a.run.app/verify">
    <img src="https://img.shields.io/badge/🔍_VERIFY-Check_On--Chain_Records-10b981?style=for-the-badge" alt="Verify Records" />
  </a>
</p>

**Verifiable AI Call Screening — Proving Fairness On-Chain**

<img width="1000" alt="VeriCall Live Demo — full pipeline from phone call to on-chain record" src="docs/screenshots/demo-pipeline-complete.png" />

## The Problem

Companies use AI to screen phone calls — blocking spam while forwarding legitimate business. But who watches the AI?

- How do callers know the AI judged them fairly?
- What rules was the AI given?
- Was the same ruleset applied to everyone?

Today, there's no record. The company controls the AI, the rules, and the logs. A caller blocked by AI has no recourse.

## The Solution

VeriCall anchors every AI decision **on-chain** using [vlayer](https://vlayer.xyz) Web Proofs and ZK Proofs.

For every call, VeriCall:

1. **Captures the inputs** — conversation transcript hash + AI ruleset hash
2. **Generates a Web Proof** — TLSNotary attests that VeriCall's server genuinely returned this decision
3. **Compresses to a ZK Proof** — RISC Zero compresses the attestation for on-chain storage
4. **Submits on-chain** — an immutable, publicly verifiable record on Base Sepolia

> 🔍 **You don't need to trust VeriCall.** Every record can be verified independently — [from your browser](https://vericall-kkz6k4jema-uc.a.run.app/verify) or [from the CLI](scripts/verify.ts). No API keys, no VeriCall servers — just you and the chain.

### Beyond Phone Calls

This pattern — **proving that an AI made a specific decision given specific inputs and rules** — applies to any AI decision:

| Domain | What's Verified |
|--------|-----------------|
| 📞 Call Screening | AI fairly classified caller |
| 📄 Resume Screening | AI fairly evaluated applicant |
| 🏦 Loan Decisions | AI fairly assessed creditworthiness |
| 🛡️ Content Moderation | AI fairly applied guidelines |
| ⚖️ Insurance Claims | AI fairly processed claim |

## What Gets Proven

| Element | How |
|---------|-----|
| **AI ruleset** | `provenSystemPromptHash` — SHA-256 of the AI's rules, proven in the ZK journal. Anyone can hash the published rules and compare. |
| **Conversation input** | `provenTranscriptHash` — SHA-256 of the transcript, proven in the ZK journal. Proves which conversation the AI evaluated. |
| **Decision is authentic** | TLSNotary Web Proof — a third-party Notary attests the server genuinely returned this decision. |
| **Output wasn't tampered** | Decision–Journal Binding — on-chain `keccak256` comparison ensures submitted decision/reason match the proven values. |
| **When it happened** | TLS session timestamp — from the TLS connection itself, not self-reported. |
| **Privacy** | Phone numbers never go on-chain. Transcript is hashed. AI reasoning is stored in plaintext — intentional, because accountability requires the reasoning to be publicly auditable. |

## Architecture

```
  📞 Caller ──→ Twilio ──→ WebSocket ──→ VeriCall Server (Cloud Run)
                                              │
                              ┌────────────────┴────────────────┐
                              │         Audio Pipeline          │
                              │    STT ──→ Gemini ──→ TTS      │
                              │              │                  │
                              │          Decision               │
                              │       (BLOCK / RECORD)          │
                              └────────────────┬────────────────┘
                                               │
                    ┌──────────────────────────┤
                    │                          │
                    ▼                          ▼
           📧 Email Notify          Decision API (HTTPS)
                                               │
                                               ▼
                                      vlayer Web Prover
                                        (TLSNotary)
                                               │
                                               ▼
                                      vlayer ZK Prover
                                        (RISC Zero)
                                               │
                                               ▼
                                      Base Sepolia
                                   VeriCallRegistryV3
```

## How It Works

### Step 1: AI Screens the Call

A real phone call comes in via Twilio. The AI (Gemini 2.5 Flash) listens via streaming speech-to-text, evaluates the caller's intent, and decides: **BLOCK** or **RECORD**. The decision, reasoning, transcript hash, and ruleset hash are stored in a Decision API endpoint.

### Step 2: Web Proof (TLSNotary)

vlayer's Web Prover fetches the Decision API response using TLSNotary — a third-party Notary joins the TLS session via MPC, never sees the plaintext, but cryptographically attests that VeriCall's server genuinely returned this JSON.

### Step 3: ZK Proof (RISC Zero)

vlayer's ZK Prover compresses the Web Proof into a succinct RISC Zero proof. JMESPath extraction pulls 4 fields — `decision`, `reason`, `systemPromptHash`, `transcriptHash` — into a 9-field ABI-encoded journal.

### Step 4: On-Chain Verification

The proof and journal are submitted to `VeriCallRegistryV3` on Base Sepolia. The contract validates every field before storing. Details below.

## On-Chain Verification

This is VeriCall's core technical contribution. The contract doesn't just store data — it validates every field before accepting a record.

### 9-Field Journal

The ZK proof produces an ABI-encoded journal. All 9 fields are decoded and validated on-chain:

| Field | What It Proves | How It's Verified |
|-------|----------------|-------------------|
| `notaryKeyFingerprint` | Which TLSNotary signed the proof | Contract checks against `EXPECTED_NOTARY_KEY_FP` immutable constant |
| `method` | HTTP method was `GET` | Contract checks `keccak256(method) == keccak256("GET")` |
| `url` | Points to VeriCall's Decision API | Contract checks URL starts with `expectedUrlPrefix` (byte-by-byte) |
| `timestamp` | TLS session time (not self-reported) | Embedded by TLSNotary during MPC — neither client nor server can forge |
| `queriesHash` | JMESPath extraction config is correct | Contract checks against `expectedQueriesHash` constant |
| `provenDecision` | `"BLOCK"` / `"RECORD"` — from the API response | Contract binds to submitted `decision` via `keccak256` match (Steps I–J) |
| `provenReason` | AI reasoning — from the API response | Contract binds to submitted `reason` via `keccak256` match (Steps I–J) |
| `provenSystemPromptHash` | SHA-256 of AI ruleset — from the response | Contract requires non-empty; anyone can hash published rules and compare |
| `provenTranscriptHash` | SHA-256 of conversation — from the response | Contract requires non-empty; proves which conversation the AI evaluated |

### What the Contract Checks

```
registerCallDecision(callId, decision, reason, seal, journal)
│
├─ A. ZK proof — verifier.verify(seal, imageId, sha256(journal))
├─ B. Decode journal → 9 fields
├─ C. Notary fingerprint == expected constant
├─ D. HTTP method == "GET"
├─ E. queriesHash == expected hash
├─ F. URL starts with expected prefix (byte-by-byte)
├─ G. systemPromptHash is non-empty
├─ H. transcriptHash is non-empty
├─ I. decision matches provenDecision (keccak256)
├─ J. reason matches provenReason (keccak256)
├─ K. callId not already registered (duplicate prevention)
└─ L. Store record + emit CallDecisionRecorded event
```

### Decision–Journal Binding (Steps I–J)

The decision and reason are stored as typed fields (for queryability) but also exist inside the ZK journal as proven strings. The contract checks both via `keccak256` — if anyone submits a valid proof with a different decision label, the transaction reverts.

### Upgrade Path

The `verifier` is an `IRiscZeroVerifier` interface injected via constructor:

```
Current:    VeriCallRegistryV3( MockVerifier,   imageId, ... )
Production: VeriCallRegistryV3( VerifierRouter, imageId, ... )
```

Zero code changes needed. [RISC Zero's verifier infrastructure is production-ready](https://github.com/boundless-xyz/boundless-foundry-template). The remaining bottleneck is vlayer's ZK Prover transitioning from dev-mode seals to real Groth16 proofs. → [Details](DESIGN.md#39-verifier-honesty-mockverifier-vs-production)

Anyone can call `getProvenData(callId)` to decode all 9 journal fields directly from the contract. No API keys required.

## Try It Yourself

### 📞 Live Demo

Open **[/demo](https://vericall-kkz6k4jema-uc.a.run.app/demo)** — call the number shown and watch the full pipeline in real-time:

📞 Call → 🤖 AI → ⚖️ Decision → 🔐 WebProof → 🧮 ZK → ⛓️ On-Chain

### 🔍 Verify Records

Open **[/verify](https://vericall-kkz6k4jema-uc.a.run.app/verify)** — runs 12 automated checks per record, entirely client-side. No wallet, no API keys.

<img width="1000" alt="Independent Verification — 45/45 checks passed on Base Sepolia" src="docs/screenshots/verify-all-checks-passed.png" />

```bash
npx tsx scripts/verify.ts          # verify all on-chain records
npx tsx scripts/verify.ts --deep   # also re-fetch Decision API for live check
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Phone** | Twilio Programmable Voice + Media Streams |
| **AI** | Vertex AI Gemini 2.5 Flash |
| **STT / TTS** | Google Cloud Speech / Text-to-Speech |
| **Server** | Next.js 16 + custom WebSocket server on Cloud Run |
| **Web Proofs** | vlayer Web Prover (TLSNotary / MPC) |
| **ZK Proofs** | vlayer ZK Prover (RISC Zero) |
| **Chain** | Base Sepolia · viem · VeriCallRegistryV3 (Solidity / Foundry) |
| **Email** | SendGrid |

## Getting Started

```bash
pnpm install
cp .env.example .env.local   # configure credentials
pnpm dev                      # dev server with WebSocket
```

→ [Deployment guide](docs/DEPLOY.md) · [Full project structure & design](DESIGN.md)

## Status & Roadmap

**Working today**: Real-time AI call screening → TLSNotary Web Proof → RISC Zero ZK Proof → on-chain journal validation (9-field decode, decision–journal binding) → independent verification via [browser](https://vericall-kkz6k4jema-uc.a.run.app/verify) and [CLI](scripts/verify.ts). Deployed on Cloud Run + Base Sepolia.

**Waiting on upstream**: Production Groth16 verification (vlayer ZK Prover) · Solidity SDK migration (vlayer custom hooks). No VeriCall code changes needed for either. → [Details](DESIGN.md#39-verifier-honesty-mockverifier-vs-production)

**Future**: Cross-chain verification · Caller-initiated proofs · Multi-tenant support.

## AI Attribution

This project was built with AI assistance (GitHub Copilot / Claude). Per ETHGlobal rules, here is how AI was used:

| Area | How AI Was Used |
|------|-----------------|
| **Architecture & Research** | SDK documentation lookup (vlayer, RISC Zero, TLSNotary), API design patterns, ZK proof pipeline exploration |
| **Documentation** | Human concept → detailed technical writing (README, DESIGN.md, inline comments) |
| **Code Generation** | Human concept + specs → implementation (Solidity contracts, witness pipeline, verification CLI, web pages) |
| **Debugging** | Log analysis, error diagnosis, Gemini output format investigation |

All architectural decisions, system design, and verification logic were human-directed. AI accelerated implementation and documentation — it did not independently design the proof pipeline or contract validation.

<details>
<summary><strong>More Screenshots</strong></summary>

**On-Chain Transaction (BaseScan)**

<img width="800" alt="BaseScan transaction details" src="docs/screenshots/basescan-tx.png" />

**Email Notification (Scam Alert)**

<img width="500" alt="Email scam alert notification" src="docs/screenshots/email-scam-alert.png" />

**Verification Record Detail (V1–V3 checks)**

<img width="800" alt="Per-record verification checks" src="docs/screenshots/verify-record-detail.png" />

</details>

## License

MIT
