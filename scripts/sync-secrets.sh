#!/usr/bin/env bash
# fnox で復号した値を、そのまま Void（Cloudflare Worker）の secret に流し込む。
#
#   ./scripts/sync-secrets.sh                 # fnox.toml の全 secret
#   ./scripts/sync-secrets.sh X_REFRESH_TOKEN # 指定したものだけ
#
# この script は値を変数から `void secret put` の stdin に渡すだけで、画面・引数・repo 内のファイルには出さない。
# ただし void 1.11.0 は送信のあいだ値を OS の一時ディレクトリの body.json（mode 0600）に書き、終わると消す。
# 先に `bunx void connect --platform cloudflare` で Cloudflare を選んでおく。
# 初回は deploy の前に流す（void deploy は env.ts の必須 key がリモートに無いと止まる。
# まだ deploy していない Worker には draft として secret が置かれる）。
set -euo pipefail
cd "$(dirname "$0")/.."

# fnox.toml は public。provider や value（暗号文）が紛れ込んでいたら流し込む前に止める
if grep -Eq '^[^#]*\b(provider|value)[[:space:]]*=' fnox.toml; then
  echo "fnox.toml に provider / value がある。値は fnox.local.toml に移してから実行する" >&2
  exit 1
fi
if git ls-files --error-unmatch fnox.local.toml >/dev/null 2>&1; then
  echo "fnox.local.toml が git の管理下にある。git rm --cached fnox.local.toml で外してから実行する" >&2
  exit 1
fi

required=(MCP_BEARER_TOKEN LANGFUSE_PUBLIC_KEY LANGFUSE_SECRET_KEY X_CLIENT_ID X_REFRESH_TOKEN PRODUCTHUNT_API_TOKEN)
optional=(X_CLIENT_SECRET)

if (($# > 0)); then
  names=("$@")
else
  names=("${required[@]}" "${optional[@]}")
fi

void_bin=node_modules/.bin/void
if [[ ! -x "$void_bin" ]]; then
  echo "void が無い。先に bun install する" >&2
  exit 1
fi

for name in "${names[@]}"; do
  # void secret put は env.ts で宣言した key しか受けない。宣言漏れは値を読む前に止める
  if ! grep -Eq "^[[:space:]]*${name}:" env.ts; then
    echo "error $name が env.ts に無い（env.ts・fnox.toml・この script を揃える）" >&2
    exit 1
  fi
  if ! value=$(fnox get "$name" 2>/dev/null) || [[ -z "$value" ]]; then
    if [[ " ${optional[*]} " == *" $name "* ]]; then
      echo "skip  $name（未設定。任意）"
      continue
    fi
    echo "error $name を fnox から取れない（fnox.local.toml に入れたか確認する）" >&2
    exit 1
  fi
  printf '%s' "$value" | "$void_bin" secret put "$name" >/dev/null
  unset value
  echo "put   $name"
done
