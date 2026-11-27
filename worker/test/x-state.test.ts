import { expect, test } from "vitest";
import { TOKEN_ENDPOINT, XState } from "../src/x-state.ts";
import { fakeFetch, json, memoryKV } from "./helpers.ts";

const app = { clientId: "cid", seedRefreshToken: "seed-1" };

function tokenServer() {
  let n = 0;
  return fakeFetch(async (url, init) => {
    expect(url.toString()).toBe(TOKEN_ENDPOINT);
    const body = new URLSearchParams(String(init?.body));
    n++;
    await new Promise((r) => setTimeout(r, 5));
    return json({ access_token: `at-${n}`, refresh_token: `rt-${n}`, expires_in: 7200, scope: "tweet.read", used: body.get("refresh_token") });
  });
}

test("初回は種の refresh token から始め、ローテート後の token を保存する", async () => {
  const kv = memoryKV();
  const { fetch, calls } = tokenServer();
  let now = 1000;
  const s = new XState(kv, fetch, () => now);
  expect(await s.accessToken(app)).toBe("at-1");
  expect(new URLSearchParams(String(calls[0]!.init?.body)).get("refresh_token")).toBe("seed-1");
  // 期限内は refresh しない
  expect(await s.accessToken(app)).toBe("at-1");
  expect(calls).toHaveLength(1);
  // 期限が近づいたら、保存したローテート後の token で refresh する
  now += 7200;
  expect(await s.accessToken(app)).toBe("at-2");
  expect(new URLSearchParams(String(calls[1]!.init?.body)).get("refresh_token")).toBe("rt-1");
});

test("同時の呼び出しは refresh を 1 回にまとめる", async () => {
  const { fetch, calls } = tokenServer();
  const s = new XState(memoryKV(), fetch, () => 1000);
  const got = await Promise.all([s.accessToken(app), s.accessToken(app), s.accessToken(app)]);
  expect(got).toEqual(["at-1", "at-1", "at-1"]);
  expect(calls).toHaveLength(1);
});

test("種を入れ替えたら保存済みの token を捨てて種から取り直す", async () => {
  const kv = memoryKV();
  const { fetch, calls } = tokenServer();
  const s = new XState(kv, fetch, () => 1000);
  await s.accessToken(app);
  expect(await s.accessToken({ ...app, seedRefreshToken: "seed-2" })).toBe("at-2");
  expect(new URLSearchParams(String(calls[1]!.init?.body)).get("refresh_token")).toBe("seed-2");
  // 以後は seed-2 由来の token として扱い、毎回取り直さない
  expect(await s.accessToken({ ...app, seedRefreshToken: "seed-2" })).toBe("at-2");
});

test("refresh の失敗は token を書き換えず、値を含まないメッセージで返す", async () => {
  const kv = memoryKV();
  const { fetch } = fakeFetch(() => json({ error: "invalid_request" }, 400));
  const s = new XState(kv, fetch, () => 1000);
  const err = await s.accessToken(app).catch((e: Error) => e);
  expect(String(err)).toContain("invalid_request");
  expect(String(err)).not.toContain("seed-1");
  expect(kv.data.has("tokens")).toBe(false);
});

test("confidential client は Basic 認証で refresh する", async () => {
  const { fetch, calls } = tokenServer();
  await new XState(memoryKV(), fetch, () => 1000).accessToken({ ...app, clientSecret: "cs" });
  expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa("cid:cs")}`);
});

test("既読は重ねて保存し、walk_complete は一度 true になったら戻らない", async () => {
  const s = new XState(memoryKV());
  await s.markBookmarksSeen(["1", "2"], true);
  const r = await s.markBookmarksSeen(["3", "2"], false);
  expect(r.seen_ids.sort()).toEqual(["1", "2", "3"]);
  expect(r.walk_complete).toBe(true);
});
