# VeriCall Deployment Guide

## 環境変数の管理

```
┌─────────────────────────────────────────────────────────────┐
│  .env.example  ← 必要な変数の定義（値なし、コミット可）     │
└─────────────────────────────────────────────────────────────┘
                              │
            ┌─────────────────┴─────────────────┐
            ▼                                   ▼
    ┌──────────────────┐              ┌──────────────────┐
    │ Local/Playground │              │    Production    │
    ├──────────────────┤              ├──────────────────┤
    │   .env.local     │              │  GitHub Secrets  │
    │   (手動作成)     │              │       ↓          │
    │                  │              │  GCP Secret Mgr  │
    │                  │              │       ↓          │
    │                  │              │    Cloud Run     │
    └──────────────────┘              └──────────────────┘
```

## ローカル / Playground

```bash
# 1. .env.local を作成
cp .env.example .env.local

# 2. 値を設定
vim .env.local

# 3. 起動
npm run dev

# 4. Playground
npx ts-node playground/vlayer/01-hello-vlayer.ts
```

## 本番デプロイ

### 1. GCP 準備

```bash
# Artifact Registry を作成（初回のみ）
gcloud artifacts repositories create vericall \
  --repository-format=docker \
  --location=us-central1 \
  --project=ethglobal-479011

# Cloud Run 用サービスアカウントに Secret Manager アクセス権を付与
gcloud projects add-iam-policy-binding ethglobal-479011 \
  --member="serviceAccount:YOUR_SERVICE_ACCOUNT@ethglobal-479011.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### 2. GitHub Secrets 設定

GitHub リポジトリ → Settings → Secrets and variables → Actions

| Secret Name | 説明 |
|-------------|------|
| `GCP_SA_KEY` | GCPサービスアカウントのJSON鍵 |
| `TWILIO_ACCOUNT_SID` | Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | Twilio Auth Token |
| `TWILIO_PHONE_NUMBER` | Twilio電話番号 (+1...) |
| `DESTINATION_PHONE_NUMBER` | 転送先番号 |
| `FORWARD_TIMEOUT` | 転送タイムアウト秒 (例: 30) |
| `WHITELIST_NUMBERS` | 許可番号リスト (カンマ区切り) |
| `VLAYER_API_KEY` | Vlayer API Key |
| `VLAYER_WEB_PROVER_URL` | Web Prover URL |
| `VLAYER_ZK_PROVER_URL` | ZK Prover URL |
| `NEXT_PUBLIC_BASE_URL` | Cloud Run URL |

### 3. デプロイ

```bash
git push origin main
# → GitHub Actions が自動でデプロイ
```

### 4. Twilio Webhook 設定

1. Twilio Console → Phone Numbers
2. 電話番号を選択
3. Voice Configuration:
   - Webhook URL: `https://vericall-ded916a01840-xxxxx.run.app/phone/incoming`
   - HTTP Method: POST

## サービス名について

総当たり攻撃対策のため、URLにランダム文字列を含めています:

- Service: `vericall-ded916a01840`
- Secret: `vericall-env-caa4031fec2f`

## 確認コマンド

```bash
# デプロイ状況
gcloud run services list --project=ethglobal-479011

# ログ確認
gcloud run services logs read vericall-ded916a01840 \
  --region=us-central1 \
  --project=ethglobal-479011

# Secret 確認
gcloud secrets list --project=ethglobal-479011
```
