import { expect, mock, test } from "bun:test";

// Durable Object の基底クラスは workerd にしか無いので差し替える
mock.module("cloudflare:workers", () => ({ DurableObject: class {} }));
const { default: worker } = await import("../src/index.ts");

const env = { MCP_BEARER_TOKEN: "tok", LANGFUSE_BASE_URL: "https://jp.cloud.langfuse.com" } as never;
const rpc = (body: unknown, auth = "Bearer tok") =>
  new Request("https://personal-mcp.example.workers.dev/mcp", {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify(body),
  });

test("bearer が違えば 401", async () => {
  const res = await worker.fetch(rpc({}, "Bearer nope"), env);
  expect(res.status).toBe(401);
});

test("/mcp 以外は 404", async () => {
  const res = await worker.fetch(new Request("https://x.example/"), env);
  expect(res.status).toBe(404);
});

test("tools/list で全ツールが見える", async () => {
  const res = await worker.fetch(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }), env);
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
  const res = await worker.fetch(
    rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "producthunt_top", arguments: {} } }),
    env,
  );
  const body = (await res.json()) as { result: { isError: boolean; content: { text: string }[] } };
  expect(body.result.isError).toBe(true);
  expect(body.result.content[0]!.text).toContain("PRODUCTHUNT_API_TOKEN");
});
