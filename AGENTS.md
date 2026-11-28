# personal-mcp

## Story

本人が、自分の API key を手元に置かないクラウドの agent に、自分の活動記録や X・Product Hunt の情報を読ませる。

本人が、電子工作中の手元をこの Mac のカメラ越しに Claude に見せる。

Core actions:
- 定時のルーティン（wwwyo/me の daily-start / daily-end）がツールを呼んで、その日の入力を集める — 毎日
- 作業中にカメラサーバーを起動し、agent に手元を撮らせて見てもらう — 電子工作のたび
- 新しい外部 API が要るときにツールを足す — たまに

## ディレクトリ構造

```
personal-mcp/
├── worker/                 クラウドの Worker（Void → Cloudflare Workers）。コマンドは worker/ で実行する
│   ├── routes/mcp.ts       Void の route（/mcp だけ）。env.ts の値と X_TOKENS を集めて src/mcp.ts に渡す
│   ├── durable-objects/x-tokens.ts  X_TOKENS の宣言（Void が XTokensDurableObject を作る）
│   ├── env.ts              secret の宣言（void/env。値は void secret）
│   ├── void.config.ts      Worker の設定（名前・互換日・workers.dev・observability）
│   ├── void.lock.json      Void が記録する Durable Object の migration など（commit する）
│   ├── src/
│   │   ├── mcp.ts          MCP の本体（bearer を照合し、POST だけを stateless に MCP で返す）
│   │   ├── server.ts       ツールの登録（名前・説明・入力 schema）
│   │   ├── langfuse.ts     Langfuse（読み取りのみ）
│   │   ├── x.ts            X API の client（投稿・ブックマーク）
│   │   ├── x-state.ts      X の token のローテートとブックマークの既読（storage を差し替えてテストする）
│   │   ├── x-token-store.ts  x-state を持つ Durable Object のクラス
│   │   ├── producthunt.ts  Product Hunt API v2
│   │   ├── time.ts         JST / PT の暦日
│   │   └── app-env.ts      ツールに渡す設定の型と ToolError
│   ├── test/               Vitest（fetch を偽物にして API の呼び方を確かめる）
│   ├── scripts/sync-secrets.sh  fnox → void secret put
│   └── fnox.toml           secret の名前と説明だけ（値は gitignore の fnox.local.toml）
├── camera/                 この Mac で動くカメラの MCP server（Bun）。コマンドは camera/ で実行する
│   ├── src/index.ts        起動（127.0.0.1 にだけ bind、CAMERA_MCP_TOKEN が無ければ起動しない）
│   ├── src/app.ts          MCP の本体とツール camera_capture（bearer を照合し、POST だけを stateless に返す）
│   ├── src/capture.ts      ffmpeg（avfoundation）で 1 枚撮る。device の選択・直列化・時間切れ
│   ├── src/auth.ts         bearer の定数時間比較（worker/src/auth.ts と同じもの）
│   └── test/               bun test（ffmpeg を偽物にする。ffmpeg があればテストパターンで出力指定も確かめる）
└── docs/
    ├── setup.md            Worker のデプロイ・secret・portal 登録
    └── camera.md           カメラの起動・外から呼べる経路を絞る層・portal 登録
```

## セットアップ

ツールは mise で管理している（Void は Node.js 24.22 以上が要る）。

worker/ と camera/ は package・lockfile・CI の job を分けている。片方の変更で他方の依存を触らない。

```bash
mise install
cd worker
bun install
bun run test        # Vitest
bun run typecheck   # void prepare で型を作ってから tsc
bun run build       # vite build（CI と同じ）
bun run dev         # vite dev（ローカルの値は shell か .env で渡す）

cd ../camera
bun install
bun run test        # bun test
bun run typecheck
bun run start       # この Mac のカメラで待つ（docs/camera.md）
```

Void の使い方は `worker/node_modules/void/docs/` を読む（入口は `guide/quickstart.md`、コマンドは `reference/cli.md`）。

Worker の secret は本人が手元で入れ、デプロイは `.github/workflows/deploy.yml` が流す（main へのマージで自動、初回は Run workflow）（[docs/setup.md](docs/setup.md)）。カメラの portal・Tunnel・Gateway の設定は dotfiles の `mcp/cloudflare/` が正本（[docs/camera.md](docs/camera.md)）。

## 技術スタック

- worker: TypeScript、[Void](https://void.cloud)（Vite + Cloudflare Workers への直接デプロイ）、Durable Objects（SQLite）
- MCP: `@modelcontextprotocol/sdk` の Web 標準 Streamable HTTP transport（stateless・JSON 応答）、入力 schema は zod
- camera: Bun（`Bun.serve`）、ffmpeg（avfoundation）、bun test
- bun（パッケージ管理）、Vitest（worker のテスト）

## 規約

- **key の値を扱わない。** リポジトリ・ログ・ツールの応答・エラーメッセージに secret の値を出さない。想定外の例外は種類だけ返し、詳細は Worker のログに出す。fnox.toml には名前と説明だけを書く（public repo）
- **ツールは読み取りを既定にする。** 外部サービスに書き込むツールは足さない。足す必要が出たら、portal の tool 単位の公開設定で絞れるかと合わせて本人に確認する
- **従量課金の API は読む件数を最小にする。** X は読んだ投稿 1 件ごとに課金される。既定のページを小さく保ち、上限で打ち切ったら warnings と truncated で知らせる（黙って切らない）
- **取得の規則は wwwyo/me の daily スキルと揃える。** Langfuse の窓と集計は daily-end の day_sessions.py、X は x_fetch.py、Product Hunt は rss skill の fetch.py が元。挙動を変えたら呼び出し側のスキルも直す
- Worker にツールを足すときは `worker/src/server.ts` に登録し、API の呼び方を fetch の偽物でテストし、`worker/test/mcp.test.ts` のツール一覧と README の表を更新する。secret が増えたら `worker/` の `env.ts`・`src/app-env.ts`・`routes/mcp.ts`・`fnox.toml`・`scripts/sync-secrets.sh`・docs/setup.md を同じ変更で直す
- **Durable Object の名前を変えない。** `worker/durable-objects/x-tokens.ts` の `name` と、`worker/src/server.ts` が使うインスタンス名 `default` を変えると、保存済みの X token と既読を失う。`void.lock.json` の migration は消したり並べ替えたりしない
- **カメラは呼ばれたときだけ撮る。** 常時録画・定期撮影・画像の保存を足さない。`127.0.0.1` 以外への bind、token なしの起動、画面キャプチャの撮影も許さない。外から届く経路を変えるとき（port・portal・Access）は docs/camera.md の層の表と dotfiles の宣言を同じ変更で直す
