import { expect, test } from "bun:test";
import { handleRequest } from "../src/app.ts";
import { type Camera, CaptureError } from "../src/capture.ts";

const TOKEN = "t".repeat(40);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9]);

function camera(impl?: Camera["capture"]): Camera & { calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    capture: async (width) => {
      calls.push(width);
      return impl ? impl(width) : { jpeg: JPEG, device: "FaceTime HDカメラ" };
    },
  };
}

const rpc = (body: unknown, auth = `Bearer ${TOKEN}`) =>
  new Request("http://127.0.0.1:47822/mcp", {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify(body),
  });
const call = (args: Record<string, unknown> = {}) =>
  rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "camera_capture", arguments: args } });

test("bearer が違えば 401 で、カメラは動かない", async () => {
  const cam = camera();
  const res = await handleRequest(
    rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "camera_capture", arguments: {} } }, "Bearer nope"),
    TOKEN,
    cam,
  );
  expect(res.status).toBe(401);
  const res2 = await handleRequest(
    new Request("http://127.0.0.1:47822/mcp", { method: "POST", body: "{}" }),
    TOKEN,
    cam,
  );
  expect(res2.status).toBe(401);
  expect(cam.calls).toEqual([]);
});

test("/mcp 以外は 404、POST 以外は 405", async () => {
  expect((await handleRequest(new Request("http://127.0.0.1:47822/"), TOKEN, camera())).status).toBe(404);
  const get = new Request("http://127.0.0.1:47822/mcp", { headers: { Authorization: `Bearer ${TOKEN}` } });
  const res = await handleRequest(get, TOKEN, camera());
  expect(res.status).toBe(405);
  expect(res.headers.get("Allow")).toBe("POST");
});

test("tools/list では撮らない", async () => {
  const cam = camera();
  const res = await handleRequest(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }), TOKEN, cam);
  const body = (await res.json()) as { result: { tools: { name: string }[] } };
  expect(body.result.tools.map((t) => t.name)).toEqual(["camera_capture"]);
  expect(cam.calls).toEqual([]);
});

test("camera_capture は呼ばれたときに 1 枚撮って image content で返す", async () => {
  const cam = camera();
  const res = await handleRequest(call({ width: 800 }), TOKEN, cam);
  const body = (await res.json()) as { result: { content: { type: string; data?: string; mimeType?: string }[] } };
  expect(cam.calls).toEqual([800]);
  const image = body.result.content[0]!;
  expect(image.type).toBe("image");
  expect(image.mimeType).toBe("image/jpeg");
  expect(Buffer.from(image.data!, "base64")).toEqual(Buffer.from(JPEG));
});

test("撮影の失敗は isError で理由だけを返す", async () => {
  const cam = camera(async () => {
    throw new CaptureError("撮影に失敗した");
  });
  const res = await handleRequest(call(), TOKEN, cam);
  const body = (await res.json()) as { result: { isError: boolean; content: { text: string }[] } };
  expect(body.result.isError).toBe(true);
  expect(body.result.content[0]!.text).toBe("撮影に失敗した");
});

test("想定外の例外は中身を返さない", async () => {
  const cam = camera(async () => {
    throw new Error("/Users/someone/secret");
  });
  const res = await handleRequest(call(), TOKEN, cam);
  const body = (await res.json()) as { result: { isError: boolean; content: { text: string }[] } };
  expect(body.result.isError).toBe(true);
  expect(body.result.content[0]!.text).not.toContain("/Users/someone");
});
