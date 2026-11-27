# personal-mcp

## Story

本人が、自分の API key を手元に置かないクラウドの agent に、自分の活動記録や X・Product Hunt の情報を読ませる。

Core actions:
- 定時のルーティン（wwwyo/me の daily-start / daily-end）がツールを呼んで、その日の入力を集める — 毎日
- 新しい外部 API が要るときにツールを足す — たまに

## ディレクトリ構造

```
personal-mcp/
├── routes/mcp.ts         Void の route（/mcp だけ）。env.ts の値と X_TOKENS を集めて src/mcp.ts に渡す
├── durable-objects/x-tokens.ts  X_TOKENS の宣言（Void が XTokensDurableObject を作る）
├── env.ts                secret の宣言（void/env。値は void secret）
├── void.config.ts        Worker の設定（名前・互換日・workers.dev・observability）
├── void.lock.json        Void が記録する Durable Object の migration など（commit する）
├── src/
│   ├── mcp.ts            MCP の本体（bearer を照合し、POST だけを stateless に MCP で返す）
│   ├── server.ts         ツールの登録（名前・説明・入力 schema）
│   ├── langfuse.ts       Langfuse（読み取りのみ）
│   ├── x.ts              X API の client（投稿・ブックマーク）
│   ├── x-state.ts        X の token のローテートとブックマークの既読（storage を差し替えてテストする）
│   ├── x-token-store.ts  x-state を持つ Durable Object のクラス
│   ├── producthunt.ts    Product Hunt API v2
│   ├── time.ts           JST / PT の暦日
│   └── app-env.ts        ツールに渡す設定の型と ToolError
├── test/                 Vitest（fetch を偽物にして API の呼び方を確かめる）
├── scripts/sync-secrets.sh  fnox → void secret put
├── fnox.toml             secret の名前と説明だけ（値は gitignore の fnox.local.toml）
└── docs/setup.md         デプロイ・secret・portal 登録の手順
```

## セットアップ

ツールは mise で管理している（Void は Node.js 24.22 以上が要る）。

```bash
mise install
bun install
bun run test        # Vitest
bun run typecheck   # void prepare で型を作ってから tsc
bun run build       # vite build（CI と同じ）
bun run dev         # vite dev（ローカルの値は shell か .env で渡す）
```

Void の使い方は `node_modules/void/docs/` を読む（入口は `guide/quickstart.md`、コマンドは `reference/cli.md`）。

デプロイと secret は本人が手元で行う（[docs/setup.md](docs/setup.md)）。

## 技術スタック

- TypeScript、[Void](https://void.cloud)（Vite + Cloudflare Workers への直接デプロイ）、Durable Objects（SQLite）
- MCP: `@modelcontextprotocol/sdk` の Web 標準 Streamable HTTP transport（stateless・JSON 応答）、入力 schema は zod
- bun（パッケージ管理）、Vitest（テスト）

## 規約

- **key の値を扱わない。** リポジトリ・ログ・ツールの応答・エラーメッセージに secret の値を出さない。想定外の例外は種類だけ返し、詳細は Worker のログに出す。fnox.toml には名前と説明だけを書く（public repo）
- **ツールは読み取りを既定にする。** 外部サービスに書き込むツールは足さない。足す必要が出たら、portal の tool 単位の公開設定で絞れるかと合わせて本人に確認する
- **従量課金の API は読む件数を最小にする。** X は読んだ投稿 1 件ごとに課金される。既定のページを小さく保ち、上限で打ち切ったら warnings と truncated で知らせる（黙って切らない）
- **取得の規則は wwwyo/me の daily スキルと揃える。** Langfuse の窓と集計は daily-end の day_sessions.py、X は x_fetch.py、Product Hunt は rss skill の fetch.py が元。挙動を変えたら呼び出し側のスキルも直す
- ツールを足すときは `server.ts` に登録し、API の呼び方を fetch の偽物でテストし、`test/mcp.test.ts` のツール一覧と README の表を更新する。secret が増えたら root の `env.ts`・`src/app-env.ts`・`routes/mcp.ts`・`fnox.toml`・`scripts/sync-secrets.sh`・docs/setup.md を同じ変更で直す
- **Durable Object の名前を変えない。** `durable-objects/x-tokens.ts` の `name` と、`src/server.ts` が使うインスタンス名 `default` を変えると、保存済みの X token と既読を失う。`void.lock.json` の migration は消したり並べ替えたりしない
