# Playground

Vlayer実験用のスクリプト群。本番コードとは独立。

## 使い方

```bash
# 依存インストール後
npx ts-node docs/playground/vlayer/01-hello-vlayer.ts
```

## ファイル構成

```
docs/playground/
├── vlayer/
│   ├── 01-hello-vlayer.ts    # 基本的なAPI呼び出し
│   ├── 02-web-proof.ts       # Web Proof生成
│   ├── 03-zk-compress.ts     # ZK Proof圧縮
│   └── 04-on-chain.ts        # オンチェーン提出
├── twilio/
│   └── test-call.ts          # 発信テスト
└── README.md
```

## 注意

- このフォルダは本番デプロイに含まれない
- 汚いコードOK、試行錯誤用
- 成功したコードをapp/に移植する
