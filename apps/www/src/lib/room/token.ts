/**
 * 房间服务的访问凭证：证明请求来自本站，不是用户身份。
 *
 * token = `${分钟桶}.${HMAC-SHA256(密钥, 分钟桶)}`
 * - 用分钟桶而不是精确时间戳：同一分钟内所有人签出的 token 完全一致，
 *   room-worker 可以直接拿 token 当速率限制的 key，天然按分钟分桶，不用 IP。
 * - 1 小时有效，兼顾页面开着时的重连。
 * - 密钥两侧共享：主站用 env.ROOM_TOKEN_SECRET 签发，room-worker 验签。
 */

const TOKEN_TTL_BUCKETS = 60;
const encoder = new TextEncoder();

function bucketNow(): number {
  return Math.floor(Date.now() / 60_000);
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sign(bucket: number, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(String(bucket))));
}

export async function signRoomToken(secret: string): Promise<string> {
  const bucket = bucketNow();
  return `${bucket}.${await sign(bucket, secret)}`;
}

export async function verifyRoomToken(
  token: string | null,
  secret: string
): Promise<{ ok: true; bucket: number } | { ok: false }> {
  if (!token) return { ok: false };
  const [bucketStr, sig] = token.split('.');
  if (!bucketStr || !sig || !/^\d+$/.test(bucketStr)) return { ok: false };

  const bucket = Number(bucketStr);
  const now = bucketNow();
  // 不接受未来时间，也不接受过期太久的（允许 1 小时）
  if (bucket > now || now - bucket > TOKEN_TTL_BUCKETS) return { ok: false };

  const expected = await sign(bucket, secret);
  // 定长十六进制字符串，逐字符比较即可
  if (sig.length !== expected.length) return { ok: false };
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return { ok: false };

  return { ok: true, bucket };
}
