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

<img width="1000" alt="VeriCall Live Demo — full pipeline from phone call to on-chain record" src="docs/screenshots/demo-pipeline-complete.png" />

## 🌍 The Crisis

**Voice is no longer proof of identity.**

"Voice Cloning" scams are surging worldwide. Scammers copy a family member's voice from a short sample — then call with fabricated emergencies: fake accidents, fake arrests, fake hospital bills. People in panic cannot think clearly. These attacks exploit human emotions with surgical precision.

- 🇺🇸 **"Grandparent Scams"** — USA: $3.4B lost to phone fraud annually (FTC 2023)
- 🇪🇺 **"Impersonation Scams"** — Europe: AI-generated voice fraud rising sharply
- 🇯🇵 **"オレオレ詐欺"** — Japan: decades-old scam supercharged by AI voice synthesis

We cannot protect our families only by saying *"Be careful"* against these technical attacks. We need a **technical shield**.

## 🛡️ The Solution: A Mathematical Gatekeeper

VeriCall puts a wall of logic — without emotions — in front of every call.

### 1. 🤖 AI Agent Answers First

The AI answers all calls before they reach your family. It has no emotions. Even if a scammer cries, screams, or fabricates an emergency — the AI stays calm and checks **facts** and **identity**.

### 2. 📋 Strict Rules, No Exceptions

The AI follows **fixed screening rules**. It never skips verification even if the voice sounds like your family. The rules are embedded in the source code — public, auditable, unchangeable per-caller.

### 3. ⚡ Spam or Important?

- **SPAM** → The AI blocks the call immediately and sends a **Spam Alert** to you.
- **IMPORTANT** → The AI connects the call to you or sends an email notification right away.

### 4. 🔐 Proof of Honesty (ZK Proof)

The AI's decision is anchored **on-chain** using [vlayer](https://vlayer.xyz) Web Proofs and ZK Proofs. By using Zero-Knowledge Proofs, VeriCall proves that **the AI followed the rules correctly** — while keeping your privacy. Every decision, every reasoning, every ruleset hash is committed to an immutable record on Base Sepolia.

> 🔍 **You don't need to take VeriCall's word for it.** Every on-chain record — decision, reasoning, ruleset hash, transcript hash, source code commit — is publicly readable. Verify [from your browser](https://vericall-kkz6k4jema-uc.a.run.app/verify) or [from the CLI](scripts/verify.ts). No API keys, no VeriCall servers required.

## Verifiable Trust — From Black Box to Explainable AI

VeriCall is not a "black box." You can check the logic later to see **why** the AI made that decision. This is an **Audit Trail** — not just for regulators, but for anyone affected by the decision.

> *"Protecting family love with a shield of technology."*

In a world where we cannot trust voices, VeriCall creates a new standard: **Verifiable Trust**.

### Beyond Phone Calls

This pattern — **committing an AI decision, its inputs, and its rules to an immutable on-chain record** — applies to any AI decision system:

| Domain | What's Verified |
|--------|-----------------|
| 📞 Call Screening | AI classification committed on-chain |
| 📄 Resume Screening | AI evaluation committed on-chain |
| 🏦 Loan Decisions | AI assessment committed on-chain |
| 🛡️ Content Moderation | AI moderation committed on-chain |
| ⚖️ Insurance Claims | AI claim decision committed on-chain |

## What Gets Proven

| Element | How |
|---------|-----|
| **AI ruleset** | `provenSystemPromptHash` — SHA-256 of the AI's rules, committed in the ZK journal. Anyone can hash the published rules and compare — detects rule changes. |
| **Conversation input** | `provenTranscriptHash` — SHA-256 of the transcript, committed in the ZK journal. Commits to which conversation the server evaluated. |
| **Decision is server-attested** | TLSNotary Web Proof — a third-party Notary attests VeriCall's server genuinely returned this decision (server-level attestation, not AI-level). |
| **Output wasn't tampered** | Decision–Journal Binding — on-chain `keccak256` comparison ensures submitted decision/reason match the proven values. |
| **When it happened** | TLS session timestamp — from the TLS connection itself, not self-reported. |
| **Source code version** | `provenSourceCodeCommit` — git commit SHA of VeriCall's source code at decision time. TLSNotary-attested (not self-reported). Anyone can inspect the exact code at `github.com/rtree/veriCall/tree/<commit>`. See [GitHub Code Attestation](#-github-code-attestation). |
| **Privacy** | Phone numbers never go on-chain. Transcript is hashed. AI reasoning is stored in plaintext — intentional, because accountability requires the reasoning to be publicly auditable. |

## Trust Model

**What the proofs guarantee:**
- VeriCall's server genuinely returned this specific decision and reasoning (TLSNotary attestation — a third-party Notary cryptographically confirms the HTTPS response)
- The server committed to a specific AI ruleset hash, transcript hash, and **source code commit** at proof time
- The on-chain record exactly matches the attested response (Decision–Journal Binding via `keccak256`)
- The record is immutable — VeriCall cannot retroactively alter any committed field
- **The source code version is proven on-chain** — anyone can read the exact code at `github.com/rtree/veriCall/tree/<commit>`

**What becomes verifiable through public source code (V4):**
- `systemPromptHash` — open [`lib/voice-ai/gemini.ts`](lib/voice-ai/gemini.ts#L124) at the proven commit, read `GeminiChat.getSystemPrompt()`, compute SHA-256, compare with on-chain value. **If they don't match, the server lied about its commit.**
- `transcriptHash` — the hashing logic is in [`app/api/witness/decision/[callSid]/route.ts`](app/api/witness/decision/%5BcallSid%5D/route.ts#L30). The pipeline from audio → transcript is in [`lib/voice-ai/session.ts`](lib/voice-ai/session.ts). All readable at the proven commit.
- Decision logic — the AI screening rules, Gemini API parameters, and response parsing are all visible in the source code at the proven commit.

**What the proofs do NOT guarantee (today):**
- That the deployed binary *exactly* matches the proven commit — this would require reproducible builds or TEE. However, if the binary differs, the behavior will diverge from the public code — a detectable inconsistency.
- That the AI model internally computed the decision honestly — TLSNotary proves what the *server returned*, not what the *model computed*. But the source code *shows* a Gemini API call — any deviation is a falsified commit.

**Why this matters:**
Today, AI call screening is a black box — the company controls the AI, the rules, and the logs. A blocked caller has no recourse and no evidence.

VeriCall creates **public accountability**. The server is cryptographically locked into `(decision, reason, systemPromptHash, transcriptHash, sourceCodeCommit)` at a specific time. The source code at that commit is public — anyone can read the screening rules, hash them, and verify against on-chain values. VeriCall can't secretly change its screening rules per caller, and can't deny or alter a decision after the fact. This is **immutable commitment + auditable source code** — significantly stronger than simple server attestation.

### 🔗 GitHub Code Attestation

**V4 introduces *GitHub Code Attestation* — the on-chain record includes the git commit SHA of VeriCall's source code, proven through TLSNotary.**

How it works:
1. At **build time**, the server captures its git commit (`git rev-parse HEAD`)
2. The **Decision API** embeds this commit in every JSON response
3. **TLSNotary** attests the entire response — including the commit SHA
4. The **contract** stores `provenSourceCodeCommit` on-chain and enforces non-empty
5. **Anyone** can inspect the exact code version at `github.com/rtree/veriCall/tree/<commit>`

This means you know not just *what* the server returned, but *which code* was running when it made the decision. If VeriCall changes its logic, the commit changes — and that change is visible on-chain forever.

**What it proves and what it doesn't:**

| | |
|---|---|
| ✅ The server *claimed* to be running commit X, and TLSNotary sealed that claim | Tamper-proof commitment |
| ✅ Anyone can read commit X on GitHub and audit the full source | Open-source accountability |
| ✅ If the server lies about its commit, the code at that SHA won't match the behavior | Lies are publicly detectable |
| ⚠️ Does not independently prove the *deployed binary* matches commit X | Would require reproducible builds or TEE |

> **Future enhancement**: vlayer's Web Prover can also attest GitHub's API directly (`api.github.com/repos/rtree/veriCall/commits/<sha>`) — independently proving the commit *exists* on GitHub. We confirmed this works in a PoC (Web Proof generated in 61s). This is deferred because the current approach already creates a strong accountability chain, and adding a second Web Proof per call would double pipeline latency. → [Details](DESIGN.md#-github-code-attestation-source-code-accountability)

**Narrowing the trust gap (future):** If vlayer's Web Prover adds POST support with custom headers, VeriCall could directly attest the Vertex AI API response — proving that *Google's AI model* (not just VeriCall's server) returned this specific decision for this specific input. This would shift trust from "VeriCall's server" to "Google's infrastructure" — a much smaller trust assumption. Beyond that, running the server inside a TEE (Trusted Execution Environment) could prove that specific code processed specific inputs, approaching full AI inference verification.

**Development status:** The ZK seal verifier currently uses `MockVerifier` (development mode — vlayer's ZK Prover has not yet shipped production Groth16 proofs). All other on-chain checks (journal decode, notary validation, URL binding, decision matching, hash presence) are real and enforced. The contract architecture supports production Groth16 with zero code changes → [Details](DESIGN.md#39-verifier-honesty-mockverifier-vs-production).

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
                                   VeriCallRegistryV4
```

## How It Works

### Step 1: AI Screens the Call

A real phone call comes in via Twilio. The AI (Gemini 2.5 Flash) listens via streaming speech-to-text, evaluates the caller's intent, and decides: **BLOCK** or **RECORD**. The decision, reasoning, transcript hash, and ruleset hash are stored in a Decision API endpoint.

### Step 2: Web Proof (TLSNotary)

vlayer's Web Prover fetches the Decision API response using TLSNotary — a third-party Notary joins the TLS session via MPC, never sees the plaintext, but cryptographically attests that VeriCall's server genuinely returned this JSON.

### Step 3: ZK Proof (RISC Zero)

vlayer's ZK Prover compresses the Web Proof into a succinct RISC Zero proof. JMESPath extraction pulls 5 fields — `decision`, `reason`, `systemPromptHash`, `transcriptHash`, `sourceCodeCommit` — into a 10-field ABI-encoded journal.

### Step 4: On-Chain Verification

The proof and journal are submitted to `VeriCallRegistryV4` on Base Sepolia. The contract validates every field before storing. Details below.

## On-Chain Verification

This is VeriCall's core technical contribution. The contract doesn't just store data — it validates every field before accepting a record.

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
├─ I. sourceCodeCommit is non-empty ← NEW in V4
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
Current:    VeriCallRegistryV4( MockVerifier,   imageId, ... )
Production: VeriCallRegistryV4( VerifierRouter, imageId, ... )
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

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Phone** | Twilio Programmable Voice + Media Streams |
| **AI** | Vertex AI Gemini 2.5 Flash |
| **STT / TTS** | Google Cloud Speech / Text-to-Speech |
| **Server** | Next.js 16 + custom WebSocket server on Cloud Run |
| **Web Proofs** | vlayer Web Prover (TLSNotary / MPC) |
| **ZK Proofs** | vlayer ZK Prover (RISC Zero) |
| **Chain** | Base Sepolia · viem · VeriCallRegistryV4 (Solidity / Foundry) |
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
