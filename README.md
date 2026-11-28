# personal-mcp

[![CI](https://github.com/wwwyo/personal-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/wwwyo/personal-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

自分用の MCP server を 2 つ持つ repo。

- `worker/`: 自分の API key で Langfuse・X・Product Hunt を呼ぶツールを 1 つにまとめた remote MCP server。[Void](https://void.cloud)（VoidZero）で作って Cloudflare Workers にデプロイする
- `camera/`: この Mac のカメラで手元を 1 枚撮って返すローカルの MCP server。Cloudflare Tunnel 越しに呼ぶ

どちらも Cloudflare の MCP Server Portal（Access 認証）の後ろにつなぐ。デプロイ・起動の手順は別々で、Worker は [docs/setup.md](docs/setup.md)、カメラは [docs/camera.md](docs/camera.md)。

## Worker（worker/）

key は Worker の secret にだけ置き、ツールはサーバー側で API を呼んで結果だけを返す。クラウドで動く agent（定時のルーティンなど）が、key を持たずに自分の活動記録・X の投稿とブックマーク・Product Hunt のランキングを読める。

```text
agent ──OAuth──▶ MCP Server Portal ──Bearer──▶ personal-mcp（Workers）──▶ Langfuse / X / Product Hunt
                                                 └ secret（fnox → void secret put）
```

### ツール

| ツール | 返すもの |
| --- | --- |
| `langfuse_day_sessions` | JST の暦日に動いた agent session の一覧（時刻・cwd・branch） |
| `langfuse_session_records` | session ごとの最新の記録 comment と `evaluated_until` |
| `langfuse_get` | Langfuse public API の読み取り専用 GET（`/api/public/` 配下だけ） |
| `x_posts` | 自分の投稿（`since_id` より新しいもの。reply・RT は既定で除く） |
| `x_bookmarks` | 未読のブックマーク（既定 1 ページ 5 件。課金を抑える） |
| `x_bookmarks_mark_seen` | 書き出し済みのブックマークを既読にする（X には書かない） |
| `producthunt_top` | Product Hunt のその日（太平洋時間）の票数順 Top N |

X 以外は読み取りだけで、X への書き込みもしない。X API は読んだ投稿 1 件ごとの従量課金。

### QuickStart

前提: Cloudflare アカウント、[fnox](https://fnox.jdx.dev)、age の鍵。Node.js と bun は mise が入れる。

```bash
mise install
cd worker && bun install
bunx void connect --platform cloudflare   # ブラウザで Cloudflare にログインし、デプロイ先のアカウントを選ぶ
# fnox.local.toml に値を入れる（docs/setup.md の「secret を入れる」）
bun run secrets:sync                      # fnox で復号して void secret put に流す（初回は deploy より先）
gh workflow run deploy.yml -R wwwyo/personal-mcp  # Actions が void deploy（以後は main へのマージで自動）
```

`MCP_BEARER_TOKEN` を Bearer で付けて `POST https://personal-mcp.<subdomain>.workers.dev/mcp` に `tools/list` を送り、7 つのツールが返れば動いている。portal への登録と各 key の入れ方は [docs/setup.md](docs/setup.md)。

## カメラ（camera/）

| ツール | 返すもの |
| --- | --- |
| `camera_capture` | この Mac のカメラで撮った静止画 1 枚（JPEG の image content）。呼ばれたときだけ撮り、録画も保存もしない |

```bash
cd camera && bun install
bun run start   # 127.0.0.1:47822 で待つ。token は MISE_ENV=camera-mcp の mise から読む
```

最初の撮影で、起動した terminal へのカメラ許可を macOS が求める。Tunnel・Gateway・portal の構成と、外から呼べる経路を絞っている層は [docs/camera.md](docs/camera.md)。

## License

Licensed under the [MIT license](LICENSE).
