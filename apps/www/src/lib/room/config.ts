/** 房间服务地址。本地开发跑 room-worker (wrangler dev，默认 8787)，线上填部署后的域名 */
export const ROOM_WS_BASE =
  (import.meta.env.VITE_ROOM_WS_BASE as string | undefined) ?? 'ws://localhost:8787';

/** 把访问凭证附在 WS URL 上，room-worker 在握手阶段验签 */
function withToken(path: string, token: string): string {
  const url = `${ROOM_WS_BASE.replace(/\/$/, '')}${path}`;
  return token ? `${url}?token=${encodeURIComponent(token)}` : url;
}

export function roomSocketUrl(roomId: string, token: string): string {
  return withToken(`/ws/${roomId}`, token);
}

export function matchSocketUrl(token: string): string {
  return withToken('/ws/match', token);
}

const ROOM_ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 生成 6 位房间号，去掉易混淆的 I/O/0/1 */
export function generateRoomId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ROOM_ID_CHARS[b % ROOM_ID_CHARS.length]).join('');
}

export function normalizeRoomId(input: string): string {
  return input.trim().toUpperCase();
}

export function isValidRoomId(input: string): boolean {
  return /^[A-Z0-9]{4,12}$/.test(normalizeRoomId(input));
}
