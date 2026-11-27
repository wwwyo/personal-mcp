import { expect, test } from "vitest";
import { handleMcp } from "../src/mcp.ts";

const env = { MCP_BEARER_TOKEN: "tok", LANGFUSE_BASE_URL: "https://jp.cloud.langfuse.com" } as never;
const rpc = (body: unknown, auth = "Bearer tok") =>
  new Request("https://personal-mcp.example.workers.dev/mcp", {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify(body),
  });

test("bearer が違えば 401", async () => {
  const res = await handleMcp(rpc({}, "Bearer nope"), env);
  expect(res.status).toBe(401);
});

// /mcp 以外の path は Void のルーティングが 404 にする（routes/mcp.ts だけを置いている）
test("POST 以外は 405", async () => {
  const req = new Request("https://personal-mcp.example.workers.dev/mcp", { headers: { Authorization: "Bearer tok" } });
  const res = await handleMcp(req, env);
  expect(res.status).toBe(405);
  expect(res.headers.get("Allow")).toBe("POST");
});

test("tools/list で全ツールが見える", async () => {
  const res = await handleMcp(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }), env);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { result: { tools: { name: string }[] } };
  expect(body.result.tools.map((t) => t.name).sort()).toEqual([
    "langfuse_day_sessions",
    "langfuse_get",
    "langfuse_session_records",
    "producthunt_top",
    "x_bookmarks",
    "x_bookmarks_mark_seen",
    "x_posts",
  ]);
});

test("secret が無いツールは isError で理由を返す", async () => {
  const res = await handleMcp(
    rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "producthunt_top", arguments: {} } }),
    env,
  );
  const body = (await res.json()) as { result: { isError: boolean; content: { text: string }[] } };
  expect(body.result.isError).toBe(true);
  expect(body.result.content[0]!.text).toContain("PRODUCTHUNT_API_TOKEN");
});
