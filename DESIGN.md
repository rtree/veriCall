# VeriCall — System Design Document

> AI 電話受付の判定結果を、ZK 証明でオンチェーンに記録するシステム

---

## 1. 全体概要

### 1.1 VeriCall とは何か

VeriCall は **AI 電話受付** と **ブロックチェーン証明** を組み合わせたシステムである。

1. 電話がかかってくると、AI が発信者と会話してスクリーニングする
2. AI が「営業/スパム（BLOCK）」か「正当な用件（RECORD）」かを判定する
3. その **判定結果を vlayer の TLSNotary + ZK 証明** で改ざん不可能にする
4. 証明付きの判定結果を **Base Sepolia（EVM チェーン）** に記録する

これにより、「AI が本当にこの判定を下した」ことを誰でも検証できる。

### 1.2 全体フロー（End-to-End）

```
┌──────────┐    ┌──────────┐    ┌──────────────────────────────────────┐
│  Caller  │───→│  Twilio  │───→│  VeriCall (Cloud Run)                │
│ (Phone)  │    │  (PSTN)  │    │                                      │
└──────────┘    └──────────┘    │  ┌──────────┐    ┌──────────────┐   │
                                │  │ Incoming  │───→│ AI Screening  │   │
                                │  │ Webhook   │    │ (Gemini+STT   │   │
                                │  └──────────┘    │  +TTS+WS)     │   │
                                │                   └──────┬───────┘   │
                                │                          │           │
                                │                   ┌──────▼───────┐   │
                                │                   │  Decision     │   │
                                │                   │  (BLOCK or    │   │
                                │                   │   RECORD)     │   │
                                │                   └──────┬───────┘   │
                                │                          │           │
                                │          ┌───────────────┼──────┐    │
                                │          │               │      │    │
                                │          ▼               ▼      ▼    │
                                │  ┌──────────┐  ┌──────┐  ┌──────┐   │
                                │  │ Email    │  │Cloud │  │Witness│   │
                                │  │ Notify   │  │ SQL  │  │Pipeln│   │
                                │  └──────────┘  └──┬───┘  └──┬───┘   │
                                │                   │         │        │
                                └───────────────────┼─────────┼────────┘
                                                    │         │
                                    ┌───────────────▼─┐  ┌────▼──────────┐
                                    │ Decision API    │  │ vlayer        │
                                    │ /api/witness/   │  │ Web Prover    │
                                    │ decision/[sid]  │  │ (TLSNotary)   │
                                    └────────┬────────┘  └────┬──────────┘
                                             │                │
                                             │    ┌───────────▼──────────┐
                                             │    │ vlayer ZK Prover     │
                                             │    │ (RISC Zero→Groth16) │
                                             │    └───────────┬──────────┘
                                             │                │
                                             │    ┌───────────▼──────────┐
                                             └───→│ Base Sepolia         │
                                                  │ VeriCallRegistry     │
                                                  │ (on-chain record)    │
                                                  └──────────────────────┘
```

### 1.3 なぜこの構成なのか

| 問い | 答え |
|------|------|
| なぜ AI 電話受付？ | 営業・スパム電話を自動でブロックし、正当な電話だけ転送/記録するため |
| なぜ ZK 証明？ | AI の判定結果が事後改ざんされていないことを第三者が検証できるようにするため |
| なぜ TLSNotary？ | VeriCall サーバーが返した JSON を「このサーバーが確かにこの内容を返した」と暗号的に証明するため |
| なぜオンチェーン？ | 証明データを永続的・改ざん不可能な場所に保存し、誰でも閲覧・検証可能にするため |

---

## 2. 個別パート詳細

### 2.1 電話着信 → AI スクリーニング

#### 着信ルーティング

```
Twilio (PSTN) ──POST──→ /phone/incoming (Webhook)
                              │
                              ├─ ホワイトリスト番号 → 即転送 (TwiML <Dial>)
                              │
                              └─ 未知番号 → AI スクリーニング
                                   │
                                   └─ TwiML <Connect><Stream> で WebSocket 接続
```

**ファイル**: [app/phone/incoming/route.ts](app/phone/incoming/route.ts)
- Twilio が着信時に POST する Webhook エンドポイント
- `router.ts` で判断: ホワイトリスト → 即転送 / それ以外 → AI

**ファイル**: [app/phone/_lib/twiml-builder.ts](app/phone/_lib/twiml-builder.ts)
- AI スクリーニングの場合、`<Connect><Stream>` TwiML を返す
- Twilio が `wss://{host}/stream` に WebSocket 接続を開始

#### WebSocket ストリーミング

```
Twilio Media Stream ──WS──→ server.ts (/stream)
                                  │
                                  └─ VoiceAISession 作成
                                       │
                                       ├─ μ-law audio → Linear16 変換
                                       ├─ Google STT (リアルタイム音声認識)
                                       ├─ Gemini AI (会話 + 判定)
                                       ├─ Google TTS (音声合成)
                                       └─ μ-law audio → Twilio へ送信
```

**ファイル**: [server.ts](server.ts)
- Next.js + WebSocket サーバー（カスタムサーバー）
- `/stream` パスで `ws.upgrade` を処理
- `VoiceAISession` を callSid ごとに生成・管理

**ファイル**: [lib/voice-ai/session.ts](lib/voice-ai/session.ts) — **中核ファイル**
- 1通話 = 1セッション。以下を管理:
  - **STT**: Google Cloud Speech-to-Text（リアルタイムストリーミング）
  - **Gemini**: `@google/genai` SDK で会話 + 判定
  - **TTS**: Google Cloud Text-to-Speech → μ-law 8kHz
  - **Barge-in**: 発話者が AI の発話を遮った時の割り込み処理
  - **Utterance buffering**: 短い発話を 1.5 秒バッファして結合

#### AI 判定ロジック（Gemini）

**ファイル**: [lib/voice-ai/gemini.ts](lib/voice-ai/gemini.ts)

System Prompt のインテントベース分類:

| 判定 | 意味 | シグナル例 |
|------|------|-----------|
| `BLOCK` | 営業・スパム | 「提案がある」「コスト削減できる」「リストで見つけた」 |
| `RECORD` | 正当な用件 | 「折り返し電話」「〇〇さんいますか？」「見積り送った」 |

- 3ターン以上の会話後、確信度が高まった時点で判定
- JSON 形式で `{ decision: "BLOCK" | "RECORD", response: "..." }` を返す
- 判定後、最後の応答を話し終えてから通話終了

### 2.2 判定後の処理（3 並行タスク）

AI が `BLOCK` or `RECORD` を決定すると、`handleDecision()` が 3 つの処理を起動:

```
handleDecision()
    │
    ├─ 1. Email 通知 (SendGrid)
    │     └─ 判定結果 + 要約 + 会話履歴をメール送信
    │
    ├─ 2. Cloud SQL 保存 (storeDecisionForProof)
    │     └─ vlayer Web Proof 用にデータを永続化
    │
    └─ 3. Witness Pipeline (createWitness) ← fire-and-forget
          └─ Web Proof → ZK Proof → On-chain (詳細は 2.3)
```

### 2.3 Witness Pipeline（証明の生成とオンチェーン記録）

これが VeriCall の核心部分。**「AI がこの判定を下した」ことの暗号的証明** を生成する。

#### ステップ 1: Cloud SQL に判定を保存

```
session.ts handleDecision()
    │
    └─ storeDecisionForProof()
         └─ INSERT INTO decision_records (call_sid, decision, reason, transcript, ...)
```

**ファイル**: [lib/witness/decision-store.ts](lib/witness/decision-store.ts)
- `decision_records` テーブルに UPSERT
- 1 時間の TTL（`expires_at`）付き — 証明生成に必要な期間だけ保持
- `systemPromptHash`: Gemini の System Prompt の SHA-256 ハッシュも保存

#### ステップ 2: Decision API がデータを提供

```
vlayer Web Prover ──GET──→ /api/witness/decision/{callSid}
                                  │
                                  └─ Cloud SQL から読み出し → JSON 返却
```

**ファイル**: [app/api/witness/decision/[callSid]/route.ts](app/api/witness/decision/%5BcallSid%5D/route.ts)

返却 JSON:
```json
{
  "service": "VeriCall",
  "version": "1.0",
  "callSid": "CA...",
  "decision": "BLOCK",
  "reason": "Caller was selling SEO services...",
  "transcript": "AI: Hello... Caller: Hi, I have a proposal...",
  "systemPromptHash": "a3f2...",
  "callerHashShort": "8b2c...",
  "timestamp": "2026-02-07T...",
  "conversationTurns": 4
}
```

**なぜ Cloud SQL が必要か**: vlayer Web Prover は外部 HTTP GET でこの URL にアクセスする。
Cloud Run のインスタンスメモリは永続化されないため、判定データを DB に保存する必要がある。

#### ステップ 3: vlayer Web Proof（TLSNotary）

```
pipeline.ts
    │
    └─ vlayerWebProof(proofUrl)
         │
         └─ POST https://web-prover.vlayer.xyz/api/v1/prove
              body: { url: "https://vericall-.../api/witness/decision/{sid}" }
              │
              └─ vlayer が TLSNotary MPC プロトコルで:
                   1. VeriCall サーバーに TLS 接続
                   2. MPC で TLS セッションを共同実行
                   3. 「このサーバーが、この JSON を返した」を証明
                   4. WebProof オブジェクトを返却
```

**ファイル**: [lib/witness/vlayer-api.ts](lib/witness/vlayer-api.ts)
- `generateWebProof()`: vlayer Web Prover REST API を呼び出し
- 認証: `x-client-id` + `Authorization: Bearer {apiKey}`

**TLSNotary とは**: TLS 通信を MPC（マルチパーティ計算）で分割実行し、
サーバーの応答内容を第三者が検証可能な形で証明する技術。
vlayer はこれを SaaS として提供している。

#### ステップ 4: vlayer ZK Proof（RISC Zero → Groth16）

```
pipeline.ts
    │
    └─ vlayerZKProof(webProof, ["decision", "reason"])
         │
         └─ POST https://zk-prover.vlayer.xyz/api/v0/compress-web-proof
              body: {
                presentation: webProof,
                extraction: { "response.body": { jmespath: ["decision", "reason"] } }
              }
              │
              └─ vlayer が:
                   1. WebProof を RISC Zero zkVM で検証
                   2. JMESPath で指定フィールド (decision, reason) を抽出
                   3. Groth16 BN254 に圧縮（EVM 検証可能）
                   4. { zkProof (seal), journalDataAbi } を返却
```

**JMESPath `["decision", "reason"]`**: JSON レスポンスから抽出するフィールド。
ZK Proof の public output（journal）にこれらの値がエンコードされる。

#### ステップ 5: Base Sepolia オンチェーン記録

```
pipeline.ts
    │
    └─ submitDecisionOnChain({
         callSid, callerPhone, decision, reason,
         zkProofSeal, journalDataAbi, sourceUrl
       })
         │
         └─ VeriCallRegistry.registerCallDecision(
              callId,        // keccak256(callSid + timestamp)
              callerHash,    // keccak256(phoneNumber) — プライバシー保護
              decision,      // 1=ACCEPT, 2=BLOCK, 3=RECORD
              reason,        // AI の判定理由（200 文字以内）
              zkProofSeal,   // Groth16 seal
              journalDataAbi,// ABI エンコードされた public outputs
              sourceUrl      // 証明対象の URL
            )
```

**ファイル**: [lib/witness/on-chain.ts](lib/witness/on-chain.ts)
- `viem` で Base Sepolia に TX 送信
- ウォレット: `DEPLOYER_MNEMONIC` から導出

**ファイル**: [contracts/VeriCallRegistry.sol](contracts/VeriCallRegistry.sol)
- `registerCallDecision()`: レコード登録 + `journalHash` コミットメント保存
- `verifyJournal()`: `keccak256(journalDataAbi) == journalHash` を検証
- `getRecord()` / `getStats()` / `callIds[]`: 読み取り関数

### 2.4 証明の検証方法

オンチェーンに記録された証明が正しく動いていることを、以下の手段で確認できる:

#### CLI インスペクター

```bash
npx tsx scripts/check-registry.ts        # 人間向け表示
npx tsx scripts/check-registry.ts --json  # JSON 出力
```

**ファイル**: [scripts/check-registry.ts](scripts/check-registry.ts)
- オンチェーンの全レコードを読み取り・デコード
- ZK Journal のバイナリデータからメソッド・URL・抽出値をデコード
- `verifyJournal()` でジャーナルハッシュの整合性を検証

表示内容:
```
━━━ Record #2 ━━━━━━━━━━━━━━━━━━━━
  Call ID:     0x8a3f2b...
  Decision:    🚫 BLOCK
  Reason:      Caller was selling SEO services...
  Time:        2026-02-07T10:30:00Z

  📡 Proven Data (from ZK Journal):
  Source:      https://vericall-.../api/witness/decision/CA...
  Method:      GET
  Values:
    📄 BLOCK
    📄 Caller was selling SEO services...

  🔐 ZK Proof:
  Seal:        0x1a2b3c4d5e6f...
  Integrity:   ✅ Journal hash matches on-chain commitment
```

#### Explorer API

```
GET /api/explorer
```

**ファイル**: [app/api/explorer/route.ts](app/api/explorer/route.ts)
- ブラウザからオンチェーンデータを JSON で閲覧可能
- 将来の Web ダッシュボード用 API

#### BaseScan

```
https://sepolia.basescan.org/address/0xe454ca755219310b2728d39db8039cbaa7abc3b8
```

コントラクトの Read Contract から直接 `getRecord()`, `getStats()` を呼び出せる。

---

## 3. インフラ・認証・コンポーネント構成

### 3.1 アプリケーションコンポーネント

```
veriCall/
├── server.ts                           # カスタムサーバー (Next.js + WebSocket)
├── app/
│   ├── phone/
│   │   ├── incoming/route.ts           # Twilio Webhook (着信)
│   │   ├── status/route.ts             # Twilio Status Callback
│   │   ├── logs/route.ts               # 通話ログ API
│   │   └── _lib/
│   │       ├── router.ts               # ルーティングロジック (ホワイトリスト/AI)
│   │       ├── twiml-builder.ts        # TwiML XML 生成
│   │       ├── twilio.ts               # Twilio SDK ラッパー
│   │       └── email.ts                # メール通知
│   ├── api/
│   │   ├── health/route.ts             # ヘルスチェック
│   │   ├── explorer/route.ts           # オンチェーンデータ Explorer API
│   │   └── witness/
│   │       └── decision/[callSid]/     # 判定 API (vlayer Web Proof 対象)
│   │           └── route.ts
│   └── witness/                        # Witness 関連ページ (将来)
│       ├── list/
│       └── verify/
├── lib/
│   ├── config.ts                       # 共通設定
│   ├── db.ts                           # Cloud SQL クライアント (IAM 認証)
│   ├── voice-ai/
│   │   ├── session.ts                  # 通話セッション管理 (★ 中核)
│   │   ├── gemini.ts                   # Gemini AI (スクリーニング判定)
│   │   ├── speech-to-text.ts           # Google Cloud STT
│   │   ├── text-to-speech.ts           # Google Cloud TTS
│   │   ├── audio-utils.ts             # μ-law ↔ Linear16 変換
│   │   └── email-notify.ts            # SendGrid メール通知
│   └── witness/
│       ├── pipeline.ts                 # Witness パイプライン (★ 証明生成)
│       ├── vlayer-api.ts               # vlayer REST API クライアント
│       ├── on-chain.ts                 # Base Sepolia TX 送信
│       ├── decision-store.ts           # Cloud SQL 判定データストア
│       └── abi.ts                      # VeriCallRegistry ABI
├── contracts/
│   └── VeriCallRegistry.sol            # Solidity コントラクト
├── scripts/
│   └── check-registry.ts              # CLI レジストリインスペクター
└── .github/workflows/
    └── deploy.yml                      # GitHub Actions CI/CD
```

### 3.2 インフラ構成

```
┌─────────────────────────────────────────────────────────┐
│  Google Cloud Platform (ethglobal-479011)                │
│  Region: us-central1                                    │
│                                                          │
│  ┌──────────────────────┐   ┌─────────────────────────┐ │
│  │  Cloud Run            │   │  Cloud SQL               │ │
│  │  (vericall)           │──→│  (vericall-db)           │ │
│  │                       │   │                           │ │
│  │  - Next.js + WS       │   │  - PostgreSQL 15          │ │
│  │  - 512Mi / 1 CPU      │   │  - db-f1-micro           │ │
│  │  - min=1, max=10      │   │  - IAM 認証              │ │
│  │  - session-affinity   │   │  - SSL 必須              │ │
│  │  - timeout=600s       │   │  - Public IP + Connector │ │
│  └──────────┬───────────┘   └─────────────────────────┘ │
│             │                                            │
│  ┌──────────▼───────────┐   ┌─────────────────────────┐ │
│  │  Secret Manager       │   │  Artifact Registry      │ │
│  │  (15+ secrets)        │   │  (Docker images)        │ │
│  └──────────────────────┘   └─────────────────────────┘ │
└─────────────────────────────────────────────────────────┘

┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐
│  Twilio           │  │  vlayer          │  │  Base Sepolia │
│  (PSTN Gateway)   │  │  (ZK SaaS)      │  │  (L2 Chain)   │
│                    │  │                  │  │               │
│  - Phone number   │  │  - Web Prover   │  │  - Contract   │
│  - Media Stream   │  │  - ZK Prover    │  │    0xe454...  │
│  - WebSocket      │  │  - TLSNotary    │  │  - Groth16    │
└──────────────────┘  └──────────────────┘  └──────────────┘
```

### 3.3 認証・セキュリティ構成

#### サービスアカウント

```
vericall-deploy@ethglobal-479011.iam.gserviceaccount.com
  │
  ├─ roles/editor                     # GCP 全般
  ├─ roles/cloudsql.client            # Cloud SQL 接続
  ├─ roles/cloudsql.instanceUser      # IAM DB 認証
  ├─ roles/secretmanager.admin        # Secret Manager 管理
  ├─ roles/secretmanager.secretAccessor # Secret 読み取り
  ├─ roles/artifactregistry.writer    # Docker push
  ├─ roles/run.admin                  # Cloud Run デプロイ
  └─ roles/iam.serviceAccountUser     # SA 権限借用
```

#### 認証フロー

| 接続 | 認証方式 | 詳細 |
|------|---------|------|
| GitHub Actions → GCP | Workload Identity Federation | OIDC トークン交換、パスワードなし |
| Cloud Run → Cloud SQL | IAM DB 認証 | `@google-cloud/cloud-sql-connector` + ADC |
| Cloud Run → Secret Manager | IAM (自動) | SA に `secretAccessor` ロール |
| Cloud Run → Gemini/STT/TTS | ADC (自動) | SA の GCP 認証情報 |
| Pipeline → vlayer | API Key + Client ID | `VLAYER_API_KEY`, `VLAYER_CLIENT_ID` |
| Pipeline → Base Sepolia | Mnemonic → 秘密鍵 | `DEPLOYER_MNEMONIC` から導出 |
| Twilio → VeriCall | URL ベース | Twilio Webhook URL |

#### Cloud SQL セキュリティ

```
Cloud SQL (vericall-db)
  │
  ├─ IAM 認証 ON (cloudsql.iam_authentication=on)
  │   └─ IAM DB ユーザー: vericall-deploy@ethglobal-479011.iam
  │       └─ パスワード不要 — ADC トークンで認証
  │
  ├─ SSL 必須 (--require-ssl)
  │   └─ 非 SSL 接続は全拒否
  │
  └─ postgres 管理者パスワード
      └─ ランダム値、Secret Manager に保存 (CLOUDSQL_POSTGRES_ADMIN_PASSWORD)
```

### 3.4 CI/CD パイプライン

```
git push origin master
    │
    └─ GitHub Actions (.github/workflows/deploy.yml)
         │
         ├─ 1. Checkout
         ├─ 2. GCP Auth (Workload Identity Federation)
         ├─ 3. Sync Secrets → Secret Manager
         ├─ 4. Docker Build (Buildx, layer cache)
         ├─ 5. Push to Artifact Registry
         └─ 6. gcloud run deploy
              │
              ├─ --service-account vericall-deploy@...
              ├─ --add-cloudsql-instances ethglobal-479011:us-central1:vericall-db
              ├─ --set-env-vars NODE_ENV, DB 設定, BASE_URL
              └─ --set-secrets 15 個のシークレット
```

### 3.5 データフロー全体図

```
            ①                ②               ③              ④
  Phone Call ───→ AI Screening ───→ Decision ───→ Cloud SQL ───→ Decision API
                  (Gemini)         (BLOCK/       (PostgreSQL)    /api/witness/
                                    RECORD)                     decision/{sid}
                                                                     │
            ⑧                ⑦               ⑥              ⑤     │
  On-chain  ←─── TX Submit  ←─── ZK Proof  ←─── Web Proof ←────────┘
  Record          (viem)         (Groth16)       (TLSNotary)
  (Base Sepolia)                 (vlayer)        (vlayer)
                                                                     │
            ⑨                                                        │
  Verify    ←───────────────────────────────────────────────────────┘
  (CLI / Explorer / BaseScan)
```

| Step | 処理 | 所要時間 (目安) |
|------|------|----------------|
| ① | 電話着信 → WebSocket 接続 | ~1s |
| ② | AI スクリーニング会話 | 15-60s |
| ③ | 判定 → Cloud SQL 保存 | ~100ms |
| ④ | Decision API 応答 | ~50ms |
| ⑤ | vlayer Web Proof (TLSNotary) | 10-30s |
| ⑥ | vlayer ZK Proof (RISC Zero→Groth16) | 30-120s |
| ⑦ | Base Sepolia TX 送信 + 確認 | 2-5s |
| ⑧ | オンチェーン記録完了 | - |
| ⑨ | CLI / Explorer で検証 | ~2s |

**合計**: 通話終了から ⑧ 完了まで約 1-3 分（⑤-⑦ はバックグラウンド実行、通話をブロックしない）

### 3.6 外部サービス依存

| サービス | 用途 | 認証方式 |
|---------|------|---------|
| Twilio | 電話 PSTN ゲートウェイ + Media Stream | Account SID + Auth Token |
| Google Gemini | AI 会話 + スクリーニング判定 | ADC (Google Cloud) |
| Google Cloud STT | リアルタイム音声認識 | ADC |
| Google Cloud TTS | 音声合成 (μ-law 8kHz) | ADC |
| vlayer Web Prover | TLSNotary ベースの Web Proof 生成 | API Key + Client ID |
| vlayer ZK Prover | RISC Zero → Groth16 BN254 圧縮 | API Key + Client ID |
| SendGrid | メール通知 | API Key |
| Base Sepolia RPC | EVM トランザクション送信 | Public RPC |

### 3.7 コントラクト設計

**VeriCallRegistry** (`0xe454ca755219310b2728d39db8039cbaa7abc3b8`)

```solidity
struct CallRecord {
    bytes32 callerHash;      // keccak256(phoneNumber)
    Decision decision;       // ACCEPT / BLOCK / RECORD
    string reason;           // AI の判定理由
    bytes32 journalHash;     // keccak256(journalDataAbi) — コミットメント
    bytes zkProofSeal;       // Groth16 seal
    bytes journalDataAbi;    // ABI エンコードされた public outputs
    string sourceUrl;        // 証明対象 URL
    uint256 timestamp;       // 登録時刻
    address submitter;       // 送信者アドレス
}
```

**検証可能性**:
- `journalHash == keccak256(journalDataAbi)` → ジャーナル整合性
- `journalDataAbi` をデコードすると `decision`, `reason` の値が得られる
- `sourceUrl` がどの API エンドポイントを証明したかを示す
- `zkProofSeal` が Groth16 proof（将来オンチェーン検証に使用）

**Phase 計画**:
- Phase 1 (完了): 証明データのオンチェーン保存（Proof of Existence） — VeriCallRegistry V1
- **Phase 2 (現在): MockVerifier + on-chain ZK 検証** — VeriCallRegistryV2
- Phase 3 (将来): vlayer 本番 → RiscZeroVerifierRouter に切り替え
- Phase 4 (将来): Sui クロスチェーン検証

---

## 4. ZK Proof Verification Architecture（目標アーキテクチャ）

> この章は、vlayer ZK 証明の実態調査と ETHGlobal 受賞プロジェクト (LensMint Camera) の
> 分析を経て設計された **VeriCall の目標 ZK 検証アーキテクチャ** を記述する。

### 4.1 vlayer ZK 証明の実態（調査結果）

vlayer の ZK Prover API (`/api/v0/compress-web-proof`) は現在 **"Under Development"** ステータスで稼働している。
返却される証明データの実態は以下の通り:

```
┌──────────────────────────────────────────────────────────────┐
│  vlayer /compress-web-proof レスポンス                         │
│                                                               │
│  {                                                            │
│    "success": true,                                           │
│    "data": {                                                  │
│      "zkProof": "0xffffffff...",     ← seal (36 bytes)       │
│      "journalDataAbi": "0x00..."     ← ABI-encoded journal  │
│    }                                                          │
│  }                                                            │
└──────────────────────────────────────────────────────────────┘
```

#### zkProof (Seal) の構造: 36 bytes

```
Offset  Size    Field              Value
──────  ──────  ─────────────────  ──────────────────────────────
0x00    4 byte  selector           0xFFFFFFFF (RISC Zero SELECTOR_FAKE)
0x04    32 byte imageId            可変 (RISC Zero guest program ID)

合計: 36 bytes
```

**重要な発見**:
- `0xFFFFFFFF` は RISC Zero の `SELECTOR_FAKE` — **Mock Proof** を示すセレクタ
- 本番の Groth16 BN254 proof は ~256 bytes になるはず（現在は 36 bytes）
- seal 内の imageId は毎回異なり、vlayer `/guest-id` API が返す guestId とも一致しない
- **RISC Zero RiscZeroVerifierRouter (`0x0b144e...`) に verify() を呼ぶと REVERT する**

```
実験: Base Sepolia 上で実行
  contract: RiscZeroVerifierRouter (0x0b144e07a0826182b6b59788c34b32bfa86fb711)
  call:     verify(seal, guestId, sha256(journal))
  result:   ❌ REVERTED (error signature: 0xe4ea6542)
```

#### LensMint Camera の解法（ETHGlobal Buenos Aires 2025 — vlayer Best ZK Proving dApp 受賞）

LensMint Camera (https://github.com/mbcse/lensmint-camera) は **同じ問題** に対して以下の解法を採用:

```
1. RiscZeroMockVerifier(0xFFFFFFFF) を自前デプロイ
   └─ seal[0:4] == 0xFFFFFFFF ならパス（Mock 受理）

2. LensMintVerifier.sol で verify() を呼び出し
   └─ verifier.verify(seal, IMAGE_ID, sha256(journalData))

3. journalData を abi.decode して中身を検証
   └─ notaryKeyFingerprint, method, url, timestamp, queriesHash, extractedData

4. Production 切り替えパス
   └─ 環境変数 RISC_ZERO_VERIFIER_ADDRESS が設定されていれば本番 Verifier を使用
```

**結論**: vlayer の Mock Proof はバグではなく開発モードの仕様。
ETHGlobal 受賞プロジェクトも同パターン。VeriCall も同じアプローチを採用する。

### 4.2 Journal Data Format 仕様（バイトレベル）

vlayer `/compress-web-proof` が返す `journalDataAbi` は以下の Solidity ABI エンコーディング:

```solidity
abi.encode(
    bytes32 notaryKeyFingerprint,  // Slot 0: TLSNotary 公開鍵フィンガープリント
    string  method,                // Slot 1+: HTTP メソッド ("GET")
    string  url,                   // Slot N+: 証明対象 URL (完全 URL)
    uint256 timestamp,             // Slot M:  証明生成時刻 (Unix epoch seconds)
    bytes32 queriesHash,           // Slot M+1: URL クエリパラメータの keccak256
    string  extractedData          // Slot P+: JMESPath 抽出結果 (JSON 文字列)
)
```

#### ABI エンコーディング詳細（バイトレイアウト）

```
Offset  Description
──────  ─────────────────────────────────────────────────────
0x0000  bytes32 notaryKeyFingerprint (32 bytes, 左詰め)
0x0020  uint256 offset_method        (→ method 文字列の開始位置)
0x0040  uint256 offset_url           (→ url 文字列の開始位置)
0x0060  uint256 timestamp            (32 bytes, 右詰め)
0x0080  bytes32 queriesHash          (32 bytes, 左詰め)
0x00A0  uint256 offset_extractedData (→ extractedData 文字列の開始位置)
...
        [method 文字列データ: length + UTF-8 bytes + padding]
        [url 文字列データ: length + UTF-8 bytes + padding]
        [extractedData 文字列データ: length + UTF-8 bytes + padding]
```

#### VeriCall 具体例

```
notaryKeyFingerprint: 0xa1b2c3d4...              (TLSNotary notary 公開鍵の SHA-256)
method:               "GET"                       (Decision API への HTTP メソッド)
url:                  "https://vericall-kkz6k4jema-uc.a.run.app/api/witness/decision/CA1234..."
timestamp:            1738900000                  (2025-02-07T...)
queriesHash:          0x0000...0000               (クエリパラメータなし = zero)
extractedData:        '["BLOCK","Caller was selling SEO services and cold-calling from a list"]'
```

**extractedData** は JMESPath `["decision", "reason"]` で抽出された値の JSON 配列。
Solidity 側ではこの文字列をそのまま保存し、オフチェーンで JSON パースして利用する。

#### Solidity デコード

```solidity
(
    bytes32 notaryKeyFingerprint,
    string memory method,
    string memory url,
    uint256 proofTimestamp,
    bytes32 queriesHash,
    string memory extractedData
) = abi.decode(journalDataAbi, (bytes32, string, string, uint256, bytes32, string));
```

### 4.3 IRiscZeroVerifier Interface

RISC Zero の標準検証インターフェース。全ての Verifier（Mock / Groth16 / STARK）がこれを実装する。

```solidity
// SPDX-License-Identifier: Apache-2.0
interface IRiscZeroVerifier {
    /// @notice ZK 証明を検証する。失敗時は revert する。
    /// @param seal       証明データ (Mock: 36 bytes / Groth16: ~256 bytes)
    /// @param imageId    RISC Zero guest program ID (vlayer の guestId)
    /// @param journalDigest  sha256(journalDataAbi) — journal のダイジェスト
    function verify(
        bytes calldata seal,
        bytes32 imageId,
        bytes32 journalDigest
    ) external view;
}
```

**重要**: `journalDigest` は `sha256` であって `keccak256` ではない。
RISC Zero は内部で SHA-256 を使用するため、Solidity 側も `sha256()` を使う必要がある。

### 4.4 Mock vs Production Verifier

```
┌─────────────────────────────────────────────────────────────────────┐
│                    IRiscZeroVerifier                                 │
│                    verify(seal, imageId, journalDigest)             │
│                                                                     │
│  ┌──────────────────────────┐    ┌──────────────────────────────┐  │
│  │  RiscZeroMockVerifier    │    │  RiscZeroVerifierRouter       │  │
│  │  (Development)           │    │  (Production)                 │  │
│  │                          │    │                               │  │
│  │  検証ロジック:            │    │  検証ロジック:                │  │
│  │  seal[0:4] == 0xFFFFFFFF │    │  Groth16 BN254 完全検証      │  │
│  │  → true (常にパス)       │    │  → 暗号学的に安全             │  │
│  │                          │    │                               │  │
│  │  デプロイ: 自前           │    │  デプロイ済み (RISC Zero):    │  │
│  │  セレクタ: 0xFFFFFFFF    │    │  0x0b144e07a0826182b6b59788  │  │
│  │                          │    │  c34b32bfa86fb711             │  │
│  └──────────────────────────┘    └──────────────────────────────┘  │
│                                                                     │
│  VeriCallRegistryV2 のコンストラクタで注入:                          │
│  constructor(IRiscZeroVerifier _verifier, bytes32 _imageId)         │
│                                                                     │
│  切り替え: デプロイ時に verifier アドレスを変更するだけ              │
│            コントラクトコードの変更は不要                             │
└─────────────────────────────────────────────────────────────────────┘
```

| | RiscZeroMockVerifier | RiscZeroVerifierRouter |
|---|---|---|
| Base Sepolia アドレス | 自前デプロイ | `0x0b144e07a0826182b6b59788c34b32bfa86fb711` |
| 検証内容 | `seal[0:4] == 0xFFFFFFFF` | Groth16 BN254 暗号検証 |
| 安全性 | テスト用（誰でも偽造可能） | 暗号学的に安全 |
| vlayer 対応 | 現在の開発モード seal を受理 | 将来の本番 seal を受理 |
| Gas コスト | ~3,000 gas | ~300,000 gas (pairing 演算) |
| 使用場面 | 開発・ハッカソン | プロダクション |

### 4.5 VeriCallRegistryV2 アーキテクチャ

V1 からの変更点:
1. **`IRiscZeroVerifier.verify()` 呼び出し** — ZK 証明をオンチェーンで検証
2. **`abi.decode(journalDataAbi)`** — Journal を Solidity でデコード
3. **フィールド検証** — TLSNotary/HTTP メタデータの整合性チェック
4. **`getProvenData()` ビュー関数** — デコード済みデータの読み取り
5. **`verified` フラグ** — 検証パス済みを明示

```
VeriCallRegistryV2
│
├── State (immutable)
│   ├── verifier: IRiscZeroVerifier     ← コンストラクタで注入
│   └── imageId: bytes32                ← vlayer guestId
│
├── State (mutable)
│   ├── owner: address
│   ├── records: mapping(bytes32 → CallRecord)
│   ├── callIds: bytes32[]
│   └── totalAccepted / totalBlocked / totalRecorded
│
├── registerCallDecision(callId, callerHash, decision, reason, seal, journal, url)
│   │
│   ├── Step 1: ZK Proof 検証
│   │   └── verifier.verify(seal, imageId, sha256(journalDataAbi))
│   │       └── Mock: seal[0:4] == 0xFFFFFFFF → pass
│   │       └── Prod: Groth16 BN254 pairing check → pass or revert
│   │
│   ├── Step 2: Journal デコード & バリデーション
│   │   └── abi.decode(journalDataAbi) → 6 fields:
│   │       ├── notaryKeyFingerprint ≠ bytes32(0)   ← TLSNotary 鍵が存在
│   │       ├── method == "GET"                      ← HTTP メソッド正当性
│   │       ├── bytes(url).length > 0                ← URL が存在
│   │       └── bytes(extractedData).length > 0      ← 抽出データが存在
│   │
│   ├── Step 3: CallRecord 保存
│   │   └── journalHash = keccak256(journalDataAbi) をコミットメントとして保存
│   │
│   └── Step 4: イベント発行
│       ├── ProofVerified(callId, imageId, journalDigest)
│       └── CallDecisionRecorded(callId, callerHash, decision, timestamp, submitter)
│
├── getRecord(callId) → CallRecord
├── getProvenData(callId) → (notaryKeyFP, method, url, timestamp, queriesHash, extractedData)
├── verifyJournal(callId, journalData) → bool
├── getStats() → (total, accepted, blocked, recorded)
│
└── Admin
    ├── updateImageId(bytes32)     [onlyOwner]
    └── transferOwnership(address) [onlyOwner]
```

#### CallRecord 構造体 (V2)

```solidity
struct CallRecord {
    bytes32 callerHash;        // keccak256(phoneNumber) — プライバシー保護
    Decision decision;         // ACCEPT(1) / BLOCK(2) / RECORD(3)
    string reason;             // AI の判定理由（200 文字以内）
    bytes32 journalHash;       // keccak256(journalDataAbi) — コミットメント
    bytes zkProofSeal;         // RISC Zero seal (Mock: 36B / Prod: ~256B)
    bytes journalDataAbi;      // ABI エンコード済み public outputs (全6フィールド)
    string sourceUrl;          // 証明対象 URL
    uint256 timestamp;         // block.timestamp
    address submitter;         // TX 送信者
    bool verified;             // ZK 検証パス済みフラグ (常に true — revert しなければ到達しない)
}
```

### 4.6 End-to-End 処理フロー（バイトレベル詳細）

```
═══════════════════════════════════════════════════════════════════════
 Step 1: 電話着信 → AI スクリーニング → 判定
═══════════════════════════════════════════════════════════════════════

  Caller ──PSTN──→ Twilio ──POST──→ /phone/incoming
                              │
                              └─ TwiML <Connect><Stream> ──WS──→ server.ts
                                                                     │
                                                              VoiceAISession
                                                              ├─ STT (Google)
                                                              ├─ Gemini AI
                                                              └─ TTS (Google)
                                                                     │
                                                              Decision: BLOCK
                                                              Reason: "Caller was selling..."

═══════════════════════════════════════════════════════════════════════
 Step 2: 判定データ保存 (Cloud SQL)
═══════════════════════════════════════════════════════════════════════

  handleDecision()
    └─ storeDecisionForProof()
         └─ INSERT INTO decision_records
              call_sid:          'CA1234abcdef...'
              decision:          'BLOCK'
              reason:            'Caller was selling SEO services...'
              transcript:        'AI: Hello... Caller: Hi...'
              system_prompt_hash: 'a3f2b1...'
              expires_at:         NOW() + interval '1 hour'

═══════════════════════════════════════════════════════════════════════
 Step 3: vlayer Web Proof (TLSNotary MPC)
═══════════════════════════════════════════════════════════════════════

  pipeline.ts: generateWebProof(proofUrl)

  Request:
    POST https://web-prover.vlayer.xyz/api/v1/prove
    Headers:
      Content-Type: application/json
      x-client-id: 4f028e97-b7c7-4a81-ade2-6b1a2917380c
      Authorization: Bearer {VLAYER_API_KEY}
    Body:
      {
        "url": "https://vericall-kkz6k4jema-uc.a.run.app/api/witness/decision/CA1234...",
        "headers": []
      }

  vlayer 内部処理:
    1. VeriCall サーバーに TLS 接続
    2. TLSNotary MPC プロトコルで TLS セッションを共同実行
       ├─ Prover (vlayer) が TLS ハンドシェイクの一部を保持
       └─ Notary (vlayer notary) が残りを保持 → 共同で復号
    3. HTTP レスポンスの内容を暗号的に証明
    4. WebProof オブジェクトを構築
       ├─ data: TLSNotary presentation (base64)
       ├─ version: プロトコルバージョン
       └─ meta.notaryUrl: Notary サーバー URL

  Response:
    {
      "data": "base64-encoded-tlsnotary-presentation...",
      "version": "...",
      "meta": { "notaryUrl": "https://..." }
    }

  所要時間: 10-30 秒

═══════════════════════════════════════════════════════════════════════
 Step 4: vlayer ZK Proof (RISC Zero zkVM → Mock Seal)
═══════════════════════════════════════════════════════════════════════

  pipeline.ts: compressToZKProof(webProof, ["decision", "reason"])

  Request:
    POST https://zk-prover.vlayer.xyz/api/v0/compress-web-proof
    Headers:
      Content-Type: application/json
      x-client-id: 4f028e97-b7c7-4a81-ade2-6b1a2917380c
      Authorization: Bearer {VLAYER_API_KEY}
    Body:
      {
        "presentation": { "data": "...", "version": "...", "meta": {...} },
        "extraction": {
          "response.body": {
            "jmespath": ["decision", "reason"]
          }
        }
      }

  vlayer 内部処理:
    1. WebProof を RISC Zero zkVM ゲストプログラムに入力
    2. zkVM 内で TLSNotary 証明を検証
    3. JMESPath ["decision", "reason"] で HTTP レスポンスボディから値を抽出
    4. Journal (public outputs) を構築:
       ├─ notaryKeyFingerprint: TLSNotary 公開鍵の SHA-256
       ├─ method: "GET"
       ├─ url: "https://vericall-.../api/witness/decision/CA1234..."
       ├─ timestamp: 1738900000
       ├─ queriesHash: 0x00...00
       └─ extractedData: '["BLOCK","Caller was selling SEO services..."]'
    5. Journal を ABI エンコード → journalDataAbi
    6. Seal (証明) を生成 → 現在は Mock: 0xFFFFFFFF + imageId (36 bytes)

  Response:
    {
      "success": true,
      "data": {
        "zkProof": "0xffffffff6e251f4d993427d02a4199e1201f3b54462365d7c672a51be57f776d509b47eb",
        "journalDataAbi": "0x000000...（ABI エンコード済みデータ）"
      }
    }

  所要時間: 30-120 秒

═══════════════════════════════════════════════════════════════════════
 Step 5: On-chain 登録 + ZK 検証 (VeriCallRegistryV2)
═══════════════════════════════════════════════════════════════════════

  pipeline.ts: submitDecisionOnChain({...})

  TX 構築 (viem):
    to:       VeriCallRegistryV2 (0x...)
    function: registerCallDecision(
      callId:          keccak256("vericall_CA1234..._1738900000"),
      callerHash:      keccak256("+1234567890"),
      decision:        2 (BLOCK),
      reason:          "Caller was selling SEO services...",
      zkProofSeal:     0xffffffff6e251f4d...,
      journalDataAbi:  0x000000... (ABI エンコード),
      sourceUrl:       "https://vericall-.../api/witness/decision/CA1234..."
    )

  コントラクト内部処理:

    ┌─ Step 5a: ZK Proof 検証 ────────────────────────────────────┐
    │                                                              │
    │  bytes32 journalDigest = sha256(journalDataAbi);             │
    │  verifier.verify(zkProofSeal, imageId, journalDigest);       │
    │                                                              │
    │  MockVerifier の場合:                                        │
    │    require(bytes4(seal[:4]) == 0xFFFFFFFF)  → ✅ PASS        │
    │                                                              │
    │  ProductionVerifier の場合 (将来):                            │
    │    Groth16 BN254 pairing check  → ✅ PASS or ❌ REVERT      │
    │                                                              │
    │  emit ProofVerified(callId, imageId, journalDigest)          │
    └──────────────────────────────────────────────────────────────┘

    ┌─ Step 5b: Journal デコード & バリデーション ─────────────────┐
    │                                                              │
    │  (notaryKeyFP, method, url, ts, queriesHash, extractedData)  │
    │    = abi.decode(journalDataAbi,                              │
    │        (bytes32, string, string, uint256, bytes32, string))   │
    │                                                              │
    │  require(notaryKeyFP != bytes32(0))      → TLSNotary 鍵存在 │
    │  require(method == "GET")                → HTTP メソッド正当  │
    │  require(bytes(url).length > 0)          → URL 存在          │
    │  require(bytes(extractedData).length > 0) → 抽出データ存在   │
    └──────────────────────────────────────────────────────────────┘

    ┌─ Step 5c: レコード保存 ─────────────────────────────────────┐
    │                                                              │
    │  records[callId] = CallRecord({                              │
    │    callerHash:     keccak256("+1234567890"),                  │
    │    decision:       BLOCK,                                    │
    │    reason:         "Caller was selling SEO services...",      │
    │    journalHash:    keccak256(journalDataAbi),                │
    │    zkProofSeal:    0xffffffff...,                             │
    │    journalDataAbi: 0x000000...,                              │
    │    sourceUrl:      "https://vericall-.../.../CA1234...",      │
    │    timestamp:      block.timestamp,                          │
    │    submitter:      0xBC5e73A464...,                          │
    │    verified:       true                                      │
    │  })                                                          │
    │                                                              │
    │  emit CallDecisionRecorded(callId, callerHash, BLOCK, ts, …) │
    └──────────────────────────────────────────────────────────────┘

  結果:
    txHash: 0xabcdef...
    blockNumber: 37329000
    gasUsed: ~150,000 (Mock) / ~450,000 (Production)

═══════════════════════════════════════════════════════════════════════
 Step 6: 検証（誰でも実行可能）
═══════════════════════════════════════════════════════════════════════

  A) CLI インスペクター (check-registry.ts):
     npx tsx scripts/check-registry.ts
     → getRecord(callId) でフルデータ取得
     → verifyJournal(callId, journalDataAbi) で整合性検証
     → getProvenData(callId) でデコード済みデータ表示

  B) Explorer API:
     GET /api/explorer
     → 全レコードを JSON で返却

  C) BaseScan:
     https://sepolia.basescan.org/address/{contract}
     → Read Contract → getRecord / getProvenData / verifyJournal

  D) 独自検証:
     1. getRecord(callId) で seal + journalDataAbi を取得
     2. sha256(journalDataAbi) == 期待される journalDigest を確認
     3. verifier.verify(seal, imageId, journalDigest) が revert しないことを確認
     4. abi.decode(journalDataAbi) で extractedData を読み取り
     5. extractedData の JSON をパースして decision/reason を確認
```

### 4.7 デプロイフロー

```
scripts/deploy-v2.ts

  ┌─ Step 1: RiscZeroMockVerifier デプロイ ─────────────────────┐
  │                                                              │
  │  bytecode: contracts/out から読み込み                         │
  │  constructor: (bytes4 selector = 0xFFFFFFFF)                 │
  │  → mockVerifierAddress                                       │
  └──────────────────────────────────────────────────────────────┘
          │
  ┌─ Step 2: VeriCallRegistryV2 デプロイ ───────────────────────┐
  │                                                              │
  │  bytecode: contracts/out から読み込み                         │
  │  constructor: (                                              │
  │    IRiscZeroVerifier _verifier = mockVerifierAddress,         │
  │    bytes32 _imageId = 0x6e251f4d993427d02a4199e1201f3b5446…  │
  │  )                                                           │
  │  → registryV2Address                                         │
  └──────────────────────────────────────────────────────────────┘
          │
  ┌─ Step 3: deployment.json 更新 ──────────────────────────────┐
  │                                                              │
  │  {                                                           │
  │    "network": "base-sepolia",                                │
  │    "chainId": 84532,                                         │
  │    "contractAddress": registryV2Address,                     │
  │    "mockVerifierAddress": mockVerifierAddress,                │
  │    "guestId": "0x6e251f4d...",                               │
  │    "version": "v2",                                          │
  │    "v1Address": "0xe454ca755219310b2728d39db8039cbaa7abc3b8"  │
  │  }                                                           │
  └──────────────────────────────────────────────────────────────┘
          │
  ┌─ Step 4: .env.local 更新 ──────────────────────────────────┐
  │                                                              │
  │  VERICALL_CONTRACT_ADDRESS=registryV2Address                 │
  └──────────────────────────────────────────────────────────────┘
```

#### Production 切り替え（将来）

vlayer が本番 Groth16 proof を返すようになった場合:

```
1. VeriCallRegistryV2 を再デプロイ
   constructor(
     IRiscZeroVerifier(0x0b144e07a0826182b6b59788c34b32bfa86fb711),  // RiscZeroVerifierRouter
     guestId
   )

2. パイプラインは変更不要（seal のフォーマットが変わるだけ）

3. 過去の MockVerifier レコードと新しい Production レコードは
   異なるコントラクトに記録される（V2-Mock / V2-Prod）
```

### 4.8 LensMint パターンとの完全対比

| 要素 | LensMint Camera | VeriCall V2 |
|------|----------------|-------------|
| **プロジェクト概要** | Web3 カメラ — 写真の真正性証明 | AI 電話受付 — 判定結果の真正性証明 |
| **ETHGlobal 受賞** | Buenos Aires 2025 Finalist + vlayer Prize | — |
| **Web Proof 対象 URL** | IPFS/NFT メタデータ API | `/api/witness/decision/{callSid}` |
| **JMESPath 抽出** | 写真ハッシュ・メタデータ | `["decision", "reason"]` |
| **Verifier** | `RiscZeroMockVerifier(0xFFFFFFFF)` | `RiscZeroMockVerifier(0xFFFFFFFF)` |
| **verify() 呼び出し** | ✅ `LensMintVerifier.sol` L62 | ✅ `VeriCallRegistryV2.sol` |
| **sha256 ダイジェスト** | ✅ `sha256(journalData)` | ✅ `sha256(journalDataAbi)` |
| **Journal abi.decode** | ✅ 6 fields | ✅ 6 fields (同一フォーマット) |
| **フィールド検証** | notaryKeyFP, method, url, queries, data | notaryKeyFP, method, url, data |
| **Production 切替パス** | 環境変数 `RISC_ZERO_VERIFIER_ADDRESS` | コンストラクタ注入 |
| **getProvenData()** | ❌ なし | ✅ on-chain デコード読み取り |
| **verified フラグ** | ❌ なし | ✅ CallRecord.verified |

### 4.9 ファイル構成 (V2 追加分)

```
contracts/
├── VeriCallRegistry.sol              # V1 (Phase 1, 既存, 0xe454ca...)
├── VeriCallRegistryV2.sol            # V2 (Phase 2, 新規) ← NOW
├── RiscZeroMockVerifier.sol          # Mock Verifier (新規)
├── interfaces/
│   └── IRiscZeroVerifier.sol         # RISC Zero 標準 interface (新規)
├── deployment.json                   # デプロイメント情報
└── out/                              # Forge ビルド出力
    ├── VeriCallRegistry.sol/
    ├── VeriCallRegistryV2.sol/
    └── RiscZeroMockVerifier.sol/

scripts/
├── check-registry.ts                 # CLI インスペクター (V1/V2 対応)
└── deploy-v2.ts                      # V2 デプロイスクリプト (新規)

lib/witness/
├── abi.ts                            # V2 ABI (更新)
├── on-chain.ts                       # on-chain 操作 (V2 対応に更新)
├── pipeline.ts                       # パイプライン (変更なし — 関数 I/F 同一)
├── vlayer-api.ts                     # vlayer API クライアント (変更なし)
└── decision-store.ts                 # Cloud SQL ストア (変更なし)
```
