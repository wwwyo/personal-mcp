/** 日付まわり。daily/ の日付は JST、Product Hunt の 1 日は太平洋時間（PT）。 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertDate(date: string): void {
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new Error(`invalid date: ${date}（YYYY-MM-DD）`);
  }
}

/** 指定タイムゾーンでの暦日（YYYY-MM-DD） */
export function dateIn(timeZone: string, at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** タイムゾーンの UTC オフセット（分）。DST がある PT のためにその時点で計算する */
function offsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** その暦日の [00:00, 翌日00:00) を UTC の Date で返す */
export function dayWindow(date: string, timeZone: string): { from: Date; to: Date } {
  assertDate(date);
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const naiveStart = Date.UTC(y, m - 1, d);
  const naiveEnd = Date.UTC(y, m - 1, d + 1);
  // オフセットはその時刻ごとに求める（DST 切り替え日でも境界がずれないように 2 回補正）
  const toUtc = (naive: number) => {
    let t = naive - offsetMinutes(timeZone, new Date(naive)) * 60000;
    t = naive - offsetMinutes(timeZone, new Date(t)) * 60000;
    return new Date(t);
  };
  return { from: toUtc(naiveStart), to: toUtc(naiveEnd) };
}

export function addDays(date: string, days: number): string {
  assertDate(date);
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** Langfuse に渡す ISO 形式（秒精度・Z） */
export function isoSeconds(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}
