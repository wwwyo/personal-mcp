import { expect, test } from "bun:test";
import { isAuthorized } from "../src/auth.ts";

test("一致する bearer だけを通す", async () => {
  expect(await isAuthorized("Bearer s3cret", "s3cret")).toBe(true);
  expect(await isAuthorized("bearer s3cret", "s3cret")).toBe(true);
  expect(await isAuthorized("Bearer s3cre", "s3cret")).toBe(false);
  expect(await isAuthorized("s3cret", "s3cret")).toBe(false);
  expect(await isAuthorized(null, "s3cret")).toBe(false);
});

test("token 未設定の Worker は誰も通さない", async () => {
  expect(await isAuthorized("Bearer ", undefined)).toBe(false);
  expect(await isAuthorized("Bearer x", "")).toBe(false);
});
