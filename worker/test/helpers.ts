import type { KV } from "../src/x-state.ts";

export function memoryKV(): KV & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async <T>(k: string) => structuredClone(data.get(k)) as T | undefined,
    put: async <T>(k: string, v: T) => {
      data.set(k, structuredClone(v));
    },
  };
}

type Handler = (url: URL, init: RequestInit | undefined) => Response | Promise<Response>;

/** 呼ばれた URL を記録する fetch の偽物 */
export function fakeFetch(handler: Handler) {
  const calls: { url: URL; init: RequestInit | undefined }[] = [];
  // Workers の本物と同じく、this 付き（obj.fetch(...) の形）で呼ばれたら TypeError にする
  const f = async function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push({ url, init });
    return handler(url, init);
  } as typeof fetch;
  return { fetch: f, calls };
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
