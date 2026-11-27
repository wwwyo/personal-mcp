import { expect, test } from "vitest";
import { addDays, dayWindow } from "../src/time.ts";

test("JST の暦日は前日 15:00Z から", () => {
  const w = dayWindow("2026-11-27", "Asia/Tokyo");
  expect(w.from.toISOString()).toBe("2026-11-26T15:00:00.000Z");
  expect(w.to.toISOString()).toBe("2026-11-27T15:00:00.000Z");
});

test("PT は夏時間と冬時間で境界が変わる", () => {
  expect(dayWindow("2026-07-01", "America/Los_Angeles").from.toISOString()).toBe("2026-07-01T07:00:00.000Z");
  expect(dayWindow("2026-11-26", "America/Los_Angeles").from.toISOString()).toBe("2026-11-26T08:00:00.000Z");
  // 夏時間が終わる日は 25 時間
  const w = dayWindow("2026-11-01", "America/Los_Angeles");
  expect((w.to.getTime() - w.from.getTime()) / 3600_000).toBe(25);
});

test("addDays は月をまたぐ", () => {
  expect(addDays("2026-12-01", -1)).toBe("2026-11-30");
});
