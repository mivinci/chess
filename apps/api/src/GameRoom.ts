import { DurableObject } from 'cloudflare:workers';
import { canMoveAt, decideAlarm, TIMEOUT_GRACE_MS } from './timeout';
import { ChessGame, type GameStatus } from '../../www/src/lib/chess/game';
import type { Move, Side } from '../../www/src/lib/chess/types';

import { z } from 'zod';

const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('join'),
    name: z.string().max(16).optional(),
    isAI: z.boolean().optional()
  }),
  z.object({
    type: z.literal('move'),
    from: z.number().int().min(0).max(89),
    to: z.number().int().min(0).max(89)
  }),
  z.object({ type: z.literal('reset') })
]);
type ClientMessage = z.infer<typeof ClientMessageSchema>;

interface SeatInfo {
  name: string;
  side: Side;
  isAI?: boolean;
}

const TURN_MS = 60_000;
const DEADLINE_KEY = 'turnDeadline';
const TURN_KEY = 'turnAtDeadline';
/** 本次计时开始时的历史步数，用于 alarm 醒来时判断是否已有走子 */
const TURN_MOVES_KEY = 'turnMoves';
/** alarm 是否已为当前计时安排过宽限重预约，避免反复推迟永不判负 */
const GRACE_SCHEDULED_KEY = 'graceScheduled';
const RESULT_KEY = 'result';
const END_REASON_KEY = 'endReason';
/** 终局后多少天清理棋谱存储（保留结果与分支元数据） */
const ARCHIVE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CLEANUP_AT_KEY = 'cleanupAt';

interface Snapshot {
  board: number[];
  turn: Side;
  status: GameStatus;
  endReason?: 'checkmate' | 'timeout';
  history: Move[];
  notations: string[];
  players: SeatInfo[];
  deadline: number | null;
  parentId?: string;
  step?: number;
  forkError?: { parentId: string; step: number } | null;
}

export class GameRoom extends DurableObject {
  private state: DurableObjectState;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.state = state;
  }

  /** 供分支房间通过 DO RPC 读取历史。DO 存储过期后从 D1 board 表兜底，保证分支链不断 */
  async getHistory(roomId?: string): Promise<{ history: Move[]; notations: string[] }> {
    const history = (await this.state.storage.get<Move[]>('history')) ?? [];
    const notations = (await this.state.storage.get<string[]>('notations')) ?? [];
    if (history.length > 0) return { history, notations };

    // 本房间棋谱已清理：从 board 表找一条引用了本房间历史的行，拿它存的完整快照
    const lookupId = roomId?.toUpperCase();
    if (!lookupId || !/^[A-Z0-9]{4,12}$/.test(lookupId)) return { history, notations };
    try {
      const row = await this.env.BOARDS_DB.prepare(
        'SELECT history, notations FROM boards WHERE parent_id = ? LIMIT 1'
      )
        .bind(lookupId)
        .first<{ history: string; notations: string }>();
      if (!row) return { history, notations };
      return {
        history: JSON.parse(row.history) as Move[],
        notations: JSON.parse(row.notations) as string[]
      };
    } catch {
      return { history, notations };
    }
  }

  /** 人机对局存档：把历史写入一个纯数据 DO，供日后分支 */
  async saveArchive(history: Move[], notations: string[]): Promise<void> {
    const existing = (await this.state.storage.get<Move[]>('history')) ?? [];
    // 已存档过就不覆盖，避免误写
    if (existing.length > 0) return;
    await this.state.storage.put({
      history,
      notations,
      archived: true,
      forkInitialized: true
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    // 分支房间首次连接时，从父棋局取前 step 步作为初始局面
    await this.initFromParent(request.url);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** from=父房间号, step=从第几步分叉。成功后只跑一次；失败留标记供前端提示和重试 */
  private async initFromParent(url: string): Promise<void> {
    if (await this.state.storage.get<boolean>('forkInitialized')) return;
    const u = new URL(url);
    const parentId = u.searchParams.get('from')?.toUpperCase();
    const step = Number(u.searchParams.get('step'));
    if (!parentId || !/^[A-Z0-9]{4,12}$/.test(parentId)) return;
    if (!Number.isInteger(step) || step < 1 || step > 200) return;

    try {
      const id = this.env.GAME_ROOM.idFromName(parentId);
      const parent = this.env.GAME_ROOM.get(id);
      const { history, notations } = await parent.getHistory(parentId);
      // 父局还没走到 step 步，视为失败，不要截出半截棋
      if (history.length < step) throw new Error('parent history too short');
      const prefix = history.slice(0, step);
      await this.state.storage.put({
        history: prefix,
        notations: notations.slice(0, step),
        parentId,
        step,
        forkInitialized: true,
        forkError: null
      });
      // 记一票到全局盘面榜。失败不影响分支本身——榜单是增强功能
      const forkId = this.state.id.toString();
      try {
        await this.env.BOARDS_DB.prepare(
          'INSERT OR IGNORE INTO boards (parent_id, step, fork_id, history, notations, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
          .bind(parentId, step, forkId, JSON.stringify(history), JSON.stringify(notations), Date.now())
          .run();
      } catch {
        // D1 不可用时静默跳过，这盘仍能玩
      }
    } catch {
      await this.state.storage.put({ forkError: { parentId, step, at: Date.now() } });
    }
  }

  /** 座位存在连接上，休眠恢复后依然在 */
  private seats(): { ws: WebSocket; info: SeatInfo }[] {
    return this.state
      .getWebSockets()
      .map((ws) => ({ ws, info: ws.deserializeAttachment() as SeatInfo | null }))
      .filter((s): s is { ws: WebSocket; info: SeatInfo } => s.info !== null);
  }

  /** 从持久化的走子历史重建棋盘，避免依赖内存状态 */
  private async loadGame(): Promise<ChessGame> {
    const game = new ChessGame();
    const history = (await this.state.storage.get<Move[]>('history')) ?? [];
    for (const m of history) game.move(m.from, m.to);
    return game;
  }

  private async snapshot(game: ChessGame, seats: { info: SeatInfo }[]): Promise<Snapshot> {
    const deadline = (await this.state.storage.get<number>(DEADLINE_KEY)) ?? null;
    const storedResult = await this.state.storage.get<GameStatus>(RESULT_KEY);
    const storedEndReason = await this.state.storage.get<'checkmate' | 'timeout'>(END_REASON_KEY);
    const storedParentId = await this.state.storage.get<string>('parentId');
    const storedStep = await this.state.storage.get<number>('step');
    const forkError = await this.state.storage.get<{ parentId: string; step: number }>('forkError');
    const status = storedResult && storedResult !== 'playing' ? storedResult : game.status;
    return {
      board: Array.from(game.board),
      turn: game.turn,
      status,
      ...(storedEndReason ? { endReason: storedEndReason } : {}),
      history: game.history,
      notations: game.notations,
      players: seats.map((s) => s.info),
      deadline: game.status === 'playing' && seats.length === 2 ? deadline : null,
      ...(storedParentId && storedStep ? { parentId: storedParentId, step: storedStep } : {}),
      ...(forkError ? { forkError } : {})
    };
  }

  /** 走子后重置这一方的 60 秒计时。moveCount 用于 alarm 核对是否已有新走子 */
  private async startClock(side: Side, moveCount: number): Promise<number> {
    const deadline = Date.now() + TURN_MS;
    await this.state.storage.put({
      [DEADLINE_KEY]: deadline,
      [TURN_KEY]: side,
      [TURN_MOVES_KEY]: moveCount,
      [GRACE_SCHEDULED_KEY]: false
    });
    await this.state.storage.setAlarm(deadline);
    return deadline;
  }

  private async stopClock(): Promise<void> {
    await this.state.storage.delete(DEADLINE_KEY);
    await this.state.storage.delete(TURN_KEY);
    await this.state.storage.delete(TURN_MOVES_KEY);
    await this.state.storage.delete(GRACE_SCHEDULED_KEY);
    await this.state.storage.deleteAlarm();
  }

  /** 终局后安排一次棋谱清理；alarm 到期时根据 cleanupAt 区分清理与超时 */
  private async scheduleCleanup(): Promise<void> {
    await this.state.storage.put(CLEANUP_AT_KEY, Date.now() + ARCHIVE_TTL_MS);
    await this.state.storage.setAlarm(Date.now() + ARCHIVE_TTL_MS);
  }

  /** 超时判负：带宽限窗口 + 步数核对，避免最后一秒的走子被误判 */
  async alarm(): Promise<void> {
    // 清理 alarm：删棋谱存储，保留结果与分支元数据（房间状态仍正确，分支仍能追溯）
    const cleanupAt = await this.state.storage.get<number>(CLEANUP_AT_KEY);
    if (cleanupAt !== undefined && Date.now() >= cleanupAt) {
      await this.state.storage.delete(CLEANUP_AT_KEY);
      await this.state.storage.delete('history');
      await this.state.storage.delete('notations');
      return;
    }

    const deadline = await this.state.storage.get<number>(DEADLINE_KEY);
    const turnAt = await this.state.storage.get<Side>(TURN_KEY);
    if (turnAt === undefined) return;

    const game = await this.loadGame();
    if (game.status !== 'playing' || game.turn !== turnAt) return;

    const decision = decideAlarm({
      now: Date.now(),
      deadline,
      movesAtStart: await this.state.storage.get<number>(TURN_MOVES_KEY),
      currentMoves: game.history.length,
      graceScheduled: await this.state.storage.get<boolean>(GRACE_SCHEDULED_KEY)
    });
    if (decision.action === 'skip') return;
    if (decision.action === 'reschedule') {
      await this.state.storage.put(GRACE_SCHEDULED_KEY, true);
      await this.state.storage.setAlarm(decision.at);
      return;
    }

    await this.stopClock();
    const loser = turnAt;
    const result: GameStatus = loser === 1 ? 'black-win' : 'red-win';
    await this.state.storage.put({ [RESULT_KEY]: result, [END_REASON_KEY]: 'timeout' });
    await this.scheduleCleanup();
    this.broadcast(this.seats(), { type: 'timeout', loser, status: result });
  }

  private parseMessage(raw: string | ArrayBuffer): ClientMessage | null {
    if (typeof raw !== 'string') return null;
    try {
      const parsed = ClientMessageSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const msg = this.parseMessage(raw);
    if (!msg) {
      this.send(ws, { type: 'error', message: '消息格式错误' });
      return;
    }

    const game = await this.loadGame();
    const seats = this.seats();

    if (msg.type === 'join') {
      if (!ws.deserializeAttachment()) {
        if (seats.length >= 2) {
          this.send(ws, { type: 'error', message: '房间已满' });
          ws.close();
          return;
        }
        const taken = new Set(seats.map((s) => s.info.side));
        const side: Side = taken.has(1) ? -1 : 1;
        const info: SeatInfo = { name: msg.name ?? '玩家', side, ...(msg.isAI ? { isAI: true } : {}) };
        ws.serializeAttachment(info);
        seats.push({ ws, info });
      }
      const joinedSide = (ws.deserializeAttachment() as SeatInfo | null)?.side;
      const snap = await this.snapshot(game, seats);
      this.send(ws, { type: 'joined', side: joinedSide, ...snap });
      this.broadcast(seats, { type: 'opponent', ...snap });
      // 两人到齐且对局进行中才开始计时
      if (seats.length === 2 && game.status === 'playing') {
        const deadline = await this.startClock(game.turn, game.history.length);
        this.broadcast(seats, { type: 'clock', deadline, turn: game.turn });
      }
      return;
    }

    const seat = seats.find((s) => s.ws === ws);
    if (!seat) {
      this.send(ws, { type: 'error', message: '你还没加入房间' });
      return;
    }

    if (msg.type === 'move') {
      if (seats.length < 2) {
        this.send(ws, { type: 'error', message: '等待对手加入' });
        return;
      }
      // 对局已结束（可能被 alarm 判负）——拒绝任何走子，避免覆盖结果
      const alreadyResult = await this.state.storage.get<GameStatus>(RESULT_KEY);
      if (alreadyResult) {
        this.send(ws, { type: 'error', message: '对局已结束' });
        return;
      }
      // 走子到达时已超时（含宽限）——拒绝，并让 alarm 立即判负
      const currentDeadline = await this.state.storage.get<number>(DEADLINE_KEY);
      if (!canMoveAt(Date.now(), currentDeadline)) {
        await this.state.storage.setAlarm(Date.now());
        this.send(ws, { type: 'error', message: '已超时' });
        return;
      }
      if (game.turn !== seat.info.side) {
        this.send(ws, { type: 'error', message: '还没轮到你' });
        return;
      }
      if (!game.move(msg.from, msg.to)) {
        this.send(ws, { type: 'error', message: '非法着法' });
        return;
      }
      // 二次核对：上面几个 await 期间 alarm 可能已判负，不能在结果落定后覆盖历史
      if (await this.state.storage.get<GameStatus>(RESULT_KEY)) {
        this.send(ws, { type: 'error', message: '对局已结束' });
        return;
      }
      await this.state.storage.put({
        history: game.history,
        notations: game.notations
      });
      if (game.status !== 'playing') {
        await this.stopClock();
        await this.state.storage.put({ [RESULT_KEY]: game.status, [END_REASON_KEY]: 'checkmate' });
        await this.scheduleCleanup();
      }
      const deadline =
        game.status === 'playing' ? await this.startClock(game.turn, game.history.length) : null;
      this.broadcast(seats, {
        type: 'move',
        move: game.lastMove,
        notation: game.notations[game.notations.length - 1],
        turn: game.turn,
        status: game.status,
        history: game.history,
        deadline
      });
    } else if (msg.type === 'reset') {
      await this.state.storage.put({ history: [], notations: [] });
      await this.state.storage.delete(RESULT_KEY);
      await this.state.storage.delete(END_REASON_KEY);
      await this.state.storage.delete(CLEANUP_AT_KEY);
      const deadline = await this.startClock(1, 0);
      const fresh = new ChessGame();
      this.broadcast(seats, {
        type: 'reset',
        ...this.snapshot(fresh, seats),
        deadline
      });
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const info = ws.deserializeAttachment() as SeatInfo | undefined;
    const seats = this.seats().filter((s) => s.ws !== ws);
    if (info) this.broadcast(seats, { type: 'leave', side: info.side, name: info.name });
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  private send(ws: WebSocket, payload: unknown) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }

  private broadcast(seats: { ws: WebSocket }[], payload: unknown) {
    for (const seat of seats) this.send(seat.ws, payload);
  }
}
