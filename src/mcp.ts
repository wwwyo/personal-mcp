import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isAuthorized } from "./auth.ts";
import type { Env } from "./app-env.ts";
import { buildServer } from "./server.ts";

/**
 * 自分の API key で外部サービスを呼ぶ remote MCP server の本体（routes/mcp.ts が /mcp で呼ぶ）。
 * Cloudflare MCP Server Portal の upstream として、portal が付ける bearer token だけを受ける。
 * stateless（session を持たない）の Streamable HTTP で、POST ごとに server を作る。
 */
export async function handleMcp(request: Request, env: Env): Promise<Response> {
  if (!(await isAuthorized(request.headers.get("Authorization"), env.MCP_BEARER_TOKEN))) {
    return new Response("unauthorized", { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  }
  if (request.method !== "POST") {
    // stateless なので SSE の GET と session の DELETE は持たない
    return new Response("method not allowed", { status: 405, headers: { Allow: "POST" } });
  }
  const server = buildServer(env);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}
