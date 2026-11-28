import { ToolError } from "./app-env.ts";

// X の OAuth 2.0 user context token と bookmarks の既読状態を持つ。
// Durable Object（x-token-store.ts）の中で 1 インスタンスだけが動くので、
// refresh token のローテート（使うたびに旧 token が失効する）を直列化できる。
// storage は差し替えられるようにしてあり、テストでは Map で動かす。

export const TOKEN_ENDPOINT = "https://api.x.com/2/oauth2/token";
const REFRESH_BUFFER_SEC = 60;
const SEEN_IDS_CAP = 5000;

export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

export interface Tokens {
  access_token: string;
  refresh_token: string;
  /** unix 秒 */
  expires_at: number;
  scope: string;
  /** どの X_REFRESH_TOKEN から始めたか（値ではなく SHA-256）。種を入れ替えたら作り直す */
  seed_hash: string;
}

export interface XAppConfig {
  clientId: string;
  clientSecret?: string;
  seedRefreshToken?: string;
}

/** Durable Object の RPC で返す accessToken の結果。RPC 越しだと ToolError のクラスが落ちるので、利用者向けのエラーは値で返す */
export type AccessTokenResult = { token: string } | { error: string };

export interface BookmarksState {
  seen_ids: string[];
  /** 一度でも最後まで辿り切ったか。辿り切る前は「既読が混じったら止める」を使えない */
  walk_complete: boolean;
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class XState {
  #kv: KV;
  #fetch: typeof fetch;
  #now: () => number;
  #refreshing: Promise<Tokens> | null = null;

  constructor(kv: KV, fetchImpl: typeof fetch = fetch, now: () => number = () => Date.now() / 1000) {
    this.#kv = kv;
    // Workers の fetch は this が globalThis 以外だと TypeError（Illegal invocation）になるので、
    // メソッドとして呼ばれないよう包む
    this.#fetch = (input, init) => fetchImpl(input, init);
    this.#now = now;
  }

  /** 有効な access token を返す。force なら期限に関係なく refresh する（API が 401 を返したとき） */
  async accessToken(app: XAppConfig, force = false): Promise<string> {
    const seedHash = app.seedRefreshToken ? await sha256Hex(app.seedRefreshToken) : "";
    const tokens = await this.#kv.get<Tokens>("tokens");
    const reseeded = Boolean(seedHash) && tokens?.seed_hash !== seedHash;
    if (tokens && !reseeded && !force && tokens.expires_at - REFRESH_BUFFER_SEC > this.#now()) {
      return tokens.access_token;
    }
    // 同時に来た呼び出しは同じ refresh を待つ（single-flight）。並行に refresh すると片方の token が失効する
    this.#refreshing ??= this.#refresh(app, reseeded ? undefined : tokens, seedHash).finally(() => {
      this.#refreshing = null;
    });
    return (await this.#refreshing).access_token;
  }

  async #refresh(app: XAppConfig, current: Tokens | undefined, seedHash: string): Promise<Tokens> {
    const refreshToken = current?.refresh_token ?? app.seedRefreshToken;
    if (!refreshToken) {
      throw new ToolError("X の refresh token が無い（void secret put X_REFRESH_TOKEN で種を入れる）");
    }
    const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
    if (app.clientSecret) headers.Authorization = `Basic ${btoa(`${app.clientId}:${app.clientSecret}`)}`;
    const res = await this.#fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers,
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: app.clientId,
      }),
    });
    if (!res.ok) {
      // 応答本文に token は含まれないが、念のため error コードだけ返す
      let code = "";
      try {
        code = String(((await res.json()) as Record<string, unknown>).error ?? "");
      } catch {}
      throw new ToolError(
        `X の token refresh に失敗（HTTP ${res.status} ${code}）。refresh token が失効していれば、` +
          "手元で取り直して void secret put X_REFRESH_TOKEN で入れ直す",
      );
    }
    const r = (await res.json()) as Record<string, unknown>;
    const tokens: Tokens = {
      access_token: String(r.access_token),
      // X は refresh のたびに refresh token をローテートする。返らなければ旧 token を使い続ける
      refresh_token: typeof r.refresh_token === "string" && r.refresh_token ? r.refresh_token : refreshToken,
      expires_at: Math.floor(this.#now()) + Number(r.expires_in ?? 7200),
      scope: String(r.scope ?? current?.scope ?? ""),
      seed_hash: current?.seed_hash ?? seedHash,
    };
    // 返す前に保存する（保存前に落ちると新しい refresh token を失い、旧 token は失効済みになる）
    await this.#kv.put("tokens", tokens);
    return tokens;
  }

  async cachedUser(): Promise<{ id: string; username: string } | undefined> {
    return this.#kv.get("user");
  }

  async cacheUser(user: { id: string; username: string }): Promise<void> {
    await this.#kv.put("user", user);
  }

  async bookmarks(): Promise<BookmarksState> {
    return (await this.#kv.get<BookmarksState>("bookmarks")) ?? { seen_ids: [], walk_complete: false };
  }

  /** 書き出しが済んだ bookmark を既読にする。walkComplete は x_bookmarks が辿り切ったときだけ true で渡す */
  async markBookmarksSeen(ids: string[], walkComplete?: boolean): Promise<BookmarksState> {
    const cur = await this.bookmarks();
    const merged = [...new Set([...ids, ...cur.seen_ids])].slice(0, SEEN_IDS_CAP);
    const next: BookmarksState = {
      seen_ids: merged,
      walk_complete: cur.walk_complete || Boolean(walkComplete),
    };
    await this.#kv.put("bookmarks", next);
    return next;
  }
}
