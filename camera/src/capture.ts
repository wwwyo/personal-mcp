// この Mac のカメラで静止画を 1 枚撮る（ffmpeg の avfoundation）。
// avfoundation は画面キャプチャ（"Capture screen N"）も video device として並べるので、
// 番号ではなく名前で選び、画面キャプチャは指定されても選ばない。

/** 利用者向けのエラー。ffmpeg の生の出力は含めない（device 名以外の手元の情報を返さない） */
export class CaptureError extends Error {}

export interface VideoDevice {
  index: number;
  name: string;
}

const SCREEN_DEVICE = /^capture screen\b/i;

/** `ffmpeg -f avfoundation -list_devices true -i ""` の stderr から video device を取り出す */
export function parseVideoDevices(stderr: string): VideoDevice[] {
  const devices: VideoDevice[] = [];
  let inVideo = false;
  for (const line of stderr.split("\n")) {
    if (/AVFoundation video devices:/.test(line)) {
      inVideo = true;
      continue;
    }
    if (/AVFoundation audio devices:/.test(line)) break;
    if (!inVideo) continue;
    const m = /\]\s*\[(\d+)\]\s+(.+?)\s*$/.exec(line);
    if (m?.[1] && m[2]) devices.push({ index: Number(m[1]), name: m[2] });
  }
  return devices;
}

/** 撮るカメラを選ぶ。wanted があれば名前の完全一致、無ければ画面キャプチャ以外の先頭 */
export function selectCamera(devices: VideoDevice[], wanted?: string): VideoDevice {
  const cameras = devices.filter((d) => !SCREEN_DEVICE.test(d.name));
  if (wanted) {
    if (SCREEN_DEVICE.test(wanted)) throw new CaptureError("画面キャプチャは撮影の対象にしない");
    const hit = cameras.find((d) => d.name === wanted);
    if (!hit) {
      throw new CaptureError(`CAMERA_DEVICE のカメラが見つからない（候補: ${cameras.map((d) => d.name).join(", ") || "なし"}）`);
    }
    return hit;
  }
  const first = cameras[0];
  if (!first) throw new CaptureError("カメラが見つからない");
  return first;
}

/** 1 枚撮る ffmpeg の引数。最初の 1 秒は露出が落ち着かないので捨て、JPEG を stdout に出す */
export function captureArgs(device: VideoDevice, width: number): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "avfoundation",
    "-framerate",
    "30",
    "-i",
    `${device.index}:none`,
    "-ss",
    "1",
    "-frames:v",
    "1",
    "-vf",
    `scale=${width}:-2`,
    "-q:v",
    "3",
    "-f",
    "image2pipe",
    "-vcodec",
    "mjpeg",
    "pipe:1",
  ];
}

export interface RunResult {
  code: number;
  stdout: Uint8Array;
  stderr: string;
}
export type Run = (args: string[], timeoutMs: number) => Promise<RunResult>;

/** ffmpeg を起動する。時間切れなら kill して code -1 を返す */
export const runFfmpeg: Run = async (args, timeoutMs) => {
  const proc = Bun.spawn(["ffmpeg", ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).bytes(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code: proc.signalCode ? -1 : code, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
};

const MAX_BYTES = 4 * 1024 * 1024;
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

export interface Camera {
  capture(width: number): Promise<{ jpeg: Uint8Array; device: string }>;
}

/** カメラを 1 つにまとめる。同時に呼ばれても順に 1 枚ずつ撮る（avfoundation は同時に開けない） */
export function createCamera(opts: { run?: Run; wanted?: string; timeoutMs?: number } = {}): Camera {
  const run = opts.run ?? runFfmpeg;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  let queue: Promise<unknown> = Promise.resolve();

  async function captureOnce(width: number) {
    const list = await run(["-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""], timeoutMs);
    const device = selectCamera(parseVideoDevices(list.stderr), opts.wanted);
    const res = await run(captureArgs(device, width), timeoutMs);
    if (res.code === -1) throw new CaptureError("撮影が時間内に終わらなかった");
    if (res.code !== 0) {
      // 許可が無いときは ffmpeg が失敗する。詳細はこの Mac のログにだけ出す
      console.error(`[camera] ffmpeg exited ${res.code}: ${res.stderr.trim().slice(0, 500)}`);
      throw new CaptureError(
        "撮影に失敗した（カメラの使用許可が無い・他のアプリが使用中など。詳細はカメラサーバーのログ）",
      );
    }
    const jpeg = res.stdout;
    if (jpeg.length === 0 || !JPEG_MAGIC.every((b, i) => jpeg[i] === b)) {
      throw new CaptureError("撮影結果が JPEG ではなかった");
    }
    if (jpeg.length > MAX_BYTES) throw new CaptureError("画像が大きすぎる（width を小さくする）");
    return { jpeg, device: device.name };
  }

  return {
    capture(width) {
      const next = queue.then(() => captureOnce(width));
      queue = next.catch(() => undefined);
      return next;
    },
  };
}
