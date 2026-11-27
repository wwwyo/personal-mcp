import { defineHandler } from "void";
import { env } from "void/env";
import type { Env } from "../src/app-env.ts";
import { handleMcp } from "../src/mcp.ts";

// /mcp だけを公開する（それ以外の path は Void が 404 を返す）。
// 認証と method の判定は handleMcp が持つので、POST 以外も同じ handler に通して 401 / 405 を返す
// （Void は export した method しか登録せず、残りは 404 になるため export しておく。
// OPTIONS は handler に届く前に Void が 204 を返す）。
const mcp = defineHandler((c) => {
  const appEnv: Env = {
    MCP_BEARER_TOKEN: env.MCP_BEARER_TOKEN,
    LANGFUSE_PUBLIC_KEY: env.LANGFUSE_PUBLIC_KEY,
    LANGFUSE_SECRET_KEY: env.LANGFUSE_SECRET_KEY,
    LANGFUSE_BASE_URL: env.LANGFUSE_BASE_URL,
    X_CLIENT_ID: env.X_CLIENT_ID,
    X_CLIENT_SECRET: env.X_CLIENT_SECRET,
    X_REFRESH_TOKEN: env.X_REFRESH_TOKEN,
    PRODUCTHUNT_API_TOKEN: env.PRODUCTHUNT_API_TOKEN,
    X_TOKENS: c.env.X_TOKENS as Env["X_TOKENS"],
  };
  return handleMcp(c.req.raw, appEnv);
});

export const POST = mcp;
export const GET = mcp;
export const PUT = mcp;
export const PATCH = mcp;
export const DELETE = mcp;
