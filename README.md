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

**A "Mathematical Gatekeeper" — Protecting Your Family from AI Scams with Verifiable Trust**

> **We don't prove the AI is correct. We prove the operator can't secretly change the story afterward.**
> *— AI decision non-repudiation + public accountability, anchored on-chain.*

<img width="1000" alt="VeriCall Live Demo — full pipeline from phone call to on-chain record" src="docs/screenshots/demo-pipeline-complete.png" />

## 📞 The Problem

Phone calls remain one of the most universal communication tools — used across all generations, from grandparents to business professionals. But **trust in phone calls is quietly eroding**.

Spam, robocalls, and impersonation fraud have made people hesitant to pick up unknown numbers. And now, AI voice synthesis is lowering the barrier further — making it possible to fake a familiar voice from a short sample.

- 🇺🇸 **"Grandparent Scams"** — USA: phone fraud costs billions annually
- 🇪🇺 **"Impersonation Scams"** — Europe: AI-generated voice fraud is emerging
- 🇯🇵 **"オレオレ詐欺"** — Japan: a decades-old problem now amplified by voice AI

The phone itself is not the problem — **the lack of verifiable trust is**. When you can't confirm who's really calling or what really happened on a call, the phone becomes less useful for everyone.

## 🛡️ The Solution: A Mathematical Gatekeeper

VeriCall puts a wall of logic — without emotions — in front of every call.

### 1. 🤖 AI Agent Answers First

The AI answers all calls before they reach your family. It has no emotions. Even if a scammer cries, screams, or fabricates an emergency — the AI stays calm and checks **facts** and **identity**.

### 2. 📋 Strict Rules, No Exceptions

The AI follows **fixed screening rules**. It never skips verification even if the voice sounds like your family. The rules are embedded in the source code — public, auditable, unchangeable per-caller.

### 3. ⚡ Spam or Important?

- **SPAM** → The AI blocks the call immediately and sends a **Spam Alert** to you.
- **IMPORTANT** → The AI connects the call to you or sends an email notification right away.

### 4. 🔐 Proof on Chain (ZK Proof)

The AI's decision is anchored **on-chain** using [vlayer](https://vlayer.xyz) Web Proofs and ZK Proofs. VeriCall doesn't claim to prove the AI is fair — instead, it creates **non-repudiation**: the operator cannot rewrite, deny, or secretly alter a decision after the fact. Every decision, every reasoning, every ruleset hash is committed to an immutable record on Base Sepolia — with **Decision–Journal Binding** that makes proof-and-decision inseparable.

> 🔍 **You don't need to take VeriCall's word for it.** Every on-chain record — decision, reasoning, ruleset hash, transcript hash, source code commit — is publicly readable. Verify [from your browser](https://vericall-kkz6k4jema-uc.a.run.app/verify) or [from the CLI](scripts/verify.ts). No API keys, no VeriCall servers required.

## How It Works

### Step 1: AI Screens the Call

A real phone call comes in via Twilio. The AI (Gemini 2.5 Flash) listens via streaming speech-to-text, evaluates the caller's intent, and decides: **BLOCK** or **RECORD**. The decision, reasoning, transcript hash, and ruleset hash are stored in a Decision API endpoint.

### Step 2: Web Proof (TLSNotary)

vlayer's Web Prover fetches the Decision API response using TLSNotary — a third-party Notary joins the TLS session via MPC, never sees the plaintext, but cryptographically attests that VeriCall's server genuinely returned this JSON.

### Step 3: ZK Proof (RISC Zero)

vlayer's ZK Prover compresses the Web Proof into a succinct RISC Zero proof. JMESPath extraction pulls 5 fields — `decision`, `reason`, `systemPromptHash`, `transcriptHash`, `sourceCodeCommit` — into a 10-field ABI-encoded journal.

### Step 4: On-Chain Record

The proof and journal are submitted to `VeriCallRegistry` on Base Sepolia. The contract validates **every field** before storing — 15 on-chain checks including Decision–Journal Binding. → [Deep dive](#on-chain-verification)

## What Gets Proven — Non-Repudiation Through ZK

Every call produces a ZK proof containing these journal fields. Once on-chain, the operator **cannot** alter, deny, or selectively disclose any of them.

| What's Non-Repudiable | ZK Journal Parameter | Mechanism |
|---|---|---|
| **The decision** | `provenDecision` (`BLOCK` / `RECORD`) | TLSNotary attests server response → ZK extracts → contract binds via `keccak256` match |
| **The reasoning** | `provenReason` (full text) | Same binding — reasoning is cryptographically inseparable from the proof |
| **AI screening rules** | `provenSystemPromptHash` (SHA-256) | Hash of system prompt in journal. Read the [source code](lib/voice-ai/gemini.ts#L124) at the proven commit → hash → compare. |
| **Conversation evaluated** | `provenTranscriptHash` (SHA-256) | Hash of transcript in journal. Locks which conversation produced this decision. |
| **Source code version** | `provenSourceCodeCommit` (git SHA) | Commit embedded in API response, attested by TLSNotary. [Inspect on GitHub](https://github.com/rtree/veriCall). |
| **When it happened** | `timestamp` | TLS session timestamp — set by TLSNotary during MPC, not by the server. |
| **Proof targets VeriCall** | `url` + `method` + `notaryKeyFingerprint` | Contract validates URL prefix, HTTP method, and Notary identity. No proof reuse from other APIs. |

> **Privacy**: Phone numbers never go on-chain. Transcript is hashed. AI reasoning is in plaintext — intentional, because accountability requires public auditability.

**In plain language**: After a call, VeriCall's decision is sealed in a ZK proof and written to the blockchain. From that point, VeriCall cannot claim it made a different decision, applied different rules, evaluated a different conversation, or ran different code. **The story is locked.**

## Trust Model

**Honest boundaries — what the proofs do NOT guarantee:**
- That the deployed binary *exactly* matches the proven commit — requires reproducible builds or TEE. If the binary differs, behavior diverges from public code — a detectable inconsistency.
- That the AI model internally computed the decision honestly — TLSNotary proves what the *server returned*, not what the *model computed*. The source code *shows* a Gemini API call — deviation is a falsified commit.

**What becomes verifiable through public source code:**

The proven commit links to [auditable code on GitHub](https://github.com/rtree/veriCall). Anyone can:
- Read [`gemini.ts`](lib/voice-ai/gemini.ts#L124) — the exact AI screening rules (system prompt)
- Read [`decision-store.ts`](lib/witness/decision-store.ts#L46) — how `systemPromptHash` is computed
- Read [`route.ts`](app/api/witness/decision/%5BcallSid%5D/route.ts#L30) — how `transcriptHash` is computed

If on-chain hashes don't match the code at the proven commit → **the server lied about its commit**.

### 🔗 How Source Code Gets Proven

The git commit SHA is embedded inside the same Decision API response that TLSNotary already attests — no separate GitHub API call, zero rate limit concerns.

1. At **build time**, the server captures its git commit (`git rev-parse HEAD`)
2. The **Decision API** embeds this commit in every JSON response alongside the decision
3. **TLSNotary** attests the entire response in a single proof — decision, hashes, AND commit SHA
4. The **contract** stores `provenSourceCodeCommit` on-chain and enforces non-empty
5. **Anyone** can inspect the exact code at [`github.com/rtree/veriCall/tree/<commit>`](https://github.com/rtree/veriCall)

The result: every on-chain record points to a specific, public, auditable snapshot of VeriCall's source code. If the operator lies about the commit, the code won't match the observed behavior — a publicly detectable lie.

```
  Trust Evolution:

  Today (no VeriCall)         VeriCall (now)                   Future
  ┌──────────────────┐        ┌──────────────────────────┐     ┌──────────────────────────┐
  │ Trust the         │        │ Trust server attestation  │     │ Trust Google API          │
  │ operator entirely │ ──→    │ + chain immutability      │ ──→ │ attestation + TEE         │
  │                   │        │ + auditable source code   │     │ (full inference proof)    │
  │ "Just trust us"   │        │ "Operator can't rewrite   │     │ "Even the server can't    │
  │                   │        │  history"                 │     │  lie about AI output"     │
  └──────────────────┘        └──────────────────────────┘     └──────────────────────────┘
```

**Narrowing the trust gap (future):** Attesting the Vertex AI API response directly (proving *Google's model* returned this decision) or running the server inside a TEE. Both would shift trust from "VeriCall's server" to independently verifiable infrastructure.

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
                                    VeriCallRegistry
                                               │
                    ┌──────────────────────────┤
                    │                          │
                    ▼                          ▼
            🔍 Anyone               💻 GitHub (Public)
            verifies on-chain       github.com/rtree/veriCall
            via /verify             Audit source at proven commit
```

> ⚠️ **Hackathon Deployment**: The ZK seal verifier uses `MockVerifier` — vlayer's ZK Prover has not yet shipped production Groth16 proofs. **All other 14 on-chain checks are real and enforced**: journal decode, notary validation, URL binding, decision–journal `keccak256` matching, hash presence, source code commit. The contract is production-ready — swap `MockVerifier` → `RiscZeroVerifierRouter` with zero code changes. → [Details](DESIGN.md#39-verifier-honesty-mockverifier-vs-production)

## On-Chain Verification

> 💡 **Core Technical Contribution: Decision–Journal Binding.** Most Web Proof projects store attested data. VeriCall goes further — the contract *forces* the submitted decision to match the proven decision via `keccak256`. You can't submit a valid ZK proof with decision "RECORD" and store "BLOCK". The proof and the record are cryptographically inseparable.

The contract doesn't just store data — it validates every field before accepting a record.

### 10-Field Journal

The ZK proof produces an ABI-encoded journal. All 10 fields are decoded and validated on-chain:

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
| `provenTranscriptHash` | SHA-256 of conversation — from the API response | Contract requires non-empty; commits to which conversation was evaluated |
| `provenSourceCodeCommit` | Git commit SHA — from the API response | Contract requires non-empty; links to auditable code on GitHub |

### What the Contract Checks

```
registerCallDecision(callId, decision, reason, seal, journal)
│
├─ A. ZK proof — verifier.verify(seal, imageId, sha256(journal))
├─ B. Decode journal → 10 fields
├─ C. Notary fingerprint == expected constant
├─ D. HTTP method == "GET"
├─ E. queriesHash == expected hash
├─ F. URL starts with expected prefix (byte-by-byte)
├─ G. systemPromptHash is non-empty
├─ H. transcriptHash is non-empty
├─ I. sourceCodeCommit is non-empty
├─ J. decision matches provenDecision (keccak256)
├─ K. reason matches provenReason (keccak256)
├─ L. callId not already registered (duplicate prevention)
└─ M. Store record + emit CallDecisionRecorded event
```

### Decision–Journal Binding (Steps I–J)

The decision and reason are stored as typed fields (for queryability) but also exist inside the ZK journal as proven strings. The contract checks both via `keccak256` — if anyone submits a valid proof with a different decision label, the transaction reverts.

### Upgrade Path

The `verifier` is an `IRiscZeroVerifier` interface injected via constructor:

```
Current:    VeriCallRegistry( MockVerifier,   imageId, ... )
Production: VeriCallRegistry( VerifierRouter, imageId, ... )
```

Zero code changes needed. [RISC Zero's verifier infrastructure is production-ready](https://github.com/boundless-xyz/boundless-foundry-template). The remaining bottleneck is vlayer's ZK Prover transitioning from dev-mode seals to real Groth16 proofs. → [Details](DESIGN.md#39-verifier-honesty-mockverifier-vs-production)

Anyone can call `getProvenData(callId)` to decode all 10 journal fields directly from the contract. No API keys required.

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

## Beyond Phone Calls

This pattern — **committing an AI decision, its inputs, and its rules to an immutable on-chain record** — applies to any AI decision system:

| Domain | What's Verified |
|--------|------------------|
| 📞 Call Screening | AI classification committed on-chain |
| 📄 Resume Screening | AI evaluation committed on-chain |
| 🏦 Loan Decisions | AI assessment committed on-chain |
| 🛡️ Content Moderation | AI moderation committed on-chain |
| ⚖️ Insurance Claims | AI claim decision committed on-chain |

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Phone** | Twilio Programmable Voice + Media Streams |
| **AI** | Vertex AI Gemini 2.5 Flash |
| **STT / TTS** | Google Cloud Speech / Text-to-Speech |
| **Server** | Next.js 16 + custom WebSocket server on Cloud Run |
| **Web Proofs** | vlayer Web Prover (TLSNotary / MPC) |
| **ZK Proofs** | vlayer ZK Prover (RISC Zero) |
| **Chain** | Base Sepolia · viem · VeriCallRegistry (Solidity / Foundry) |
| **Email** | SendGrid |

## Getting Started

```bash
pnpm install
cp .env.example .env.local   # configure credentials
pnpm dev                      # dev server with WebSocket
```

→ [Deployment guide](docs/DEPLOY.md) · [Full project structure & design](DESIGN.md)

## Status & Roadmap

**Working today**: Real-time AI call screening → TLSNotary Web Proof → RISC Zero ZK Proof → on-chain journal validation (10-field decode, decision–journal binding, GitHub Code Attestation) → independent verification via [browser](https://vericall-kkz6k4jema-uc.a.run.app/verify) and [CLI](scripts/verify.ts). Deployed on Cloud Run + Base Sepolia.

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
