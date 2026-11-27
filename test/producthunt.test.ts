import { expect, test } from "bun:test";
import type { Env } from "../src/env.ts";
import { topPosts } from "../src/producthunt.ts";
import { fakeFetch, json } from "./helpers.ts";

test("PT の暦日で票数順に取る", async () => {
  const { fetch, calls } = fakeFetch(() =>
    json({
      data: {
        posts: {
          edges: [
            {
              node: {
                name: "Foo", tagline: "t", votesCount: 10, commentsCount: 2, url: "https://www.producthunt.com/posts/foo",
                createdAt: "2026-11-26T08:01:00Z", topics: { edges: [{ node: { name: "AI" } }] },
              },
            },
          ],
        },
      },
    }),
  );
  const r = await topPosts({ PRODUCTHUNT_API_TOKEN: "t" } as Env, { date: "2026-11-26" }, fetch);
  expect(r.posts[0]).toMatchObject({ name: "Foo", votes: 10, topics: ["AI"] });
  const body = JSON.parse(String(calls[0]!.init?.body));
  expect(body.variables).toEqual({ after: "2026-11-26T08:00:00.000Z", before: "2026-11-27T08:00:00.000Z", n: 5 });
});

test("token が無ければ呼ばずに失敗する", async () => {
  const { fetch, calls } = fakeFetch(() => json({}));
  await expect(topPosts({} as Env, {}, fetch)).rejects.toThrow("PRODUCTHUNT_API_TOKEN");
  expect(calls).toHaveLength(0);
});
