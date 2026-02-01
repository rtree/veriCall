# VeriCall AI音声応答 - アイデア

## コンセプト

**AIが「門番」として営業電話をフィルタリング**
- 全ての着信をAIが一次対応
- 用件を確認し、営業電話かどうかを判定
- 営業でなければオーナーに転送

## 基本フロー

```
着信 → AI受付（用件確認）
         │
         ├─ 🚫 営業電話と判定 → 丁寧にお断り → 切断
         │     「申し訳ございませんが、営業のお電話は
         │      お受けしておりません」
         │
         ├─ ✅ 正当な用件 → オーナーに転送
         │     「少々お待ちください。お繋ぎいたします」
         │
         └─ ❓ 判断できない → 伝言を預かる → メール通知
               「折り返しご連絡いたしますので、
                ご用件とお名前をお願いします」
```

## AI判定ロジック

### 営業電話の特徴（ブロック）
- 「ご提案」「サービスのご案内」「お得な情報」
- 会社名を言わない、曖昧な説明
- 「担当者様」「社長様」への取り次ぎ要求
- 不動産投資、保険、回線、コスト削減

### 正当な用件（転送）
- 具体的な用件がある
- 取引先、顧客、知人
- 予約、問い合わせ、折り返し

## アーキテクチャ

```
┌─────────────┐     WebSocket      ┌─────────────────────────────┐
│   Twilio    │◄──────────────────►│      VeriCall Voice AI      │
│  (電話)     │   8kHz μ-law音声   │        (Cloud Run)          │
└─────────────┘                    └──────────────┬──────────────┘
                                                  │
                    ┌─────────────────────────────┼─────────────────────────────┐
                    │                             │                             │
                    ▼                             ▼                             ▼
          ┌─────────────────┐           ┌─────────────────┐           ┌─────────────────┐
          │  Speech-to-Text │           │  Gemini 2.5     │           │  Text-to-Speech │
          │  (リアルタイム)  │   ────►   │  Flash          │   ────►   │  (Wavenet)      │
          │  phone_callモデル│  テキスト │  会話AI         │  応答文   │  ja-JP女性声    │
          └─────────────────┘           └─────────────────┘           └─────────────────┘
```

## 処理フロー詳細

### 1. 接続開始 - TwiML

```xml
<Response>
  <Connect>
    <Stream url="wss://vericall-xxx.run.app/stream">
      <Parameter name="CallSid" value="CA123..." />
      <Parameter name="From" value="+8190..." />
    </Stream>
  </Connect>
</Response>
```

### 2. 音声受信 → STT

```typescript
// Twilioから8kHz μ-law音声 → Linear16変換 → STT
const audioData = Buffer.from(message.media.payload, 'base64');
const linearAudio = mulawToLinear16(audioData);
session.stt.writeAudio(linearAudio);
```

### 3. STT完了 → Gemini AI

```typescript
session.stt.onResult(async (transcript, isFinal) => {
  if (isFinal) {
    const response = await session.gemini.chat(transcript);
    // → "ご用件を承りました。折り返しご連絡いたします。"
  }
});
```

### 4. AI応答 → TTS → Twilio

```typescript
// TTS: 日本語女性声 (Wavenet-B), 8kHz μ-law
const audioContent = await session.tts.synthesize(response);

// Twilioに送信
ws.send(JSON.stringify({
  event: 'media',
  streamSid: session.streamSid,
  media: { payload: audioContent.toString('base64') }
}));
```

### 5. 会話終了検知

```typescript
const farewellPhrases = ['失礼いたします', 'お電話ありがとうございました'];
if (farewellPhrases.some(phrase => response.includes(phrase))) {
  setTimeout(() => ws.close(), 3000);
}
```

## 使用するGoogle Cloudサービス

| サービス | 用途 | 設定 |
|----------|------|------|
| Speech-to-Text | リアルタイム音声認識 | `phone_call`モデル, 8kHz |
| Vertex AI Gemini | 会話AI | `gemini-2.5-flash` |
| Text-to-Speech | 音声合成 | `ja-JP-Wavenet-B`(女性), 8kHz μ-law |

## レイテンシ最適化

- **ストリーミングSTT**: 発話途中から認識開始
- **短い応答**: システムプロンプトで1文を短く指示
- **μ-law直接出力**: TTS→Twilioの変換不要

## 機能案

### 1. 営業電話フィルター（MVP）
- AIが用件を確認
- 営業電話を判定してブロック
- 正当な用件は転送

### 2. 伝言モード
- 転送できない場合に伝言を預かる
- 文字起こしをメール送信

### 3. ホワイトリスト併用
- 登録済み番号は即転送（AIスキップ）
- 未登録のみAI判定

### 4. Vlayer公平性証明（VeriCall特有）

**コンセプト**: AIが全員を同じロジックで判定していることを証明

```
┌─────────────────────────────────────────────────────────┐
│                  公平性の証明                            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  【オンチェーンに記録】                                  │
│  ┌─────────────────────────────────────────────────┐   │
│  │ promptHash:  0xabc...  (システムプロンプトのハッシュ) │
│  │ inputHash:   0xdef...  (会話内容のハッシュ)          │
│  │ decision:    BLOCK / TRANSFER / MESSAGE            │
│  │ timestamp:   1738483200                            │
│  │ callerHash:  0x123...  (電話番号のハッシュ)          │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  【証明できること】                                      │
│  ✅ 全員に同じpromptHashを使用（ロジック一貫性）          │
│  ✅ 判定結果が改ざんされていない                         │
│  ✅ 特定の番号を優遇/冷遇していない                      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Vlayer活用方法**:
1. **Web Proof**: Gemini APIレスポンスを証明（判定結果の真正性）
2. **オンチェーン記録**: 判定ログをスマートコントラクトに保存
3. **検証可能性**: 後から「同じ入力 → 同じ判定」を再現可能

## システムプロンプト（案）

```
あなたは電話受付AIです。発信者の用件を確認し、以下を判定してください：

【営業電話の特徴】
- サービス提案、ご案内、お得情報
- 具体的な用件がない
- 「ご担当者様」への取り次ぎ要求
- 不動産、保険、回線、コスト削減系

【応答パターン】
1. 営業と判定 → "申し訳ございませんが、営業のお電話はお受けしておりません。失礼いたします。" → [BLOCK]
2. 正当な用件 → "少々お待ちください。お繋ぎいたします。" → [TRANSFER]
3. 判断できない → "折り返しご連絡いたしますので、ご用件とお名前をお願いできますか？" → [MESSAGE]

応答は1〜2文で簡潔に。
```

## 実装ファイル構成（案）

```
app/
├── phone/
│   ├── incoming/route.ts      # 着信 → AI Stream開始
│   ├── stream/route.ts        # WebSocket音声ストリーム
│   └── transfer/route.ts      # AI判定後の転送処理
│
lib/
├── voice-ai/
│   ├── session.ts             # セッション管理
│   ├── speech-to-text.ts      # STT処理
│   ├── gemini.ts              # Gemini会話 + 判定
│   ├── text-to-speech.ts      # TTS処理
│   └── audio-utils.ts         # μ-law変換など
```

## 次のアクション

- [ ] GCP API有効化 (Speech-to-Text, Text-to-Speech, Vertex AI)
- [ ] Gemini判定プロンプト作成
- [ ] WebSocketエンドポイント作成 (`/phone/stream`)
- [ ] 営業電話判定ロジック実装
- [ ] 転送/ブロック/伝言の分岐処理
- [ ] Vlayer証明統合
- [ ] μ-law ↔ Linear16 変換実装
- [ ] STT/TTS/Gemini統合
- [ ] 会話ログ保存
- [ ] Vlayer証明統合
