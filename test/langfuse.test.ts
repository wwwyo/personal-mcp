import { expect, test } from "bun:test";
import type { Env } from "../src/env.ts";
import {
  LangfuseClient,
  assertReadablePath,
  daySessions,
  pickRecord,
  sessionRecords,
  summarizeObservations,
} from "../src/langfuse.ts";
import { fakeFetch, json } from "./helpers.ts";

const env = {
  LANGFUSE_PUBLIC_KEY: "pk",
  LANGFUSE_SECRET_KEY: "sk",
  LANGFUSE_BASE_URL: "https://jp.cloud.langfuse.com",
} as Env;

test("observation を session ごとに畳む", () => {
  const r = summarizeObservations([
    { sessionId: "a", startTime: "2026-11-27T01:00:00Z", endTime: "2026-11-27T01:05:00Z", metadata: { source: "claude-code:1.0", cwd: "/x" } },
    { sessionId: "a", startTime: "2026-11-27T00:30:00Z", metadata: { git_branch: "main", cwd: "/y" } },
    { sessionId: "bad id!", startTime: "2026-11-27T01:00:00Z" },
    { startTime: "2026-11-27T01:00:00Z" },
  ]);
  expect(r.sessions).toHaveLength(1);
  const s = r.sessions[0]!;
  expect(s.first_ts).toBe("2026-11-27T00:30:00Z");
  expect(s.last_ts).toBe("2026-11-27T01:05:00Z");
  expect(s.obs).toBe(2);
  expect(s.sources).toEqual(["claude-code"]);
  expect(s.hints).toEqual({ cwd: "/x", git_branch: "main" });
  expect(r.unsafe_session_ids).toEqual(["bad id!"]);
});

test("最新の記録 comment を選ぶ", () => {
  const rec = pickRecord([
    { id: "1", createdAt: "2026-11-27T01:00:00Z", content: "<!-- session-eval --> old" },
    { id: "2", createdAt: "2026-11-27T03:00:00Z", content: "ただのメモ" },
    { id: "3", createdAt: "2026-11-27T02:00:00Z", content: "<!-- session-eval --> new" },
  ]);
  expect(rec?.id).toBe("3");
});

test("day sessions は JST の窓で cursor を辿る", async () => {
  const { fetch, calls } = fakeFetch((url) =>
    url.searchParams.get("cursor")
      ? json({ data: [{ sessionId: "b", startTime: "2026-11-27T02:00:00Z" }], meta: {} })
      : json({ data: [{ sessionId: "a", startTime: "2026-11-27T01:00:00Z" }], meta: { cursor: "c1" } }),
  );
  const r = await daySessions(new LangfuseClient(env, fetch), "2026-11-27");
  expect(r.sessions.map((s) => s.session_id)).toEqual(["a", "b"]);
  expect(calls[0]!.url.searchParams.get("fromStartTime")).toBe("2026-11-26T15:00:00Z");
  expect(calls[0]!.url.searchParams.get("toStartTime")).toBe("2026-11-27T15:00:00Z");
  expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa("pk:sk")}`);
});

test("ページ上限を超えたら部分一覧を返さない", async () => {
  const { fetch } = fakeFetch((url) => json({ data: [], meta: { cursor: `c${url.searchParams.get("cursor") ?? 0}x` } }));
  await expect(daySessions(new LangfuseClient(env, fetch), "2026-11-27", 2)).rejects.toThrow("max_pages");
});

test("records は session ごとの失敗を他に広げない", async () => {
  const { fetch } = fakeFetch((url) => {
    if (url.pathname === "/api/public/v3/scores") {
      return json({ data: [{ subject: { kind: "session", id: "a" }, value: 1764200000 }], meta: {} });
    }
    if (url.searchParams.get("objectId") === "b") return json({ message: "boom" }, 404);
    return json({ data: [{ id: "c1", createdAt: "2026-11-27T00:00:00Z", content: "<!-- session-eval --> ok" }], meta: { totalItems: 1 } });
  });
  const r = await sessionRecords(new LangfuseClient(env, fetch), ["a", "b"]);
  expect(r.records[0]).toMatchObject({ session_id: "a", evaluated_until: 1764200000, record: { comment_id: "c1" } });
  expect(r.records[1]).toMatchObject({ session_id: "b", record: null });
  expect(r.records[1]!.record_error).toContain("404");
});

test("汎用 GET は /api/public/ 配下だけ", () => {
  expect(() => assertReadablePath("/api/public/projects")).not.toThrow();
  expect(() => assertReadablePath("/api/public/../admin")).toThrow();
  expect(() => assertReadablePath("/api/admin/x")).toThrow();
  expect(() => assertReadablePath("https://evil.example/api/public/x")).toThrow();
});
