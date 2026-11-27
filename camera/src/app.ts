import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { isAuthorized } from "./auth.ts";
import { type Camera, CaptureError } from "./capture.ts";

/**
 * この Mac のカメラで手元を 1 枚撮って返す MCP server。
 * Cloudflare Tunnel 越しに MCP Server Portal（Access）からだけ呼ばれる想定で、
 * portal が付ける bearer token を照合する。stateless の Streamable HTTP で、POST ごとに server を作る。
 */
export function buildServer(camera: Camera): McpServer {
  const server = new McpServer({ name: "personal-mcp-camera", version: "0.1.0" });
  server.registerTool(
    "camera_capture",
    {
      title: "カメラ: 手元を 1 枚撮る",
      description:
        "この Mac のカメラで静止画を 1 枚撮り、JPEG を image content で返す（電子工作中の手元を見るためのもの）。呼ばれたときだけ撮り、録画も保存もしない。撮影には 1〜3 秒かかる。",
      inputSchema: {
        width: z.number().int().min(320).max(1920).optional().describe("画像の幅（px）。既定 1280"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ width }) => {
      try {
        const { jpeg, device } = await camera.capture(width ?? 1280);
        console.log(`[camera] captured ${jpeg.length} bytes from "${device}" at ${new Date().toISOString()}`);
        return {
          content: [
            { type: "image", data: Buffer.from(jpeg).toString("base64"), mimeType: "image/jpeg" },
            { type: "text", text: `撮影: ${new Date().toISOString()}（${device}）` },
          ],
        };
      } catch (e) {
        const msg = e instanceof CaptureError ? e.message : "撮影中に想定外のエラー（カメラサーバーのログを見る）";
        if (!(e instanceof CaptureError)) console.error(e);
        return { content: [{ type: "text", text: msg }], isError: true };
      }
    },
  );
  return server;
}

export async function handleRequest(request: Request, token: string, camera: Camera): Promise<Response> {
  if (new URL(request.url).pathname !== "/mcp") {
    return new Response("not found", { status: 404 });
  }
  if (!(await isAuthorized(request.headers.get("Authorization"), token))) {
    return new Response("unauthorized", { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  }
  if (request.method !== "POST") {
    // stateless なので SSE の GET と session の DELETE は持たない
    return new Response("method not allowed", { status: 405, headers: { Allow: "POST" } });
  }
  const server = buildServer(camera);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}
