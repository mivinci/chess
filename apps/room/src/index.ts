import { GameRoom } from './GameRoom';
import { MatchQueue } from './MatchQueue';
import { verifyRoomToken } from '../../www/src/lib/room/token';

export { GameRoom, MatchQueue };

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

/** WS 握手前校验凭证 + 限流。通过则返回 null，否则返回错误响应 */
async function guard(url: URL, env: Env): Promise<Response | null> {
  const token = url.searchParams.get('token');
  const result = await verifyRoomToken(token, env.ROOM_TOKEN_SECRET);
  if (!result.ok) {
    return new Response('Forbidden - invalid token', { status: 403, headers: CORS_HEADERS });
  }
  // 按分钟桶限流：同一分钟内所有人共用一份配额，不用 IP（会误伤移动网络/代理用户）
  const { success } = await env.WS_CONNECT_LIMIT.limit({ key: String(result.bucket) });
  if (!success) {
    return new Response('Too Many Requests', { status: 429, headers: CORS_HEADERS });
  }
  return null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // /health 用于检查 worker 是否活着
    if (url.pathname === '/health') {
      return Response.json({ ok: true }, { headers: CORS_HEADERS });
    }

    const isMatch = url.pathname === '/ws/match';
    const roomMatch = isMatch ? null : url.pathname.match(/^\/ws\/([a-zA-Z0-9]{4,12})$/);
    if (!isMatch && !roomMatch) {
      return new Response('Not found', { status: 404, headers: CORS_HEADERS });
    }
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426, headers: CORS_HEADERS });
    }

    const denied = await guard(url, env);
    if (denied) return denied;

    if (isMatch) {
      const stub = env.MATCH_QUEUE.get(env.MATCH_QUEUE.idFromName('global'));
      return stub.fetch(request);
    }

    const roomId = roomMatch![1].toUpperCase();
    const id = env.GAME_ROOM.idFromName(roomId);
    const stub = env.GAME_ROOM.get(id);
    return stub.fetch(request);
  }
};
