import { defineEnv, string, url } from "void/env";

// Worker が読む secret の宣言（値はここに書かない）。名前と説明は fnox.toml と揃える。
// 本番の値は `bun run secrets:sync`（fnox → void secret put）で入れる。
// void deploy は必須の key がリモートに無いと止まる。MCP_BEARER_TOKEN 以外は、
// 無ければそのツールだけが理由を返すので optional にしている。
export default defineEnv({
  MCP_BEARER_TOKEN: string(),
  LANGFUSE_PUBLIC_KEY: string().optional(),
  LANGFUSE_SECRET_KEY: string().optional(),
  // daily-end の Langfuse（JP instance）。違う instance を使うときだけ secret で入れる
  LANGFUSE_BASE_URL: url().default("https://jp.cloud.langfuse.com"),
  X_CLIENT_ID: string().optional(),
  X_CLIENT_SECRET: string().optional(),
  X_REFRESH_TOKEN: string().optional(),
  PRODUCTHUNT_API_TOKEN: string().optional(),
});
