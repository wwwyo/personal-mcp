import { type Env, ToolError, requireSecret } from "./app-env.ts";
import { dayWindow, isoSeconds } from "./time.ts";

// wwwyo/me の daily-end（day_sessions.py）と dotfiles の session_eval.py と同じ取り方をする。
// 書き込み系の API は呼ばない（このサーバーは読み取り専用）。

const OBS_PAGE_LIMIT = 1000; // v2 observations の上限
const SCORES_PAGE_LIMIT = 100; // v3 scores は 100 固定
const SCORES_SID_CHUNK = 50;
const DEFAULT_MAX_PAGES = 40;
/** evaluator の記録 comment の marker */
export const RECORD_MARKER = "<!-- session-eval";
export const SCORE_WATERMARK = "evaluated_until";
/** v2 は metadata を 200 字で切ることがあるので展開を指定する（session_eval.py と同じ） */
const EXPAND_METADATA = "cwd,transcript_path,git_branch,telemetry_summary";
/** day_sessions.py の WORKERS と同じ。Langfuse の 429 を避ける */
const RECORD_CONCURRENCY = 8;
const SESSION_ID_RE = /^[A-Za-z0-9._~:+-]{1,200}$/;
const HINT_KEYS = ["cwd", "transcript_path", "git_branch", "repo_root", "repo_name"] as const;

type Json = Record<string, unknown>;

export class LangfuseClient {
  readonly base: string;
  readonly #auth: string;
  readonly #fetch: typeof fetch;

  constructor(env: Env, fetchImpl: typeof fetch = fetch) {
    const pk = requireSecret(env, "LANGFUSE_PUBLIC_KEY");
    const sk = requireSecret(env, "LANGFUSE_SECRET_KEY");
    this.base = (env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com").replace(/\/+$/, "");
    this.#auth = `Basic ${btoa(`${pk}:${sk}`)}`;
    this.#fetch = fetchImpl;
  }

  async get(path: string, params: Record<string, string | number | undefined> = {}): Promise<Json> {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
    for (let attempt = 0; ; attempt++) {
      const res = await this.#fetch(url, {
        headers: { Authorization: this.#auth, Accept: "application/json" },
      });
      if ((res.status === 429 || res.status >= 500) && attempt < 2) {
        const after = Number(res.headers.get("Retry-After"));
        await sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 10) * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      if (!res.ok) {
        const body = (await res.text()).slice(0, 300);
        throw new ToolError(`Langfuse GET ${path}: HTTP ${res.status} ${body}`);
      }
      return (await res.json()) as Json;
    }
  }

  /** cursor ページング（v2 observations / v3 scores）。上限で黙って切らずに truncated を返す */
  async cursorPaged(path: string, params: Record<string, string | number | undefined>, maxPages: number) {
    const rows: Json[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      const d = await this.get(path, { ...params, cursor });
      rows.push(...((d.data as Json[] | undefined) ?? []));
      const next = (d.meta as Json | undefined)?.cursor as string | undefined;
      if (!next) return { rows, truncated: false };
      if (next === cursor) throw new ToolError(`Langfuse GET ${path}: cursor did not advance`);
      cursor = next;
    }
    return { rows, truncated: true };
  }
}

/** 同時実行数を絞った map（結果は入力と同じ順） */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export interface SessionSummary {
  session_id: string;
  first_ts: string;
  last_ts: string;
  obs: number;
  sources: string[];
  hints: Partial<Record<(typeof HINT_KEYS)[number], string>>;
}

/** observation 一覧を session ごとに畳む（day_sessions.py の _list_sessions と同じ規則） */
export function summarizeObservations(observations: Json[]) {
  const sessions = new Map<string, SessionSummary>();
  const unsafe = new Set<string>();
  for (const o of observations) {
    const sid = o.sessionId;
    if (typeof sid !== "string" || !sid) continue;
    if (!SESSION_ID_RE.test(sid)) {
      unsafe.add(sid);
      continue;
    }
    let s = sessions.get(sid);
    if (!s) {
      s = { session_id: sid, first_ts: "", last_ts: "", obs: 0, sources: [], hints: {} };
      sessions.set(sid, s);
    }
    const st = typeof o.startTime === "string" ? o.startTime : "";
    if (st && (!s.first_ts || st < s.first_ts)) s.first_ts = st;
    // exporter は start を backdate するので last activity は endTime（無ければ startTime）の最大
    const et = typeof o.endTime === "string" && o.endTime ? o.endTime : st;
    if (et > s.last_ts) s.last_ts = et;
    s.obs++;
    const md = (o.metadata as Json | undefined) ?? {};
    let src = md.source;
    if (typeof src !== "string" || !src) {
      const ra = md["resourceAttributes.service.name"] ?? (md.resourceAttributes as Json | undefined)?.["service.name"];
      src = typeof ra === "string" ? ra : undefined;
    }
    if (typeof src === "string" && src) {
      const name = src.split(":")[0] ?? src;
      if (!s.sources.includes(name)) s.sources.push(name);
    }
    for (const k of HINT_KEYS) {
      const v = md[k];
      if (typeof v === "string" && v && !(k in s.hints)) s.hints[k] = v;
    }
  }
  return {
    sessions: [...sessions.values()].sort((a, b) => a.first_ts.localeCompare(b.first_ts)),
    unsafe_session_ids: [...unsafe].sort(),
  };
}

/** JST の暦日に observation がある session の一覧 */
export async function daySessions(client: LangfuseClient, date: string, maxPages = DEFAULT_MAX_PAGES) {
  const { from, to } = dayWindow(date, "Asia/Tokyo");
  const { rows, truncated } = await client.cursorPaged(
    "/api/public/v2/observations",
    {
      fields: "basic,metadata",
      expandMetadata: EXPAND_METADATA,
      fromStartTime: isoSeconds(from),
      toStartTime: isoSeconds(to),
      limit: OBS_PAGE_LIMIT,
    },
    maxPages,
  );
  if (truncated) {
    // 部分一覧は「活動の取りこぼし」を静かに生むので返さない（day_sessions.py と同じ方針）
    throw new ToolError(`observations が max_pages=${maxPages} を超えた。max_pages を上げて取り直す`);
  }
  return {
    date,
    window: { from: isoSeconds(from), to: isoSeconds(to) },
    ...summarizeObservations(rows),
  };
}

/** 最新の evaluator 記録 comment（comment は append-only なので新しい順で先勝ち） */
export function pickRecord(comments: Json[]): Json | null {
  const sorted = [...comments].sort((a, b) =>
    String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")),
  );
  return sorted.find((c) => String(c.content ?? "").includes(RECORD_MARKER)) ?? null;
}

async function fetchComments(client: LangfuseClient, sid: string): Promise<Json[]> {
  const out: Json[] = [];
  for (let page = 1; page <= 20; page++) {
    const d = await client.get("/api/public/comments", {
      objectType: "SESSION",
      objectId: sid,
      page,
      limit: 50,
    });
    const rows = (d.data as Json[] | undefined) ?? [];
    out.push(...rows);
    const total = Number((d.meta as Json | undefined)?.totalItems ?? out.length);
    if (!rows.length || out.length >= total) break;
  }
  return out;
}

async function latestWatermarks(client: LangfuseClient, sids: string[], since: Date) {
  const latest = new Map<string, number>();
  for (let i = 0; i < sids.length; i += SCORES_SID_CHUNK) {
    const chunk = sids.slice(i, i + SCORES_SID_CHUNK);
    const { rows } = await client.cursorPaged(
      "/api/public/v3/scores",
      {
        fields: "subject",
        sessionId: chunk.join(","),
        name: SCORE_WATERMARK,
        fromTimestamp: isoSeconds(since),
        limit: SCORES_PAGE_LIMIT,
      },
      DEFAULT_MAX_PAGES,
    );
    // 新しい順に返るので先勝ち
    for (const sc of rows) {
      const subj = (sc.subject as Json | undefined) ?? {};
      if (subj.kind !== "session" || typeof subj.id !== "string") continue;
      const v = Number(sc.value);
      if (!latest.has(subj.id) && Number.isFinite(v)) latest.set(subj.id, v);
    }
  }
  return latest;
}

/**
 * session ごとの記録 comment（最新）と evaluated_until。
 * 1 session の失敗で全体を落とさず、その session に error を付けて返す。
 */
export async function sessionRecords(client: LangfuseClient, sessionIds: string[], scoresSinceDays = 14) {
  const bad = sessionIds.filter((s) => !SESSION_ID_RE.test(s));
  if (bad.length) throw new ToolError(`不正な session id: ${bad.join(", ")}`);
  const warnings: string[] = [];
  let marks = new Map<string, number>();
  try {
    marks = await latestWatermarks(client, sessionIds, new Date(Date.now() - scoresSinceDays * 86400_000));
  } catch (e) {
    warnings.push(`scores の取得に失敗（evaluated_until は null）: ${(e as Error).message}`);
  }
  const records = await mapPool(sessionIds, RECORD_CONCURRENCY, async (sid) => {
    try {
      const rec = pickRecord(await fetchComments(client, sid));
      return {
        session_id: sid,
        evaluated_until: marks.get(sid) ?? null,
        record: rec ? { comment_id: rec.id, created_at: rec.createdAt, content: rec.content } : null,
      };
    } catch (e) {
      return {
        session_id: sid,
        evaluated_until: marks.get(sid) ?? null,
        record: null,
        record_error: (e as Error).message,
      };
    }
  });
  return { records, warnings };
}

/** 読み取り専用の汎用 GET。/api/public/ 配下だけを許す */
export function assertReadablePath(path: string): void {
  if (!/^\/api\/public\/[A-Za-z0-9/_.-]+$/.test(path) || path.includes("..")) {
    throw new ToolError(`path は /api/public/ 配下だけ（与えられた値: ${path}）`);
  }
}
