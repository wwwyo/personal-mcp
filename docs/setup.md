# セットアップ

key の値はリポジトリに置かない。手元では fnox（gitignore 済みの `fnox.local.toml`）が持ち、`scripts/sync-secrets.sh` が復号して `void secret put` で Worker の secret に流す。Worker は普通の secret を読むだけで、fnox は動かさない。

この repo は [Void](https://void.cloud)（VoidZero）のアプリで、`void deploy` が自分の Cloudflare アカウントへ直接デプロイする。Worker の設定は `void.config.ts`、Void が記録する Durable Object の migration などは `void.lock.json`（どちらも commit する）。secret の宣言は root の `env.ts`。

初回の順番は「Cloudflare につなぐ → secret を入れる → デプロイ」。`void deploy` は `env.ts` の必須 key（`MCP_BEARER_TOKEN`）がリモートに無いと止まるので、secret を先に入れる。

## 1. Cloudflare につなぐ

```bash
mise install && bun install
bunx void connect --platform cloudflare
```

ブラウザで Cloudflare にログインし、デプロイ先のアカウントを選ぶ（ブラウザが開かなければ表示された URL とコードで承認する）。セッションは `bunx void cloudflare status` / `logout` で確認・破棄できる。

`LANGFUSE_BASE_URL` は `env.ts` の既定値で daily-end と同じ JP instance（`https://jp.cloud.langfuse.com`）にしてある。別の instance を使うときだけ secret で入れる。

**以前 wrangler でこの Worker をデプロイしたことがある場合**は、先に Cloudflare のダッシュボードで Worker `personal-mcp` を削除する。Void 版は X の token を持つ Durable Object を `XTokensDurableObject`（binding `X_TOKENS`）として作り直しており、wrangler 版の `XTokenStore` とその中身（ローテート後の X token・ブックマークの既読）は引き継がない。削除したら X の refresh token は下の手順で取り直して入れる。

## 2. secret を入れる

入れる secret の名前と説明は [fnox.toml](../fnox.toml)、Worker 側の宣言は [env.ts](../env.ts)。値は `fnox.local.toml` に age で暗号化して置く。`fnox set` は何も指定しないと cwd の `fnox.toml` に書くので、必ず `-c ./fnox.local.toml` を付ける（`fnox.toml` に `provider` / `value` があると `sync-secrets.sh` は止まる）。

`fnox.local.toml` の先頭に age の provider を書く（recipient は自分の age 公開鍵。復号鍵は fnox のいつもの設定から）。

```toml
[providers.age]
type = "age"
recipients = ["age1..."]
```

値は画面に出さず、パイプで `fnox set` に渡す。

```bash
s() { fnox -c ./fnox.local.toml set "$1" --provider age; }

# portal との間の bearer token は新しく作る
fnox -c ./fnox.local.toml set MCP_BEARER_TOKEN --provider age --generate --generate-type hex --length 64

# いま mise にある key をそのまま移す（global mise の Langfuse、me の Product Hunt と X の Client ID / Secret）
mise exec -C ~ -- printenv LANGFUSE_PUBLIC_KEY | s LANGFUSE_PUBLIC_KEY
mise exec -C ~ -- printenv LANGFUSE_SECRET_KEY | s LANGFUSE_SECRET_KEY
mise exec -C ~/src/github.com/wwwyo/me -- printenv PRODUCTHUNT_API_TOKEN | s PRODUCTHUNT_API_TOKEN
mise exec -C ~/src/github.com/wwwyo/me -- printenv X_CLIENT_ID | s X_CLIENT_ID
mise exec -C ~/src/github.com/wwwyo/me -- printenv X_CLIENT_SECRET | s X_CLIENT_SECRET   # confidential client のときだけ
```

X の refresh token は me の `x_auth.py` が age で暗号化して持っている。復号してそのまま渡す。

```bash
me=~/src/github.com/wwwyo/me/.agents/skills/daily-end/tools/x
age -d -i <(security find-generic-password -a "$USER" -s mise-age-key -w) "$me/.x-tokens.local.age" \
  | jq -r .refresh_token | s X_REFRESH_TOKEN
```

**X の refresh token は 1 本を共有できない。** X は refresh のたびに refresh token をローテートし、古い方を失効させる。Worker が一度 refresh すると、手元の `x_fetch.py` が持つ token は使えなくなる（逆も同じ）。手元の daily-end から X の取得を外す時点で入れる。手元も残すなら、`x_auth.py login` をもう一度通して別の token を作り、そちらを渡す。

最後に Worker へ流す。`sync-secrets.sh` は値を `void secret put` の stdin に渡すだけで、画面・引数・repo 内のファイルには出さない。ただし void（1.11.0）自身は送信のあいだ値を OS の一時ディレクトリの `body.json`（mode 0600）に書き、送信後に消す。まだデプロイしていない Worker には draft として置かれる。

```bash
bun run secrets:sync                    # 全部
./scripts/sync-secrets.sh X_REFRESH_TOKEN  # 1 つだけ入れ直す
bunx void secret list                   # 入った secret の名前を確かめる（値は出ない）
```

`env.ts` に宣言していない名前は `void secret put` が受け付けない。secret を足すときは `env.ts`・`fnox.toml`・`scripts/sync-secrets.sh` を一緒に直す。

## 3. デプロイする

```bash
bun run deploy   # void deploy
```

Void が build し、Durable Object（`XTokensDurableObject`）を作り、新しい version の readiness を確かめてから切り替える。最後に `https://personal-mcp.<subdomain>.workers.dev` が表示される。デプロイで `void.lock.json` が変わったら commit する（Durable Object の migration 履歴。消したり並べ替えたりしない）。

デプロイの状態と巻き戻しは `bunx void project status` / `bunx void project rollback`、ログは `bunx void project logs`。

Worker は `X_REFRESH_TOKEN` を種として一度使い、以後はローテート後の token を Durable Object に持つ。`X_REFRESH_TOKEN` に別の値を入れ直すと、Durable Object の token を捨ててその種から取り直す（refresh token が失効したときの入れ直し）。同じ値を流し直しても何も起きない。

## 4. portal につなぐ

MCP の設定は dotfiles の `mcp/cloudflare/` が正本なので、そこで宣言して反映する（手順は dotfiles の AGENTS.md と dev-env skill の mcp-portal）。この server の値は次のとおり。

- server: `auth_type: bearer`、`hostname: https://personal-mcp.<subdomain>.workers.dev/mcp`、credential は `MCP_BEARER_TOKEN` と同じ値（portal は `Authorization: Bearer <値>` を付けて呼ぶ）
- server ID は `-` を含めない（例 `personal`）。portal は tool 名を `<server ID>_<tool 名>` で扱い、`-` があると ChatGPT からの呼び出しが失敗する
- portal 側は `on_behalf: false`（共有 credential の bearer）
- Langfuse の記録や X のブックマークは私的なデータなので、どの portal に載せるか（`mcp.wwwyo.dev` か専用の portal か）は載せる前に決める

credential を apply.py に渡すときも fnox から流す。

```bash
fnox exec -- sh -c 'cd ~/src/github.com/wwwyo/dotfiles && mise exec -- python3 mcp/cloudflare/apply.py --apply --rotate-credentials personal'
```

（宣言の `credential_env` を `MCP_BEARER_TOKEN` にした場合。）

## 確認

```bash
fnox exec -- sh -c 'curl -sS https://personal-mcp.<subdomain>.workers.dev/mcp \
  -H "Authorization: Bearer $MCP_BEARER_TOKEN" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}"'
```

`langfuse_day_sessions` のような実 API を呼ぶ確認は、課金のない Langfuse・Product Hunt から始める。X は 1 回ごとに課金される。

## ブックマークの既読

`x_bookmarks` は未読だけを返し、既読にはしない。呼び出し側が `daily/<date>/bookmarks.md` に書き出してから、返った id と `walk_complete` を `x_bookmarks_mark_seen` に渡す。書き出しの前に落ちても次回また同じものが返る。

最初の 1 回は Worker に既読が無いので、ブックマークを先頭から最大 50 ページ（250 件）読む。手元の `.x-state.local.json` の `seen_ids` を `x_bookmarks_mark_seen` に `walk_complete: true` で渡しておくと、その分を読まずに済む。
