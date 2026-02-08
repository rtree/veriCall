# Vlayer 実験メモ (2026-02-01)

> **Historical document.** These experiments led to the current VeriCall implementation.
> All items in "次のステップ" have been completed — see [DESIGN.md](../DESIGN.md) §2.3 for the production pipeline.

## 概要

VeriCallでVlayerを使って電話の転送判断をオンチェーンに記録する実験。

## 環境

- Vlayer Web Prover: `https://web-prover.vlayer.xyz`
- Vlayer ZK Prover: `https://zk-prover.vlayer.xyz`
- TLSN Version: `0.1.0-alpha.12`
- Notary: `https://notary.vlayer.xyz/v0.1.0-alpha.12`

## テスト用クレデンシャル

公式ドキュメントで公開されている限定公開用クレデンシャル:

```
Client ID: 4f028e97-b7c7-4a81-ade2-6b1a2917380c
API Key: jUWXi1pVUoTHgc7MOgh5X0zMR12MHtAhtjVgMc2DM3B3Uc8WEGQAEix83VwZ
```

**出典:** https://docs.vlayer.xyz/server-side/rest-api/prove

curlコマンド例に含まれている:
```bash
curl -X POST https://web-prover.vlayer.xyz/api/v1/prove \
  -H "Content-Type: application/json" \
  -H "x-client-id: 4f028e97-b7c7-4a81-ade2-6b1a2917380c" \
  -H "Authorization: Bearer jUWXi1pVUoTHgc7MOgh5X0zMR12MHtAhtjVgMc2DM3B3Uc8WEGQAEix83VwZ" \
  ...
```

> ドキュメントには "The included credentials are for limited public use. For production use, please contact our team." と記載

## 実験結果

### 1. 接続テスト (01-hello-vlayer.ts)

```bash
pnpm play docs/playground/vlayer/01-hello-vlayer.ts
```

**成功**

- ZK Prover `/guest-id` 接続OK
- Guest ID: `0x6e251f4d993427d02a4199e1201f3b54462365d7c672a51be57f776d509b47eb`
- Web Prover `/prove` 接続OK
- Proof生成: 11,656 chars

### 2. Web Proof 生成 (02-web-proof.ts)

```bash
pnpm play docs/playground/vlayer/02-web-proof.ts
```

**成功**

対象URL: `https://data-api.binance.vision/api/v3/ticker/price?symbol=ETHUSDC`

生成されたProof:
- Version: `0.1.0-alpha.12`
- Notary: `https://notary.vlayer.xyz/v0.1.0-alpha.12`
- Size: 11,656 chars
- 保存先: `/tmp/web-proof.json`

### 3. ZK Proof 圧縮 (03-zk-proof.ts)

```bash
pnpm play docs/playground/vlayer/03-zk-proof.ts
```

**成功**

抽出クエリ: `["price", "symbol"]` (JMESPath)

生成されたZK Proof:
- `zkProof` (seal): 74 chars
- `journalDataAbi`: 1,090 chars
- 保存先: `/tmp/zk-proof.json`

## Vlayerのフロー

```
┌─────────────────────────────────────────────────────────────────┐
│  1. Web Prover (POST /api/v1/prove)                             │
│     入力: HTTPS URL + Headers                                   │
│     出力: Web Proof (TLSNotary署名付き証明)                     │
│                                                                 │
│     → TLS通信を傍受して「このHTTPレスポンスは本物」を証明       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  2. ZK Prover (POST /api/v0/compress-web-proof)                 │
│     入力: Web Proof + JMESPath抽出クエリ                        │
│     出力: zkProof (seal) + journalDataAbi                       │
│                                                                 │
│     → Web Proofをコンパクトなゼロ知識証明に圧縮                 │
│     → オンチェーン検証可能な形式に変換                          │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  3. On-chain Verification                                        │
│     → Solidity ContractでzkProofを検証                          │
│     → journalDataAbiをデコードしてデータ使用                    │
│                                                                 │
│     例: 「ETH/USDC価格が$3500だった」をオンチェーンで証明       │
└─────────────────────────────────────────────────────────────────┘
```

## journalDataAbi の構造

```solidity
(
  bytes32 notaryKeyFingerprint,  // Notary公開鍵のフィンガープリント
  string method,                 // HTTP method (GET, POST等)
  string url,                    // 証明されたURL
  uint256 tlsTimestamp,          // TLSセッションのUnixタイムスタンプ
  bytes32 extractionHash,        // 抽出クエリのハッシュ
  ...extractedValues             // JMESPathで抽出した値
)
```

## VeriCallでの活用案

1. **電話判断のAPIエンドポイント作成**
   - `GET /api/decision/:callId` → 判断結果をJSON返却

2. **Web Proverで判断を証明化**
   - Twilio Webhook → 判断 → APIに記録 → Web Proof生成

3. **ZK Proofに圧縮**
   - 抽出: `callId`, `action`, `timestamp`, `callerHash`

4. **Base Sepoliaに記録**
   - VerifierコントラクトでzkProofを検証
   - 判断履歴をオンチェーンに永続化

## 次のステップ

- [x] Twilio開通待ち → Done (Twilio Programmable Voice)
- [x] VeriCall `/api/decision/:callId` エンドポイント実装 → `GET /api/witness/decision/:callSid`
- [x] Cloud Runデプロイ（HTTPSが必要） → `vericall-kkz6k4jema-uc.a.run.app`
- [x] 本番用Vlayer APIキー取得（要チーム連絡） → Using limited public credentials
- [x] Base Sepolia Verifierコントラクト作成 → `VeriCallRegistryV3` at `0x4395cf02b8d343aae958bda7ac6ed71fbd4abd48`

## 参考リンク

- [Vlayer Docs](https://docs.vlayer.xyz/)
- [Web Prover REST API](https://docs.vlayer.xyz/server-side/rest-api/prove)
- [ZK Prover REST API](https://docs.vlayer.xyz/blockchain/rest-api/compress-web-proof)
- [vouch GitHub Verifier Example](https://github.com/vlayer-xyz/vouch-github-verifier)
