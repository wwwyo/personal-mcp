import { expect, test } from "vitest";
import * as route from "../routes/mcp.ts";

// Void は export した method しか登録しない。漏れると 405 ではなく 404 になるので、全 method が handleMcp に届くことを確かめる
test("/mcp の route は全 method を同じ handler に通す", () => {
  const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
  for (const m of methods) {
    expect(route[m], m).toBe(route.POST);
  }
});
