import type { XTokenStore } from "./x-token-store.ts";

/** Worker のバインディング。値はすべて wrangler secret（scripts/sync-secrets.sh が fnox から流し込む）か wrangler.jsonc の vars。 */
export interface Env {
  /** portal（Cloudflare MCP Server Portal）がこの Worker を呼ぶときの bearer token */
  MCP_BEARER_TOKEN: string;

  LANGFUSE_PUBLIC_KEY?: string;
  LANGFUSE_SECRET_KEY?: string;
  /** vars。例: https://jp.cloud.langfuse.com */
  LANGFUSE_BASE_URL: string;

  X_CLIENT_ID?: string;
  /** confidential client のときだけ */
  X_CLIENT_SECRET?: string;
  /** 初回だけ使う種。以後のローテート後の token は Durable Object が持つ */
  X_REFRESH_TOKEN?: string;
  X_TOKENS: DurableObjectNamespace<XTokenStore>;

  PRODUCTHUNT_API_TOKEN?: string;
}

/** ツールが利用者向けに返すエラー。メッセージに secret の値を含めない。 */
export class ToolError extends Error {}

export function requireSecret(env: Env, name: keyof Env): string {
  const v = env[name];
  if (typeof v !== "string" || v.trim() === "") {
    throw new ToolError(`${String(name)} が未設定（wrangler secret put ${String(name)}）`);
  }
  return v.trim();
}
