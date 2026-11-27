import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isAuthorized } from "./auth.ts";
import type { Env } from "./env.ts";
import { buildServer } from "./server.ts";

export { XTokenStore } from "./x-token-store.ts";

/**
 * 自分の API key で外部サービスを呼ぶ remote MCP server。
 * Cloudflare MCP Server Portal の upstream として、portal が付ける bearer token だけを受ける。
 * stateless（session を持たない）の Streamable HTTP で、POST /mcp ごとに server を作る。
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/mcp") {
      return new Response("not found", { status: 404 });
    }
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
  },
} satisfies ExportedHandler<Env>;
