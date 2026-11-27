import { handleRequest } from "./app.ts";
import { createCamera } from "./capture.ts";

// loopback にだけ bind する。外からは Cloudflare Tunnel（warp-routing の 127.0.0.1/32）経由で、
// Gateway の L4 policy がこの port だけを通す。LAN の他の端末からは届かない。
const HOST = "127.0.0.1";
const port = Number(process.env.CAMERA_MCP_PORT ?? 47822);
const token = process.env.CAMERA_MCP_TOKEN?.trim() ?? "";

if (token.length < 32) {
  // 未設定・短い token のまま起動すると、loopback の他のプロセスから撮れてしまう
  console.error("CAMERA_MCP_TOKEN が未設定か短すぎる（32 文字以上。docs/camera.md）");
  process.exit(1);
}

const camera = createCamera({ wanted: process.env.CAMERA_DEVICE?.trim() || undefined });
const server = Bun.serve({
  hostname: HOST,
  port,
  // 撮影は数秒かかるので、既定の 10 秒より長く待つ
  idleTimeout: 60,
  fetch: (request) => handleRequest(request, token, camera),
});

console.log(`[camera] listening on http://${server.hostname}:${server.port}/mcp`);
