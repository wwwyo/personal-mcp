# カメラ（camera/）の起動と portal 登録

電子工作中の手元を、カメラ越しに Claude に見てもらうためのローカル MCP server。この Mac で動き、ツール `camera_capture` が呼ばれたときだけカメラで 1 枚撮り、JPEG を MCP の image content で返す。録画も保存もしない。

クラウドの Worker（`worker/`）とは別物で、デプロイは無い。この Mac で起動しておくと、Cloudflare Tunnel 越しに MCP Server Portal（`mcp-media.wwwyo.dev`）から呼べる。

```text
agent ──OAuth──▶ MCP Server Portal（Access: 本人のメールだけ）
                   └─Bearer─▶ Gateway（L4: 127.0.0.1 は 47822 だけ通す）
                                └─▶ Tunnel ─▶ この Mac の 127.0.0.1:47822/mcp ─▶ ffmpeg ─▶ カメラ
```

## 外から呼べる経路を絞っている層

カメラを外から動かせるので、portal の Access を通った呼び出し以外は届かないようにしている。

| 層 | 何を止めるか |
| --- | --- |
| `127.0.0.1` にだけ bind | LAN の他の端末から直接は届かない |
| bearer token（`CAMERA_MCP_TOKEN`） | この Mac の他のプロセスや、Tunnel の経路に token なしで来た呼び出しを 401 にする。portal だけが同じ値を持つ。32 文字未満なら起動しない |
| Tunnel はリモート管理で ingress を持たない | Tunnel に公開 hostname は無く、届くのは warp-routing（`127.0.0.1/32` の route）経由の private な通信だけ |
| Gateway の L4 network policy | `127.0.0.1` 宛ては 47822 以外を block する（route は IP 単位なので port はここで絞る） |
| Access（portal と server の app） | 本人のメールだけを Allow。server の app は session 1h |

撮影は呼ばれたときだけで、同時に呼ばれても 1 枚ずつ順に撮る。画面キャプチャ（avfoundation の `Capture screen N`）は指定されても選ばない。ffmpeg の生のエラーはこの Mac のログにだけ出し、ツールの応答には理由の要約だけを返す。

## 起動する

前提:

- ffmpeg は dotfiles の global mise config が exact pin で入れている（`asdf:mise-plugins/mise-ffmpeg`）。この repo の mise に置かないのは、CI（Linux）にソースビルドの ffmpeg を入れさせないため
- token は `~/.config/mise/config.camera-mcp.toml` の `CAMERA_MCP_TOKEN`（age。dotfiles が正本）。`MISE_ENV=camera-mcp` のときだけ復号され、通常の shell には入らない
- Tunnel は dotfiles の LaunchAgent `dev.wwwyo.mcp-tunnel` が常駐させている

```bash
cd camera
bun install
bun run start      # MISE_ENV=camera-mcp mise exec -- bun src/index.ts
```

Orca の terminal など、普段使う terminal から起動する。macOS のカメラ許可は起動した app（terminal）に付くので、**最初の撮影で出る許可ダイアログを許可する**（これだけが手作業）。断ってしまったら「システム設定 → プライバシーとセキュリティ → カメラ」でその app を有効にする。許可が無いと、ツールは「撮影に失敗した（カメラの使用許可が無い…）」を返す。

使わないときは止める（Ctrl-C）。止めている間は portal の server が `error` になるが、他の server には影響しない。カメラを載せている portal `media`（`mcp-media.wwwyo.dev`）は、普段の portal `wwwyo`（`mcp.wwwyo.dev`）とは別。そのため `wwwyo` だけにつないでいる agent からは撮れない。ただし `media` に一度ログインした grant は、同じ client で動く無人の agent（Orca automation など）も引き継ぐ。起動したままにすると、その間はそれらの agent からも撮れる。

| env | 既定 | 用途 |
| --- | --- | --- |
| `CAMERA_DEVICE` | 画面キャプチャ以外の先頭 | 外付けカメラを使うときに、その名前（完全一致）を入れる。名前は `ffmpeg -f avfoundation -list_devices true -i ""` で見る |
| `CAMERA_MCP_PORT` | `47822` | 変えるときは Gateway policy と portal の server も直す |

手元での確認（値は画面に出さない）:

```bash
cd camera
MISE_ENV=camera-mcp mise exec -- sh -c 'curl -sS -X POST http://127.0.0.1:47822/mcp \
  -H "Authorization: Bearer $CAMERA_MCP_TOKEN" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}"'
```

## portal 側の設定

Cloudflare 側は作成済み。portal・server・Access app は dotfiles の `mcp/cloudflare/` の宣言が正本で、`apply.py` で差分を確かめる（使い方は dotfiles の AGENTS.md、構成は dev-env skill の mcp-portal reference）。

| 種類 | 値 |
| --- | --- |
| MCP server | `camera`（ID に `-` を入れない）、`hostname: http://127.0.0.1:47822/mcp`、`auth_type: bearer`、`secure_web_gateway: true`（private な upstream なので Gateway・Tunnel を通す）。宣言は `servers/camera.json` |
| Access app | `Camera MCP server`（type `mcp`、本人のメールだけ、session 1h）。宣言は `access/apps/camera.json` |
| portal | `media`（`mcp-media.wwwyo.dev`、Code Mode `off`）に `on_behalf: false` で載せている。Code Mode の execute を通すと image content が base64 の文字列になり、出力上限で切れて画像として届かないため、Code Mode が既定の `wwwyo` から分けた。Access app は本人のメールだけ |
| Gateway network policy | `Loopback via tunnel: only camera MCP port`（`net.dst.ip in {127.0.0.1} and not(net.dst.port in {47822})` を block）。宣言には未収録 |
| Tunnel | 既存のリモート管理 Tunnel（warp-routing、`127.0.0.1/32` の route）を使う。宣言には未収録 |

token を替えるときは、dotfiles の宣言の `credential_env` から portal に送り直す。

```bash
R="$(security find-generic-password -a "$USER" -s mise-age-key -w | age-keygen -y)"
openssl rand -hex 32 | tr -d '\n' | mise set --file ~/.config/mise/config.camera-mcp.toml \
  --age-encrypt --age-recipient "$R" --stdin CAMERA_MCP_TOKEN
cd ~/src/github.com/wwwyo/dotfiles
MISE_ENV=camera-mcp mise exec -- python3 mcp/cloudflare/apply.py --apply --rotate-credentials camera
```

暗号文が変わるので、`~/.config/mise/config.camera-mcp.toml` を dotfiles の `home/dot_config/mise/` にも写して commit する。カメラサーバーは起動し直す。

## client から使う

client に `https://mcp-media.wwwyo.dev/mcp` を別の MCP server（コネクタ）として足し、本人のメールでログインする。Code Mode が無いので、`camera_capture` が直接の tool として見え、写真は image content のまま届く。portal に server を足したときは、既存の接続（grant）からは新しい server が見えないので、接続を切ってログインし直す（claude.ai はコネクタの切断と再接続、Claude Code は `/mcp`）。
