
# VeriCall

A phone AI receptionist that filters calls and forwards legitimate ones, with verifiable on-chain decision logs.

## Overview

VeriCall is an AI-powered phone receptionist system that handles incoming calls to a company's main phone line. It intelligently determines whether to forward calls based on caller verification, while storing all decision logic on-chain for transparency and auditability using Vlayer.

## MVP Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Incoming      │     │   VeriCall      │     │   Destination   │
│   Call          │────▶│   (Next.js on   │────▶│   Phone         │
│   (Twilio)      │     │   Cloud Run)    │     │   (Forward)     │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                        ┌────────┴────────┐
                        ▼                 ▼
               ┌─────────────┐    ┌─────────────┐
               │   Vlayer    │    │   Vlayer    │
               │   Web Proof │───▶│   ZK Proof  │
               │   Server    │    │   Server    │
               └─────────────┘    └──────┬──────┘
                                         │
                                         ▼
                                  ┌─────────────┐
                                  │  Base Chain │
                                  │  (On-chain) │
                                  └─────────────┘
```

## Tech Stack

| Component | Technology | Version |
|-----------|------------|---------|
| Framework | Next.js | 15.5.7 (React2Shell patched) |
| Runtime | React | 19.0.1 (CVE-2025-55182 patched) |
| Phone Gateway | Twilio Programmable Voice | - |
| Hosting | GCP Cloud Run | - |
| Verification | Vlayer (Web Proofs + ZK Proofs) | - |
| Blockchain | Base Sepolia | - |

## Project Structure

```
veriCall/
├── app/
│   ├── api/
│   │   ├── webhook/
│   │   │   ├── incoming/route.ts   # Twilio incoming call webhook
│   │   │   └── status/route.ts     # Call status updates
│   │   ├── calls/route.ts          # List call logs
│   │   ├── verify/[callId]/route.ts # Verify on-chain decision
│   │   └── health/route.ts         # Health check for Cloud Run
│   ├── layout.tsx
│   ├── page.tsx
│   └── globals.css
├── lib/
│   ├── config.ts          # Environment configuration
│   ├── types.ts           # TypeScript types
│   ├── twilio.ts          # Twilio client utilities
│   ├── vlayer.ts          # Vlayer Web/ZK proof integration
│   └── decision-logger.ts # Decision logging service
├── Dockerfile             # Cloud Run container
├── next.config.mjs
├── package.json
└── tsconfig.json
```

## Core Components

### 1. Twilio Phone Gateway
- **US Phone Number**: Purchased via Twilio as the company's public-facing number
- **Webhook Integration**: Incoming calls trigger VeriCall via Twilio webhooks
- **Call Control**: Programmable call forwarding, hold, and rejection

### 2. Decision Engine
- **Whitelist Check**: MVP uses simple phone number whitelist
- **Confidence Scoring**: Track decision confidence for audit
- **Future: AI Integration**: LLM-based caller verification

### 3. On-chain Verification (Vlayer)
- **Web Proofs**: Generate cryptographic proofs of decision data via TLSNotary
- **ZK Proofs**: Compress web proofs into succinct zero-knowledge proofs
- **On-chain Storage**: Store ZK proofs on Base chain for verification
- **Audit Trail**: Immutable record of all call handling decisions

## Data Flow

1. **Incoming Call** → Twilio receives call on US number
2. **Webhook Trigger** → Twilio POSTs to `/api/webhook/incoming`
3. **Decision Made** → Check whitelist, determine action
4. **TwiML Response** → Return call instructions to Twilio
5. **Async Proof Generation** → Generate Vlayer Web Proof
6. **ZK Compression** → Compress to ZK Proof via Vlayer ZK Prover
7. **On-chain Log** → Store proof on Base chain

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/webhook/incoming` | Twilio incoming call webhook |
| POST | `/api/webhook/status` | Call status updates |
| GET | `/api/calls` | List all call decision logs |
| GET | `/api/verify/[callId]` | Verify on-chain decision |
| GET | `/api/health` | Health check for Cloud Run |

## Decision Log Schema

```typescript
interface DecisionLog {
  callId: string;
  timestamp: string;
  callerNumber: string;
  callerIdentity: {
    known: boolean;
    type: 'customer' | 'colleague' | 'vendor' | 'unknown';
    confidence: number;
  };
  decision: {
    action: 'forward' | 'reject' | 'voicemail';
    reason: string;
    forwardTo?: string;
  };
  vlayerProof?: {
    webProofId?: string;
    zkProofHash?: string;
    txHash?: string;
    verified: boolean;
  };
}
```

## Getting Started

### Prerequisites

- Node.js 18.17+
- Twilio Account with US phone number
- Vlayer API key
- GCP account for Cloud Run

### Local Development

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env.local
# Edit .env.local with your credentials

# Run development server
npm run dev
```

### Deploy to Cloud Run

```bash
# Build and push container
gcloud builds submit --tag gcr.io/PROJECT_ID/vericall

# Deploy to Cloud Run
gcloud run deploy vericall \
  --image gcr.io/PROJECT_ID/vericall \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars "TWILIO_ACCOUNT_SID=xxx,TWILIO_AUTH_TOKEN=xxx,..."
```

### Configure Twilio Webhook

1. Go to Twilio Console → Phone Numbers
2. Select your phone number
3. Set Voice webhook URL to: `https://YOUR_CLOUD_RUN_URL/api/webhook/incoming`

## Environment Variables

```bash
# Twilio Configuration
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+1XXXXXXXXXX

# Call Forwarding
DESTINATION_PHONE_NUMBER=+1YYYYYYYYYY
FORWARD_TIMEOUT=30
WHITELIST_NUMBERS=+1111111111,+1222222222

# Vlayer Configuration
VLAYER_API_KEY=your_vlayer_api_key
VLAYER_WEB_PROVER_URL=https://web-prover.vlayer.xyz
VLAYER_ZK_PROVER_URL=https://zk-prover.vlayer.xyz

# Blockchain Configuration
ETHEREUM_RPC_URL=https://sepolia.base.org
CHAIN_ID=84532

# Server Configuration
NEXT_PUBLIC_BASE_URL=https://your-cloud-run-url.run.app
```

## MVP Milestones

### Phase 1: Basic Call Handling ✅
- [x] Set up Next.js 15.5.7 project
- [x] Implement Twilio webhook endpoints
- [x] Basic call forwarding logic
- [x] Cloud Run deployment configuration

### Phase 2: Vlayer Integration 🚧
- [x] Vlayer Web Proof integration
- [x] Vlayer ZK Proof compression
- [ ] On-chain proof submission
- [ ] Smart contract deployment

### Phase 3: AI Integration
- [ ] Integrate LLM for conversation
- [ ] Implement caller classification
- [ ] Voice-based verification

### Phase 4: Production Ready
- [ ] Security hardening
- [ ] Monitoring & alerting
- [ ] Admin dashboard

## Security Notes

- **React2Shell (CVE-2025-55182)**: Using patched versions (Next.js 15.5.7, React 19.0.1)
- **Twilio Signature Validation**: Enabled in production
- **Phone Number Privacy**: Caller numbers are hashed before on-chain storage
- **ZK Proofs**: Decision logic is verifiable without revealing raw data

## License

MIT


