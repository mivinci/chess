import { Hono } from 'hono';
import { z } from 'zod';
import { GameRoom } from './GameRoom';
import { MatchQueue } from './MatchQueue';
import { verifyRoomToken } from '../../www/src/lib/room/token';

export { GameRoom, MatchQueue };

const app = new Hono<{ Bindings: Env }>();

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

app.options('*', (c) => new Response(null, { status: 204, headers: CORS }));
app.get('/health', (c) => c.json({ ok: true }, 200, CORS));

// WS 握手前校验凭证 + 限流。CORS 头只加在普通响应上，不碰 101 升级响应
app.use('/ws/*', async (c, next) => {
  const result = await verifyRoomToken(c.req.query('token') ?? null, c.env.ROOM_TOKEN_SECRET);
  if (!result.ok) return new Response('Forbidden - invalid token', { status: 403, headers: CORS });
  const { success } = await c.env.WS_CONNECT_LIMIT.limit({ key: String(result.bucket) });
  if (!success) return new Response('Too Many Requests', { status: 429, headers: CORS });
  await next();
});

// 人机对局存档：把历史写入 DO，供日后从复盘分支
const ArchiveSchema = z.object({
  id: z.string().regex(/^[A-Z0-9]{4,12}$/),
  history: z.array(z.object({
    from: z.number().int().min(0).max(89),
    to: z.number().int().min(0).max(89),
    captured: z.number().int()
  })).max(500),
  notations: z.array(z.string().max(32)).max(500)
});

app.post('/archive', async (c) => {
  const result = await verifyRoomToken(c.req.query('token') ?? null, c.env.ROOM_TOKEN_SECRET);
  if (!result.ok) return new Response('Forbidden', { status: 403, headers: CORS });

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return new Response('Bad Request', { status: 400, headers: CORS });
  }
  const parsed = ArchiveSchema.safeParse(body);
  if (!parsed.success) return new Response('Bad Request', { status: 400, headers: CORS });

  const { id, history, notations } = parsed.data;
  const stub = c.env.GAME_ROOM.get(c.env.GAME_ROOM.idFromName(id));
  await stub.saveArchive(history, notations);
  return c.json({ ok: true }, 200, CORS);
});

/** 全局盘面榜：按 (父局, 步数) 聚合引用数。带 parent/step 时精确取单条，否则取前 10 */
app.get('/boards', async (c) => {
  const result = await verifyRoomToken(c.req.query('token') ?? null, c.env.ROOM_TOKEN_SECRET);
  if (!result.ok) return new Response('Forbidden', { status: 403, headers: CORS });

  const parent = c.req.query('parent')?.toUpperCase();
  const step = Number(c.req.query('step'));
  const exact = parent && /^[A-Z0-9]{4,12}$/.test(parent) && Number.isInteger(step) && step >= 1;
  const sql = exact
    ? `SELECT parent_id AS parentId, step, COUNT(*) AS count,
              MAX(history) AS history, MAX(notations) AS notations
       FROM boards WHERE parent_id = ? AND step = ?
       GROUP BY parent_id, step`
    : `SELECT parent_id AS parentId, step, COUNT(*) AS count,
              MAX(history) AS history, MAX(notations) AS notations
       FROM boards
       GROUP BY parent_id, step
       ORDER BY count DESC, MAX(created_at) DESC
       LIMIT 10`;
  const stmt = c.env.BOARDS_DB.prepare(sql);
  const rows = await (exact ? stmt.bind(parent, step) : stmt).all();
  return c.json({ boards: rows.results }, 200, CORS);
});

app.get('/ws/match', (c) => {
  const stub = c.env.MATCH_QUEUE.get(c.env.MATCH_QUEUE.idFromName('global'));
  return stub.fetch(c.req.raw);
});

app.get('/ws/:roomId', (c) => {
  const roomId = c.req.param('roomId');
  if (!/^[a-zA-Z0-9]{4,12}$/.test(roomId)) {
    return new Response('Not found', { status: 404, headers: CORS });
  }
  const id = c.env.GAME_ROOM.idFromName(roomId.toUpperCase());
  return c.env.GAME_ROOM.get(id).fetch(c.req.raw);
});

export default app;
