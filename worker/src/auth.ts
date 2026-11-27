const encoder = new TextEncoder();

/**
 * `Authorization: Bearer <token>` を定数時間で照合する。
 * token 未設定の Worker は常に拒否する（設定漏れで公開状態にならないように）。
 */
export async function isAuthorized(header: string | null, expected: string | undefined): Promise<boolean> {
  if (!expected) return false;
  if (!header) return false;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m || !m[1]) return false;
  // 長さの差で早期 return しないよう、両方を SHA-256 にしてから比べる
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(m[1])),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
