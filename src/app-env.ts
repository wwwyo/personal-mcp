import type { XTokenStore } from "./x-token-store.ts";

/**
 * ツールが読む設定とバインディング。routes/mcp.ts が組み立てて渡す。
 * secret は root の env.ts で宣言し、値は void secret（scripts/sync-secrets.sh が fnox から流し込む）。
 * X_TOKENS は durable-objects/x-tokens.ts から Void が作る binding。
 */
export interface Env {
  /** portal（Cloudflare MCP Server Portal）がこの Worker を呼ぶときの bearer token */
  MCP_BEARER_TOKEN: string;

  LANGFUSE_PUBLIC_KEY?: string;
  LANGFUSE_SECRET_KEY?: string;
  /** env.ts の既定値（https://jp.cloud.langfuse.com）。secret で上書きできる */
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
    throw new ToolError(`${String(name)} が未設定（void secret put ${String(name)}）`);
  }
  return v.trim();
}
