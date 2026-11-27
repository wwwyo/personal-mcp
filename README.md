# personal-mcp

[![CI](https://github.com/wwwyo/personal-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/wwwyo/personal-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

自分の API key で Langfuse・X・Product Hunt を呼ぶツールを 1 つにまとめた remote MCP server。[Void](https://void.cloud)（VoidZero）で作って Cloudflare Workers にデプロイし、Cloudflare の MCP Server Portal の後ろにつなぐ。

key は Worker の secret にだけ置き、ツールはサーバー側で API を呼んで結果だけを返す。クラウドで動く agent（定時のルーティンなど）が、key を持たずに自分の活動記録・X の投稿とブックマーク・Product Hunt のランキングを読める。

```text
agent ──OAuth──▶ MCP Server Portal ──Bearer──▶ personal-mcp（Workers）──▶ Langfuse / X / Product Hunt
                                                 └ secret（fnox → void secret put）
```

## ツール

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

## QuickStart

前提: Cloudflare アカウント、[fnox](https://fnox.jdx.dev)、age の鍵。Node.js と bun は mise が入れる。

```bash
mise install && bun install
bunx void connect --platform cloudflare   # ブラウザで Cloudflare にログインし、デプロイ先のアカウントを選ぶ
# fnox.local.toml に値を入れる（docs/setup.md の「secret を入れる」）
bun run secrets:sync                      # fnox で復号して void secret put に流す（初回は deploy より先）
bun run deploy                            # void deploy（build・Durable Object の作成・デプロイ）
```

`MCP_BEARER_TOKEN` を Bearer で付けて `POST https://personal-mcp.<subdomain>.workers.dev/mcp` に `tools/list` を送り、7 つのツールが返れば動いている。portal への登録と各 key の入れ方は [docs/setup.md](docs/setup.md)。

## License

Licensed under the [MIT license](LICENSE).
