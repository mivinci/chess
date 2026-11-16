import { env } from 'cloudflare:workers';
import { signRoomToken } from '#lib/room/token';
import type { LayoutServerLoad } from './$types';

/** 签发房间服务凭证，注入到所有页面的 page.data，前端连 WebSocket 时带上 */
export const load: LayoutServerLoad = async () => {
  const secret = (env as unknown as { ROOM_TOKEN_SECRET?: string }).ROOM_TOKEN_SECRET;
  return {
    roomToken: secret ? await signRoomToken(secret) : ''
  };
};
