
# VeriCall

A phone AI receptionist that filters calls and forwards legitimate ones, with verifiable on-chain decision logs.

## Architecture

```
📞 Incoming Call (Twilio US Number)
       ↓
   /phone/incoming
       ↓
   [Router: decide()]
       ↓
   onDecisionMade() ──→ [Witness: createWitness()]
       ↓                        ↓
   TwiML Response          Web Proof (Vlayer)
       ↓                        ↓
   Call Forwarded          ZK Proof
                                ↓
                           On-chain ✓ (Base)
```

## Project Structure

```
veriCall/
├── app/
│   ├── phone/                 # 📞 電話一式（完結）
│   │   ├── incoming/route.ts  # Twilio着信Webhook
│   │   ├── status/route.ts    # ステータス更新
│   │   ├── logs/route.ts      # 通話ログAPI
│   │   └── _lib/
│   │       ├── twilio.ts      # Twilioクライアント
│   │       ├── router.ts      # ルーティング判断
│   │       ├── twiml-builder.ts
│   │       ├── events.ts      # onIncoming, onDecisionMade
│   │       ├── store.ts       # 通話ログ保存
│   │       └── types.ts
│   │
│   ├── witness/               # ⛓️ Vlayer連携
│   │   ├── list/route.ts      # 証明一覧API
│   │   ├── verify/[id]/route.ts
│   │   └── _lib/
│   │       ├── vlayer-client.ts
│   │       ├── store.ts
│   │       └── types.ts
│   │
│   ├── monitoring/            # 📊 デモ用UI
│   │   └── page.tsx
│   │
│   ├── api/health/route.ts    # ヘルスチェック
│   ├── layout.tsx
│   ├── page.tsx
│   └── globals.css
│
├── playground/                # 🧪 実験用（本番外）
│   ├── vlayer/
│   │   ├── 01-hello-vlayer.ts
│   │   └── 02-web-proof.ts
│   ├── twilio/
│   │   └── test-call.ts
│   └── README.md
│
├── lib/                       # 共通設定
│   └── config.ts
│
├── Dockerfile                 # Cloud Run用
└── ...
```

## Tech Stack

| Component | Technology |
|-----------|------------|
| Framework | Next.js 15.5.7 (React2Shell patched) |
| Runtime | React 19.0.1 (CVE-2025-55182 patched) |
| Phone | Twilio Programmable Voice |
| Verification | Vlayer (Web Proofs + ZK Proofs) |
| Chain | Base Sepolia |
| Hosting | GCP Cloud Run |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/phone/incoming` | Twilio着信Webhook |
| POST | `/phone/status` | 通話ステータス更新 |
| GET | `/phone/logs` | 通話ログ一覧 |
| GET | `/witness/list` | 証明記録一覧 |
| GET | `/witness/verify/[id]` | 証明検証 |
| GET | `/api/health` | ヘルスチェック |

## Getting Started

```bash
# Install
npm install

# Setup env
cp .env.example .env.local

# Dev
npm run dev

# Playground (Vlayer実験)
npm run play:vlayer
```

## Environment Variables

```bash
# Twilio
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=+1XXXXXXXXXX
DESTINATION_PHONE_NUMBER=+1YYYYYYYYYY

# Vlayer
VLAYER_API_KEY=
VLAYER_WEB_PROVER_URL=https://web-prover.vlayer.xyz
VLAYER_ZK_PROVER_URL=https://zk-prover.vlayer.xyz

# Server
NEXT_PUBLIC_BASE_URL=https://your-cloud-run-url.run.app
```

## Deploy to Cloud Run

```bash
gcloud builds submit --tag gcr.io/PROJECT/vericall
gcloud run deploy vericall --image gcr.io/PROJECT/vericall --region us-central1
```

## License

MIT


