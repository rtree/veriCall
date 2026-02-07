# VeriCall Deployment Guide

## Environment Variables

```
┌─────────────────────────────────────────────────────────────┐
│  .env.example  ← all required variable names (no values)    │
└─────────────────────────────────────────────────────────────┘
                              │
            ┌─────────────────┴─────────────────┐
            ▼                                   ▼
    ┌──────────────────┐              ┌──────────────────┐
    │  Local / Dev     │              │    Production    │
    ├──────────────────┤              ├──────────────────┤
    │   .env.local     │              │  GitHub Secrets  │
    │   (manual)       │              │       ↓          │
    │                  │              │  GCP Secret Mgr  │
    │                  │              │       ↓          │
    │                  │              │    Cloud Run     │
    └──────────────────┘              └──────────────────┘
```

## Local Development

```bash
pnpm install
cp .env.example .env.local    # fill in your credentials
pnpm dev                       # Next.js + WebSocket on localhost:3000
```

Playground scripts (vlayer / Twilio experiments):

```bash
npx tsx docs/playground/vlayer/01-hello-vlayer.ts
npx tsx docs/playground/twilio/test-call.ts
```

## Production Deploy

### 1. GCP Setup (first time only)

```bash
# Artifact Registry
gcloud artifacts repositories create vericall \
  --repository-format=docker \
  --location=us-central1 \
  --project=ethglobal-479011

# Grant Secret Manager access to Cloud Run service account
gcloud projects add-iam-policy-binding ethglobal-479011 \
  --member="serviceAccount:SA@ethglobal-479011.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### 2. GitHub Secrets

Repository → Settings → Secrets and variables → Actions

| Secret Name | Description |
|-------------|-------------|
| `GCP_SA_KEY` | GCP service account JSON key |
| `TWILIO_ACCOUNT_SID` | Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | Twilio Auth Token |
| `TWILIO_PHONE_NUMBER` | Twilio phone number (+1...) |
| `DESTINATION_PHONE_NUMBER` | Call forwarding target |
| `FORWARD_TIMEOUT` | Forward timeout seconds (e.g. 30) |
| `WHITELIST_NUMBERS` | Allowed numbers (comma-separated) |
| `VLAYER_CLIENT_ID` | vlayer Client ID |
| `VLAYER_API_KEY` | vlayer API Key |
| `VLAYER_WEB_PROVER_URL` | `https://web-prover.vlayer.xyz` |
| `VLAYER_ZK_PROVER_URL` | `https://zk-prover.vlayer.xyz` |
| `SENDGRID_API_KEY` | SendGrid API key |
| `NOTIFICATION_EMAIL` | Email notification recipient |
| `FROM_EMAIL` | Sender address for notifications |
| `NEXT_PUBLIC_BASE_URL` | Cloud Run URL |

### 3. Deploy

```bash
git push origin master
# → GitHub Actions auto-deploys to Cloud Run
```

### 4. Twilio Webhook

1. Twilio Console → Phone Numbers → select number
2. Voice Configuration:
   - Webhook URL: `https://vericall-kkz6k4jema-uc.a.run.app/phone/incoming`
   - HTTP Method: POST

## Service URLs

| Service | URL |
|---------|-----|
| Cloud Run | `https://vericall-kkz6k4jema-uc.a.run.app` |
| Live Demo | `https://vericall-kkz6k4jema-uc.a.run.app/demo` |
| Verification | `https://vericall-kkz6k4jema-uc.a.run.app/verify` |
| Contract (Base Sepolia) | `0x4395cf02b8d343aae958bda7ac6ed71fbd4abd48` |

## Monitoring Commands

```bash
# Service status
gcloud run services list --project=ethglobal-479011

# Logs
gcloud run services logs read vericall-kkz6k4jema \
  --region=us-central1 \
  --project=ethglobal-479011

# Secrets
gcloud secrets list --project=ethglobal-479011
```
