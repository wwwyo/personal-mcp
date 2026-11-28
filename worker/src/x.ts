import { ToolError } from "./app-env.ts";
import type { BookmarksState, XAppConfig } from "./x-state.ts";

// wwwyo/me の daily-end の x_fetch.py と同じ API・同じ課金上の配慮で取る。
// 課金は「読んだ投稿 1 件ごと」。bookmarks は since_id が無く毎回先頭から読むので、
// 既定ページは API 下限の 5 件にし、ページが丸ごと新規のときだけ次を読む。

const API_BASE = "https://api.x.com";
const BOOKMARKS_PAGE = 5;
const BOOKMARKS_MAX_PAGES = 10;
/** 一度も辿り切っていない間（初回）の上限 */
const BOOKMARKS_WALK_MAX_PAGES = 50;
const POSTS_TWEET_FIELDS = "created_at,public_metrics,referenced_tweets,note_tweet,entities,article";
const BOOKMARK_TWEET_FIELDS = "created_at,note_tweet,entities,referenced_tweets,article";

/** Durable Object の RPC と XState が満たす形 */
export interface XStore {
  accessToken(app: XAppConfig, force?: boolean): Promise<string>;
  cachedUser(): Promise<{ id: string; username: string } | undefined>;
  cacheUser(user: { id: string; username: string }): Promise<void>;
  bookmarks(): Promise<BookmarksState>;
  markBookmarksSeen(ids: string[], walkComplete?: boolean): Promise<BookmarksState>;
}

type Json = Record<string, unknown>;
interface UrlEntity {
  url?: string;
  expanded_url?: string;
  media_key?: string;
  title?: string;
}
interface Tweet {
  id: string;
  text?: string;
  created_at?: string;
  author_id?: string;
  entities?: { urls?: UrlEntity[] };
  note_tweet?: { text?: string; entities?: { urls?: UrlEntity[] } };
  article?: { title?: string };
  referenced_tweets?: { type: string; id: string }[];
  public_metrics?: Json;
}
interface User {
  id: string;
  username: string;
  name: string;
}

/** 本文の t.co を展開する。画像・動画の t.co は投稿自身の permalink になるので落とす */
export function expandShortUrls(text: string, entities?: { urls?: UrlEntity[] }): string {
  let out = text;
  for (const u of entities?.urls ?? []) {
    if (!u.url || !out.includes(u.url)) continue;
    const expanded = u.expanded_url ?? "";
    if (u.media_key || expanded.includes("/photo/") || expanded.includes("/video/")) {
      out = out.replaceAll(u.url, "");
      continue;
    }
    if (!expanded) continue;
    const title = (u.title ?? "").trim();
    out = out.replaceAll(u.url, title ? `[${title}](${expanded})` : expanded);
  }
  return out.trim();
}

/** 長文（note_tweet）は切られていない方を使い、Articles はタイトルを前置する */
export function tweetBodyText(t: Tweet): string {
  const body = t.note_tweet?.text
    ? expandShortUrls(t.note_tweet.text, t.note_tweet.entities)
    : expandShortUrls(t.text ?? "", t.entities);
  const title = t.article?.title;
  return title ? `**${title}**\n\n${body}`.trimEnd() : body;
}

export function shouldExclude(t: Tweet, includeReplies: boolean, includeRetweets: boolean): boolean {
  const types = new Set((t.referenced_tweets ?? []).map((r) => r.type));
  return (!includeReplies && types.has("replied_to")) || (!includeRetweets && types.has("retweeted"));
}

/** tweet id は 64bit 整数の文字列。数値として大小を比べる */
export function maxId(ids: string[]): string | null {
  let best: bigint | null = null;
  for (const id of ids) {
    const v = BigInt(id);
    if (best === null || v > best) best = v;
  }
  return best === null ? null : best.toString();
}

function clampPage(n: number | undefined, fallback: number): number {
  return Math.max(5, Math.min(100, n ?? fallback));
}

export class XClient {
  #store: XStore;
  #app: XAppConfig;
  #fetch: typeof fetch;

  constructor(store: XStore, app: XAppConfig, fetchImpl: typeof fetch = fetch) {
    this.#store = store;
    this.#app = app;
    // Workers の fetch は this が globalThis 以外だと TypeError（Illegal invocation）になるので、
    // メソッドとして呼ばれないよう包む
    this.#fetch = (input, init) => fetchImpl(input, init);
  }

  async #get(path: string, params: Record<string, string | number | undefined>): Promise<Json> {
    const url = new URL(API_BASE + path);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.#store.accessToken(this.#app, attempt > 0);
      const res = await this.#fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401 && attempt === 0) continue; // 失効していたら一度だけ refresh して再試行
      if (res.ok) return (await res.json()) as Json;
      if (res.status === 402) throw new ToolError("X API のクレジットが尽きた（Developer Console で購入）");
      if (res.status === 429) {
        const reset = Number(res.headers.get("x-rate-limit-reset"));
        const at = Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toISOString() : "不明";
        throw new ToolError(`X API の rate limit（復帰 ${at}）。リトライせずに待つ`);
      }
      throw new ToolError(`X GET ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    }
    throw new ToolError(`X GET ${path}: refresh 後も 401`);
  }

  /** /2/users/me は課金対象なので、id は一度解決したら Durable Object に置く */
  async me(): Promise<{ id: string; username: string }> {
    const cached = await this.#store.cachedUser();
    if (cached) return cached;
    const d = (await this.#get("/2/users/me", {})).data as User;
    const user = { id: d.id, username: d.username };
    await this.#store.cacheUser(user);
    return user;
  }

  /**
   * 自分の投稿。since_id は呼び出し側（me の output/x/.posts-watermark）が持つ。
   * newest_id は reply/RT を除外する前の全件の最大 id で、truncated のときは null（進めると取りこぼす）。
   */
  async posts(opts: { sinceId?: string; max?: number; includeReplies?: boolean; includeRetweets?: boolean }) {
    const me = await this.me();
    const all: Tweet[] = [];
    let next: string | undefined;
    do {
      const page = await this.#get(`/2/users/${me.id}/tweets`, {
        "tweet.fields": POSTS_TWEET_FIELDS,
        max_results: clampPage(opts.max, 100),
        since_id: opts.sinceId,
        pagination_token: next,
      });
      all.push(...((page.data as Tweet[] | undefined) ?? []));
      next = (page.meta as Json | undefined)?.next_token as string | undefined;
    } while (next && !(opts.max && all.length >= opts.max));
    const truncated = Boolean(opts.max) && (next !== undefined || all.length > (opts.max ?? 0));
    const kept = opts.max ? all.slice(0, opts.max) : all;
    const newest = truncated ? null : (maxId(all.map((t) => t.id)) ?? opts.sinceId ?? null);
    return {
      username: me.username,
      newest_id: newest,
      truncated,
      fetched: all.length,
      posts: kept
        .filter((t) => !shouldExclude(t, Boolean(opts.includeReplies), Boolean(opts.includeRetweets)))
        .map((t) => ({
          id: t.id,
          created_at: t.created_at,
          url: `https://x.com/${me.username}/status/${t.id}`,
          text: tweetBodyText(t),
          referenced_types: (t.referenced_tweets ?? []).map((r) => r.type),
          public_metrics: t.public_metrics,
        })),
    };
  }

  /**
   * 未読の bookmark。既読（Durable Object の seen_ids と known_ids）は返さない。
   * 既読にはしないので、書き出しが済んだら x_bookmarks_mark_seen で既読にする。
   */
  async bookmarks(opts: { knownIds?: string[]; pageSize?: number; maxPages?: number }) {
    const me = await this.me();
    const state = await this.#store.bookmarks();
    const seen = new Set([...state.seen_ids, ...(opts.knownIds ?? [])]);
    const maxPages = opts.maxPages ?? (state.walk_complete ? BOOKMARKS_MAX_PAGES : BOOKMARKS_WALK_MAX_PAGES);
    const fresh: Json[] = [];
    let next: string | undefined;
    let pages = 0;
    let reachedEnd = false;
    let hitCap = false;
    while (true) {
      const resp = await this.#get(`/2/users/${me.id}/bookmarks`, {
        "tweet.fields": BOOKMARK_TWEET_FIELDS,
        expansions: "author_id,referenced_tweets.id,referenced_tweets.id.author_id",
        "user.fields": "username,name",
        max_results: clampPage(opts.pageSize, BOOKMARKS_PAGE),
        pagination_token: next,
      });
      const tweets = (resp.data as Tweet[] | undefined) ?? [];
      const inc = (resp.includes as { users?: User[]; tweets?: Tweet[] } | undefined) ?? {};
      const users = new Map((inc.users ?? []).map((u) => [u.id, u]));
      const refs = new Map((inc.tweets ?? []).map((t) => [t.id, t]));
      let freshInPage = 0;
      for (const t of tweets) {
        if (seen.has(t.id)) continue;
        const author = users.get(t.author_id ?? "");
        const quotedId = t.referenced_tweets?.find((r) => r.type === "quoted")?.id;
        const quoted = quotedId ? refs.get(quotedId) : undefined;
        fresh.push({
          id: t.id,
          created_at: t.created_at,
          author: author ? { name: author.name, username: author.username } : null,
          url: `https://x.com/${author?.username ?? "i"}/status/${t.id}`,
          text: tweetBodyText(t),
          quoted: quoted
            ? { id: quoted.id, username: users.get(quoted.author_id ?? "")?.username ?? null, text: tweetBodyText(quoted) }
            : null,
        });
        seen.add(t.id);
        freshInPage++;
      }
      pages++;
      next = (resp.meta as Json | undefined)?.next_token as string | undefined;
      if (!next || !tweets.length) {
        reachedEnd = true;
        break;
      }
      // 「既読が混じったら止める」は、既読が連続した watermark である（＝一度辿り切った）ときだけ使える
      if ((state.walk_complete || (opts.knownIds?.length ?? 0) > 0) && freshInPage < tweets.length) break;
      if (pages >= maxPages) {
        hitCap = true;
        break;
      }
    }
    const warnings: string[] = [];
    if (hitCap) {
      warnings.push(
        state.walk_complete
          ? `${maxPages} ページ読んでも既読に届かなかった。取りこぼしがありうる（max_pages を上げて再実行）`
          : `初回の walk が ${maxPages} ページで止まった。次回は続きから読む`,
      );
    }
    return {
      bookmarks: fresh,
      pages,
      /** x_bookmarks_mark_seen にそのまま渡す（初回 walk を辿り切ったかどうか） */
      walk_complete: state.walk_complete || reachedEnd,
      warnings,
    };
  }

  markSeen(ids: string[], walkComplete?: boolean) {
    return this.#store.markBookmarksSeen(ids, walkComplete);
  }
}
