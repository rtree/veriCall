
# VeriCall

A phone AI receptionist that filters calls and forwards legitimate ones, with verifiable on-chain decision logs.

## Overview

VeriCall is an AI-powered phone receptionist system that handles incoming calls to a company's main phone line. It intelligently determines whether to forward calls based on caller verification, while storing all decision logic on-chain for transparency and auditability using Vlayer.

## MVP Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Incoming      │     │   VeriCall      │     │   Destination   │
│   Call          │────▶│   AI Engine     │────▶│   Phone         │
│   (Twilio)      │     │                 │     │   (Forward)     │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │   Vlayer        │
                        │   (On-chain     │
                        │    Witness)     │
                        └─────────────────┘
```

## Core Components

### 1. Twilio Phone Gateway
- **US Phone Number**: Purchased via Twilio as the company's public-facing number
- **Webhook Integration**: Incoming calls trigger VeriCall AI via Twilio webhooks
- **Call Control**: Programmable call forwarding, hold, and rejection

### 2. AI Decision Engine
- **Caller Identification**: Analyze caller ID, voice patterns, and conversation context
- **Intent Classification**: Determine if caller is:
  - Known customer/client
  - Team member/colleague
  - Vendor/partner
  - Unknown/spam
- **Decision Making**: AI decides whether to:
  - Forward to destination number
  - Take a message
  - Reject the call

### 3. On-chain Verification (Vlayer)
- **Decision Logging**: Store call metadata and decision rationale on-chain
- **Verifiable Proofs**: Generate cryptographic proofs for each decision
- **Audit Trail**: Immutable record of all call handling decisions
- **Dispute Resolution**: Enable third-party verification of AI decisions

## Data Flow

1. **Incoming Call** → Twilio receives call on US number
2. **Webhook Trigger** → Twilio sends call data to VeriCall backend
3. **AI Processing** → Analyze caller and determine action
4. **Decision Made** → Forward, reject, or take message
5. **On-chain Log** → Record decision + reasoning via Vlayer
6. **Action Executed** → Twilio performs the decided action

## Decision Logic Schema

```json
{
  "callId": "uuid",
  "timestamp": "ISO8601",
  "callerNumber": "+1XXXXXXXXXX",
  "callerIdentity": {
    "known": true,
    "type": "customer|colleague|vendor|unknown",
    "confidence": 0.95
  },
  "decision": {
    "action": "forward|reject|voicemail",
    "reason": "Verified customer from CRM database",
    "forwardTo": "+1YYYYYYYYYY"
  },
  "vlayerProof": {
    "txHash": "0x...",
    "verified": true
  }
}
```

## Tech Stack

| Component | Technology |
|-----------|------------|
| Phone Gateway | Twilio Programmable Voice |
| Backend | Node.js / Python |
| AI Engine | OpenAI GPT-4 / Claude |
| Blockchain | Ethereum / Base |
| Verification | Vlayer |
| Database | PostgreSQL (off-chain cache) |

## MVP Milestones

### Phase 1: Basic Call Handling
- [ ] Set up Twilio account with US number
- [ ] Implement webhook endpoint
- [ ] Basic call forwarding logic

### Phase 2: AI Integration
- [ ] Integrate LLM for conversation
- [ ] Implement caller classification
- [ ] Decision engine with rules

### Phase 3: On-chain Verification
- [ ] Integrate Vlayer SDK
- [ ] Design decision logging schema
- [ ] Implement proof generation
- [ ] Deploy smart contracts

### Phase 4: Production Ready
- [ ] Security hardening
- [ ] Monitoring & alerting
- [ ] Admin dashboard

## API Endpoints (MVP)

```
POST /webhook/incoming    - Twilio incoming call webhook
POST /webhook/status      - Call status updates
GET  /calls/:id           - Get call details
GET  /verify/:txHash      - Verify on-chain decision
```

## Environment Variables

```
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
DESTINATION_PHONE_NUMBER=
OPENAI_API_KEY=
VLAYER_API_KEY=
ETHEREUM_RPC_URL=
```

## License

MIT


