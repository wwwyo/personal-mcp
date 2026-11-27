import { expect, test } from "bun:test";
import {
  CaptureError,
  captureArgs,
  createCamera,
  parseVideoDevices,
  type Run,
  selectCamera,
  supportedFramerate,
} from "../src/capture.ts";

const LIST = `[AVFoundation indev @ 0x1] AVFoundation video devices:
[AVFoundation indev @ 0x1] [0] FaceTime HDカメラ
[AVFoundation indev @ 0x1] [1] Capture screen 0
[AVFoundation indev @ 0x1] [2] USB Camera
[AVFoundation indev @ 0x1] AVFoundation audio devices:
[AVFoundation indev @ 0x1] [0] MacBook Airのマイク
`;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

test("video device だけを取り出す（audio は含めない）", () => {
  expect(parseVideoDevices(LIST)).toEqual([
    { index: 0, name: "FaceTime HDカメラ" },
    { index: 1, name: "Capture screen 0" },
    { index: 2, name: "USB Camera" },
  ]);
});

test("既定は画面キャプチャ以外の先頭", () => {
  const screensFirst = [
    { index: 0, name: "Capture screen 0" },
    { index: 1, name: "USB Camera" },
  ];
  expect(selectCamera(screensFirst).name).toBe("USB Camera");
});

test("画面キャプチャは名前で指定されても選ばない", () => {
  expect(() => selectCamera(parseVideoDevices(LIST), "Capture screen 0")).toThrow(CaptureError);
  expect(() => selectCamera([{ index: 0, name: "Capture screen 0" }])).toThrow("カメラが見つからない");
});

test("CAMERA_DEVICE は名前の完全一致で選ぶ", () => {
  expect(selectCamera(parseVideoDevices(LIST), "USB Camera").index).toBe(2);
  expect(() => selectCamera(parseVideoDevices(LIST), "USB")).toThrow("見つからない");
});

test("撮影の引数は選んだ index の映像だけを開き、JPEG 1 枚を stdout に出す", () => {
  const args = captureArgs({ index: 2, name: "USB Camera" }, 800);
  expect(args.slice(args.indexOf("-i"), args.indexOf("-i") + 2)).toEqual(["-i", "2:none"]);
  expect(args).toContain("scale=800:-2");
  expect(args.slice(-1)).toEqual(["pipe:1"]);
  expect(args.join(" ")).toContain("-frames:v 1");
});

function fakeRun(capture: () => Awaited<ReturnType<Run>>) {
  const calls: string[][] = [];
  const run: Run = async (args) => {
    calls.push(args);
    if (args.includes("-list_devices")) return { code: 1, stdout: new Uint8Array(), stderr: LIST };
    return capture();
  };
  return { run, calls };
}

test("撮れたら JPEG と device 名を返す", async () => {
  const { run, calls } = fakeRun(() => ({ code: 0, stdout: JPEG, stderr: "" }));
  const r = await createCamera({ run }).capture(1280);
  expect(r).toEqual({ jpeg: JPEG, device: "FaceTime HDカメラ" });
  expect(calls[1]).toContain("0:none");
});

test("ffmpeg が失敗したら CaptureError（stderr の中身は返さない）", async () => {
  const { run } = fakeRun(() => ({ code: 1, stdout: new Uint8Array(), stderr: "not authorized /Users/secret/path" }));
  const err = await createCamera({ run }).capture(1280).catch((e) => e);
  expect(err).toBeInstanceOf(CaptureError);
  expect(String(err.message)).not.toContain("/Users/secret");
});

test("時間切れ・JPEG でない出力は CaptureError", async () => {
  const timeout = fakeRun(() => ({ code: -1, stdout: new Uint8Array(), stderr: "" }));
  await expect(createCamera({ run: timeout.run }).capture(1280)).rejects.toThrow("時間内");
  const notJpeg = fakeRun(() => ({ code: 0, stdout: new Uint8Array([1, 2, 3]), stderr: "" }));
  await expect(createCamera({ run: notJpeg.run }).capture(1280)).rejects.toThrow("JPEG");
});

const UNSUPPORTED = `[avfoundation @ 0x1] Selected framerate (30.000000) is not supported by the device.
[avfoundation @ 0x1] Supported modes:
[avfoundation @ 0x1]   1920x1080@[15.000000 15.000000]fps
[avfoundation @ 0x1]   640x480@[5.000000 30.000000]fps
`;

test("対応しない framerate のエラーから最初のモードの fps を取り出す", () => {
  expect(supportedFramerate(UNSUPPORTED)).toBe("15.000000");
  expect(supportedFramerate("not authorized")).toBeUndefined();
});

test("30fps を持たないカメラは対応 fps で 1 回だけ撮り直す", async () => {
  const calls: string[][] = [];
  const run: Run = async (args) => {
    calls.push(args);
    if (args.includes("-list_devices")) return { code: 1, stdout: new Uint8Array(), stderr: LIST };
    if (args[args.indexOf("-framerate") + 1] === "30") return { code: 1, stdout: new Uint8Array(), stderr: UNSUPPORTED };
    return { code: 0, stdout: JPEG, stderr: "" };
  };
  const r = await createCamera({ run }).capture(1280);
  expect(r.jpeg).toEqual(JPEG);
  expect(calls).toHaveLength(3);
  expect(calls[2]).toContain("15.000000");
});

test("一覧の取得が時間切れなら「見つからない」ではなく時間切れを返す", async () => {
  const run: Run = async () => ({ code: -1, stdout: new Uint8Array(), stderr: "" });
  await expect(createCamera({ run }).capture(1280)).rejects.toThrow("一覧の取得が時間内");
});

test("同時に呼ばれても 1 枚ずつ順に撮る", async () => {
  let active = 0;
  let maxActive = 0;
  const run: Run = async (args) => {
    if (args.includes("-list_devices")) return { code: 1, stdout: new Uint8Array(), stderr: LIST };
    active++;
    maxActive = Math.max(maxActive, active);
    await Bun.sleep(10);
    active--;
    return { code: 0, stdout: JPEG, stderr: "" };
  };
  const camera = createCamera({ run });
  await Promise.all([camera.capture(640), camera.capture(640), camera.capture(640)]);
  expect(maxActive).toBe(1);
});

// 本物の ffmpeg で、撮影と同じ出力の指定（1 枚・scale・mjpeg・pipe）が JPEG を返すかを確かめる。
// カメラの代わりにテストパターン（lavfi）を入力にする。ffmpeg が無い環境（CI）では飛ばす
const hasFfmpeg = Bun.which("ffmpeg") !== null;
test.skipIf(!hasFfmpeg)("ffmpeg の出力指定で JPEG が stdout に出る（テストパターン入力）", async () => {
  const args = captureArgs({ index: 0, name: "test" }, 640);
  const i = args.indexOf("-f");
  const input = ["-f", "lavfi", "-i", "testsrc=size=1280x720:rate=30"];
  const lavfiArgs = [...args.slice(0, i), ...input, ...args.slice(args.indexOf("-i") + 2)];
  const { runFfmpeg } = await import("../src/capture.ts");
  const res = await runFfmpeg(lavfiArgs, 20_000);
  expect(res.code).toBe(0);
  expect([...res.stdout.slice(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
});
