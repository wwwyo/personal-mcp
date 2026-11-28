import { DurableObject } from "cloudflare:workers";
import { type Env, ToolError } from "./app-env.ts";
import { type AccessTokenResult, type BookmarksState, type KV, type XAppConfig, XState } from "./x-state.ts";

/**
 * X の token と bookmarks の既読状態を持つ Durable Object（名前 "default" の 1 インスタンスだけを使う）。
 * 中身は XState。ここは storage を渡して RPC で公開するだけ。
 */
export class XTokenStore extends DurableObject<Env> {
  #state: XState;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const kv: KV = {
      get: (k) => ctx.storage.get(k),
      put: (k, v) => ctx.storage.put(k, v),
    };
    this.#state = new XState(kv);
  }

  /**
   * RPC で投げた例外は呼び出し側で素の Error になり、ToolError の説明（refresh token の失効など）が
   * 「内部エラー（Error）」に化ける。利用者向けのエラーは値で返し、呼び出し側（storeFromRpc）で ToolError に戻す
   */
  async accessToken(app: XAppConfig, force = false): Promise<AccessTokenResult> {
    try {
      return { token: await this.#state.accessToken(app, force) };
    } catch (e) {
      if (e instanceof ToolError) return { error: e.message };
      throw e;
    }
  }

  cachedUser(): Promise<{ id: string; username: string } | undefined> {
    return this.#state.cachedUser();
  }

  cacheUser(user: { id: string; username: string }): Promise<void> {
    return this.#state.cacheUser(user);
  }

  bookmarks(): Promise<BookmarksState> {
    return this.#state.bookmarks();
  }

  markBookmarksSeen(ids: string[], walkComplete?: boolean): Promise<BookmarksState> {
    return this.#state.markBookmarksSeen(ids, walkComplete);
  }
}
