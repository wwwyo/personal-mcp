import { expect, test } from "vitest";
import { XClient, expandShortUrls, maxId, tweetBodyText } from "../src/x.ts";
import { XState } from "../src/x-state.ts";
import { fakeFetch, json, memoryKV } from "./helpers.ts";

const app = { clientId: "cid", seedRefreshToken: "seed" };

async function storeWithToken() {
  const kv = memoryKV();
  await kv.put("tokens", { access_token: "at", refresh_token: "rt", expires_at: Date.now() / 1000 + 3600, scope: "", seed_hash: "" });
  const s = new XState(kv);
  await s.cacheUser({ id: "42", username: "me" });
  // 種の hash を合わせておかないと「種を入れ替えた」扱いで refresh しに行く
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("seed")))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  await kv.put("tokens", { ...(await kv.get<Record<string, unknown>>("tokens")), seed_hash: hash });
  return s;
}

const tw = (id: string, extra: Record<string, unknown> = {}) => ({ id, text: `t${id}`, created_at: "2026-11-27T00:00:00Z", author_id: "9", ...extra });

test("t.co を展開し、画像の t.co は落とす", () => {
  const text = expandShortUrls("見て https://t.co/a https://t.co/p", {
    urls: [
      { url: "https://t.co/a", expanded_url: "https://example.com", title: "Example" },
      { url: "https://t.co/p", expanded_url: "https://x.com/u/status/1/photo/1" },
    ],
  });
  expect(text).toBe("見て [Example](https://example.com)");
});

test("長文と Articles は本文を補う", () => {
  expect(tweetBodyText({ id: "1", text: "short…", note_tweet: { text: "long body" } })).toBe("long body");
  expect(tweetBodyText({ id: "1", text: "https://t.co/z", article: { title: "記事" } })).toBe("**記事**\n\nhttps://t.co/z");
});

test("id は数値として比べる", () => {
  expect(maxId(["999", "1000"])).toBe("1000");
  expect(maxId([])).toBeNull();
});

test("posts は reply を除き、newest_id は除外前の最大 id", async () => {
  const { fetch, calls } = fakeFetch(() =>
    json({ data: [tw("200", { referenced_tweets: [{ type: "replied_to", id: "1" }] }), tw("150")], meta: {} }),
  );
  const r = await new XClient(await storeWithToken(), app, fetch).posts({ sinceId: "100" });
  expect(r.posts.map((p) => p.id)).toEqual(["150"]);
  expect(r.newest_id).toBe("200");
  expect(r.posts[0]!.url).toBe("https://x.com/me/status/150");
  expect(calls[0]!.url.pathname).toBe("/2/users/42/tweets");
  expect(calls[0]!.url.searchParams.get("since_id")).toBe("100");
});

test("posts を max で切ったら watermark を進めない", async () => {
  const { fetch } = fakeFetch(() => json({ data: [tw("3"), tw("2"), tw("1")], meta: { next_token: "n" } }));
  const r = await new XClient(await storeWithToken(), app, fetch).posts({ max: 2 });
  expect(r.truncated).toBe(true);
  expect(r.newest_id).toBeNull();
  expect(r.posts).toHaveLength(2);
});

test("401 なら一度だけ refresh して再試行する", async () => {
  let n = 0;
  const { fetch } = fakeFetch((url) => {
    if (url.pathname === "/2/oauth2/token") return json({ access_token: "at2", refresh_token: "rt2", expires_in: 7200 });
    n++;
    return n === 1 ? json({}, 401) : json({ data: [], meta: {} });
  });
  // XState の refresh も同じ fake を使う
  const s = new XState(memoryKV(), fetch);
  await s.cacheUser({ id: "42", username: "me" });
  const r = await new XClient(s, app, fetch).posts({});
  expect(r.fetched).toBe(0);
  expect(n).toBe(2);
});

test("bookmarks は辿り切る前は既読でも止まらず、辿り切ったら walk_complete を返す", async () => {
  const s = await storeWithToken();
  await s.markBookmarksSeen(["5"]);
  const pages: Record<string, unknown> = {
    "": { data: [tw("9"), tw("5")], includes: { users: [{ id: "9", username: "a", name: "A" }] }, meta: { next_token: "p2" } },
    p2: { data: [tw("3")], includes: { users: [{ id: "9", username: "a", name: "A" }] }, meta: {} },
  };
  const { fetch, calls } = fakeFetch((url) => json(pages[url.searchParams.get("pagination_token") ?? ""]));
  const r = await new XClient(s, app, fetch).bookmarks({});
  expect(r.bookmarks.map((b) => b.id)).toEqual(["9", "3"]);
  expect(r.walk_complete).toBe(true);
  expect(calls).toHaveLength(2);
  expect(calls[0]!.url.searchParams.get("max_results")).toBe("5");
  // 既読にはまだしていない
  expect((await s.bookmarks()).seen_ids).toEqual(["5"]);
});

test("辿り切った後は既読が混じったページで止まる", async () => {
  const s = await storeWithToken();
  await s.markBookmarksSeen(["5"], true);
  const { fetch, calls } = fakeFetch(() => json({ data: [tw("9"), tw("5")], includes: {}, meta: { next_token: "p2" } }));
  const r = await new XClient(s, app, fetch).bookmarks({});
  expect(r.bookmarks.map((b) => b.id)).toEqual(["9"]);
  expect(calls).toHaveLength(1);
});

test("引用元を解決して添える", async () => {
  const s = await storeWithToken();
  const { fetch } = fakeFetch(() =>
    json({
      data: [tw("9", { referenced_tweets: [{ type: "quoted", id: "7" }] })],
      includes: {
        users: [{ id: "9", username: "a", name: "A" }, { id: "8", username: "q", name: "Q" }],
        tweets: [{ id: "7", text: "元の投稿", author_id: "8" }],
      },
      meta: {},
    }),
  );
  const r = await new XClient(s, app, fetch).bookmarks({});
  expect(r.bookmarks[0]).toMatchObject({ author: { username: "a" }, quoted: { username: "q", text: "元の投稿" } });
});

test("402 と 429 は分かるメッセージにする", async () => {
  const s = await storeWithToken();
  const pay = fakeFetch(() => json({}, 402));
  await expect(new XClient(s, app, pay.fetch).posts({})).rejects.toThrow("クレジット");
  const limited = fakeFetch(() => json({}, 429, { "x-rate-limit-reset": "1764200000" }));
  await expect(new XClient(s, app, limited.fetch).posts({})).rejects.toThrow("rate limit");
});
