# VeriCall Deployment Guide

## Environment Variables

```
┌─────────────────────────────────────────────────────────────┐
│  .env.example  ← all required variable names (no values)    │
└─────────────────────────────────────────────────────────────┘
                              │
            ┌─────────────────┴─────────────────┐
            ▼                                   ▼
    ┌──────────────────┐              ┌──────────────────────┐
    │  Local / Dev     │              │    Production        │
    ├──────────────────┤              ├──────────────────────┤
    │   .env.local     │              │  GitHub Secrets      │
    │   (manual)       │              │       ↓ deploy.yml   │
    │                  │              │  GCP Secret Manager  │
    │   DATABASE_URL   │              │       ↓ --set-secrets│
    │   (direct TCP)   │              │    Cloud Run         │
    │                  │              │       + Cloud SQL    │
    │                  │              │       (IAM auth)     │
    └──────────────────┘              └──────────────────────┘
```

## Local Development

```bash
pnpm install
cp .env.example .env.local    # fill in your credentials
pnpm dev                       # Next.js + WebSocket on localhost:3000
```

### Local Database

For local development, set `DATABASE_URL` in `.env.local` for direct PostgreSQL connection:

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/vericall
```

Production uses Cloud SQL with IAM auth (no passwords) — see §Cloud SQL below.

### Playground Scripts

```bash
npx tsx playground/vlayer/01-hello-vlayer.ts
npx tsx playground/twilio/test-call.ts
```

## Production Deploy

### 1. GCP Setup (first time only)

#### Artifact Registry

```bash
gcloud artifacts repositories create vericall \
  --repository-format=docker \
  --location=us-central1 \
  --project=ethglobal-479011
```

#### Workload Identity Federation (keyless auth for GitHub Actions)

Deploy uses **Workload Identity Federation** — no JSON service account key needed.
GitHub Actions authenticates via OIDC token exchange.

```bash
# 1. Create Workload Identity Pool
gcloud iam workload-identity-pools create "github" \
  --project="ethglobal-479011" \
  --location="global" \
  --display-name="GitHub Actions Pool"

# 2. Create OIDC Provider
gcloud iam workload-identity-pools providers create-oidc "github-provider" \
  --project="ethglobal-479011" \
  --location="global" \
  --workload-identity-pool="github" \
  --display-name="GitHub OIDC" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --issuer-uri="https://token.actions.githubusercontent.com"

# 3. Grant impersonation to the service account
gcloud iam service-accounts add-iam-policy-binding \
  "vericall-deploy@ethglobal-479011.iam.gserviceaccount.com" \
  --project="ethglobal-479011" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/rtree/veriCall"
```

#### Cloud SQL (PostgreSQL with IAM auth)

```bash
# 1. Create Cloud SQL instance
gcloud sql instances create vericall-db \
  --database-version=POSTGRES_16 \
  --tier=db-f1-micro \
  --region=us-central1 \
  --project=ethglobal-479011 \
  --database-flags=cloudsql.iam_authentication=on

# 2. Create database
gcloud sql databases create vericall \
  --instance=vericall-db \
  --project=ethglobal-479011

# 3. Create IAM database user (matches service account)
gcloud sql users create vericall-deploy@ethglobal-479011.iam \
  --instance=vericall-db \
  --type=cloud_iam_service_account \
  --project=ethglobal-479011

# 4. Grant Cloud SQL Client role to service account
gcloud projects add-iam-policy-binding ethglobal-479011 \
  --member="serviceAccount:vericall-deploy@ethglobal-479011.iam.gserviceaccount.com" \
  --role="roles/cloudsql.client"
```

Cloud Run connects via `--add-cloudsql-instances` flag (Unix socket). No passwords — IAM auth handles everything.

#### Secret Manager Access

```bash
gcloud projects add-iam-policy-binding ethglobal-479011 \
  --member="serviceAccount:vericall-deploy@ethglobal-479011.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### 2. GitHub Secrets

Repository → Settings → Secrets and variables → Actions

#### GCP Infrastructure Secrets

| Secret Name | Description | Example |
|-------------|-------------|---------|
| `GCP_PROJECT_ID` | GCP project ID | `ethglobal-479011` |
| `GCP_PROJECT_NUMBER` | GCP project number | `123456789` |
| `GCP_REGION` | Cloud Run region | `us-central1` |
| `GCP_SERVICE_NAME` | Cloud Run service name | `vericall-kkz6k4jema` |
| `GCP_REPOSITORY` | Artifact Registry repo name | `vericall` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Workload Identity Provider | `projects/NUM/locations/global/workloadIdentityPools/github/providers/github-provider` |
| `GCP_SERVICE_ACCOUNT` | Service account email | `vericall-deploy@ethglobal-479011.iam.gserviceaccount.com` |

#### Application Secrets (synced to GCP Secret Manager by deploy.yml)

| Secret Name | Description |
|-------------|-------------|
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
| `DEPLOYER_MNEMONIC` | Deployer wallet mnemonic (Base Sepolia) |
| `VERICALL_DEMO_TOKEN` | Token for /demo page access |

> **Note**: `NEXT_PUBLIC_BASE_URL` and `SOURCE_CODE_COMMIT` are set as plain env vars in deploy.yml (not secrets). `VERICALL_CONTRACT_ADDRESS` is synced from `contracts/deployment.json` (Single Source of Truth).

#### Setup Script

```bash
# Auto-sync .env.local → GitHub Secrets
./scripts/setup-github-secrets.sh
```

### 3. Deploy

```bash
git push origin master
# → GitHub Actions auto-deploys to Cloud Run
```

**What deploy.yml does**:
1. Authenticate via Workload Identity Federation (keyless)
2. Sync 15 GitHub Secrets → GCP Secret Manager
3. Sync contract address from `contracts/deployment.json` → GCP Secret Manager
4. Docker build with `--build-arg SOURCE_CODE_COMMIT=${{ github.sha }}` (**GitHub Code Attestation**)
5. Push to Artifact Registry
6. Deploy to Cloud Run with `--set-secrets` (16 secrets) and `--set-env-vars`

#### SOURCE_CODE_COMMIT (GitHub Code Attestation)

The git commit SHA is injected at Docker build time:

```
deploy.yml:   --build-arg SOURCE_CODE_COMMIT=${{ github.sha }}
    ↓
Dockerfile:   ARG SOURCE_CODE_COMMIT=unknown → ENV SOURCE_CODE_COMMIT
    ↓
Runtime:      process.env.SOURCE_CODE_COMMIT
    ↓
Decision API: { "sourceCodeCommit": "abc123...", "sourceCodeUrl": "https://github.com/..." }
    ↓
TLSNotary:    Attested → ZK Proof → On-chain (provenSourceCodeCommit)
    ↓
Anyone:       github.com/rtree/veriCall/tree/abc123 → read the code
```

This enables anyone to verify the exact server code that produced a decision. See DESIGN.md §3.10.

#### Cloud Run Configuration

| Setting | Value | Reason |
|---------|-------|--------|
| Memory | 2Gi | Gemini streaming + TTS/STT + proof pipeline |
| CPU | 2 | Concurrent AI conversations |
| Min instances | 1 | WebSocket requires warm instance |
| Max instances | 1 | Single-instance for hackathon |
| Session affinity | enabled | WebSocket sticky sessions |
| Timeout | 600s | Long-running proof pipeline |
| Execution environment | gen2 | Full Linux sandbox (WebSocket support) |
| CPU throttling | disabled | Background proof processing |
| Cloud SQL | `ethglobal-479011:us-central1:vericall-db` | Decision record persistence |

#### Cloud Run Environment Variables (set via `--set-env-vars`)

| Variable | Value | Description |
|----------|-------|-------------|
| `NODE_ENV` | `production` | Production mode |
| `CLOUD_SQL_CONNECTION_NAME` | `ethglobal-479011:us-central1:vericall-db` | Cloud SQL Unix socket path |
| `DB_NAME` | `vericall` | Database name |
| `DB_IAM_USER` | `vericall-deploy@ethglobal-479011.iam` | IAM-authenticated DB user |
| `NEXT_PUBLIC_BASE_URL` | `https://vericall-kkz6k4jema-uc.a.run.app` | Public URL |
| `SOURCE_CODE_COMMIT` | `${{ github.sha }}` | Git commit for code attestation |

### 4. Contract Deployment

Contract is deployed **manually** (not in CI/CD):

```bash
npx tsx scripts/deploy-v2.ts   # deploys V4 + MockVerifier, updates deployment.json
```

`deploy-v2.ts` automatically:
1. Deploys `RiscZeroMockVerifier` + `VeriCallRegistryV4`
2. Writes `contracts/deployment.json` (Single Source of Truth)
3. Updates `.env.local` with new contract address
4. Syncs to GCP Secret Manager

Commit `deployment.json` after deploy → next `git push` picks up the new address.

### 5. Twilio Webhook

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
| Monitoring | `https://vericall-kkz6k4jema-uc.a.run.app/monitoring` |
| Health Check | `https://vericall-kkz6k4jema-uc.a.run.app/api/health` |
| Explorer API | `https://vericall-kkz6k4jema-uc.a.run.app/api/explorer` |
| Contract V4 (Base Sepolia) | [`0x9a6015c6a0f13a816174995137e8a57a71250b81`](https://sepolia.basescan.org/address/0x9a6015c6a0f13a816174995137e8a57a71250b81) |
| MockVerifier (Base Sepolia) | [`0xea998b642b469736a3f656328853203da3d92724`](https://sepolia.basescan.org/address/0xea998b642b469736a3f656328853203da3d92724) |

## Monitoring Commands

```bash
# Service status
gcloud run services list --project=ethglobal-479011

# Logs (recent)
gcloud run services logs read vericall-kkz6k4jema \
  --region=us-central1 \
  --project=ethglobal-479011 \
  --limit=100

# Logs (stream)
gcloud run services logs tail vericall-kkz6k4jema \
  --region=us-central1 \
  --project=ethglobal-479011

# Secrets
gcloud secrets list --project=ethglobal-479011

# Cloud SQL
gcloud sql instances describe vericall-db --project=ethglobal-479011

# Cloud SQL connect (for debugging)
gcloud sql connect vericall-db --database=vericall --project=ethglobal-479011
```
