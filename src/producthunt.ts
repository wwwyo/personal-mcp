import { type Env, ToolError, requireSecret } from "./app-env.ts";
import { addDays, dateIn, dayWindow } from "./time.ts";

// wwwyo/me の rss skill（fetch.py の fetch_producthunt）と同じ取り方。
// 票数ランキングは API v2（GraphQL）でしか headless に取れない（leaderboard は Cloudflare の 403）。

const API = "https://api.producthunt.com/v2/api/graphql";
const PT = "America/Los_Angeles";

const QUERY = `
query($after: DateTime, $before: DateTime, $n: Int!) {
  posts(order: VOTES, postedAfter: $after, postedBefore: $before, first: $n) {
    edges { node {
      name tagline description votesCount commentsCount url website createdAt
      user { name }
      topics(first: 5) { edges { node { name } } }
    } }
  }
}`;

interface Node {
  name: string;
  tagline: string;
  description?: string;
  votesCount: number;
  commentsCount: number;
  url: string;
  website?: string;
  createdAt: string;
  user?: { name?: string };
  topics?: { edges?: { node?: { name?: string } }[] };
}

/** date（PT の暦日。省略時は PT の昨日）に投稿された Product Hunt の票数順 Top N */
export async function topPosts(env: Env, opts: { date?: string; n?: number }, fetchImpl: typeof fetch = fetch) {
  const token = requireSecret(env, "PRODUCTHUNT_API_TOKEN");
  const date = opts.date ?? addDays(dateIn(PT), -1);
  const { from, to } = dayWindow(date, PT);
  const n = Math.max(1, Math.min(20, opts.n ?? 5));
  const res = await fetchImpl(API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "personal-mcp/1.0",
    },
    body: JSON.stringify({
      query: QUERY,
      variables: { after: from.toISOString(), before: to.toISOString(), n },
    }),
  });
  if (!res.ok) throw new ToolError(`Product Hunt: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { data?: { posts?: { edges?: { node: Node }[] } }; errors?: unknown };
  if (data.errors) throw new ToolError(`Product Hunt GraphQL: ${JSON.stringify(data.errors).slice(0, 300)}`);
  return {
    date_pt: date,
    posts: (data.data?.posts?.edges ?? []).map(({ node }) => ({
      name: node.name,
      tagline: node.tagline,
      description: node.description ?? "",
      votes: node.votesCount,
      comments: node.commentsCount,
      url: node.url,
      website: node.website ?? null,
      created_at: node.createdAt,
      hunter: node.user?.name ?? null,
      topics: (node.topics?.edges ?? []).map((e) => e.node?.name).filter(Boolean),
    })),
  };
}
