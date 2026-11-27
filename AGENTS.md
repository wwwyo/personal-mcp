# personal-mcp

## Story

本人が、自分の API key を手元に置かないクラウドの agent に、自分の活動記録や X・Product Hunt の情報を読ませる。

Core actions:
- 定時のルーティン（wwwyo/me の daily-start / daily-end）がツールを呼んで、その日の入力を集める — 毎日
- 新しい外部 API が要るときにツールを足す — たまに

## ディレクトリ構造

```
personal-mcp/
├── src/
│   ├── index.ts          Worker の入口（POST /mcp だけ。bearer を照合して stateless に MCP を返す）
│   ├── server.ts         ツールの登録（名前・説明・入力 schema）
│   ├── langfuse.ts       Langfuse（読み取りのみ）
│   ├── x.ts              X API の client（投稿・ブックマーク）
│   ├── x-state.ts        X の token のローテートとブックマークの既読（storage を差し替えてテストする）
│   ├── x-token-store.ts  x-state を持つ Durable Object
│   ├── producthunt.ts    Product Hunt API v2
│   ├── time.ts           JST / PT の暦日
│   └── env.ts            バインディングの型と ToolError
├── test/                 bun test（fetch を偽物にして API の呼び方を確かめる）
├── scripts/sync-secrets.sh  fnox → wrangler secret put
├── fnox.toml             secret の名前と説明だけ（値は gitignore の fnox.local.toml）
└── docs/setup.md         デプロイ・secret・portal 登録の手順
```

## セットアップ

ツールは mise で管理している。

```bash
mise install
bun install
bun run test        # テスト
bun run typecheck   # wrangler types で型を作ってから tsc
bun run dev         # wrangler dev
```

デプロイと secret は本人が手元で行う（[docs/setup.md](docs/setup.md)）。

## 技術スタック

- TypeScript、Cloudflare Workers（wrangler）、Durable Objects（SQLite）
- MCP: `@modelcontextprotocol/sdk` の Web 標準 Streamable HTTP transport（stateless・JSON 応答）、入力 schema は zod
- bun（パッケージ管理とテスト）

## 規約

- **key の値を扱わない。** リポジトリ・ログ・ツールの応答・エラーメッセージに secret の値を出さない。想定外の例外は種類だけ返し、詳細は Worker のログに出す。fnox.toml には名前と説明だけを書く（public repo）
- **ツールは読み取りを既定にする。** 外部サービスに書き込むツールは足さない。足す必要が出たら、portal の tool 単位の公開設定で絞れるかと合わせて本人に確認する
- **従量課金の API は読む件数を最小にする。** X は読んだ投稿 1 件ごとに課金される。既定のページを小さく保ち、上限で打ち切ったら warnings と truncated で知らせる（黙って切らない）
- **取得の規則は wwwyo/me の daily スキルと揃える。** Langfuse の窓と集計は daily-end の day_sessions.py、X は x_fetch.py、Product Hunt は rss skill の fetch.py が元。挙動を変えたら呼び出し側のスキルも直す
- ツールを足すときは `server.ts` に登録し、API の呼び方を fetch の偽物でテストし、`test/mcp.test.ts` のツール一覧と README の表を更新する。secret が増えたら `env.ts`・`fnox.toml`・`scripts/sync-secrets.sh`・docs/setup.md を同じ変更で直す
