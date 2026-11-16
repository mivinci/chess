import { DurableObject } from 'cloudflare:workers';
import { ChessGame, type GameStatus } from '../../www/src/lib/chess/game';
import type { Move, Side } from '../../www/src/lib/chess/types';

type ClientMessage =
  | { type: 'join'; name?: string }
  | { type: 'move'; from: number; to: number }
  | { type: 'reset' };

interface SeatInfo {
  name: string;
  side: Side;
}

const TURN_MS = 30_000;
const DEADLINE_KEY = 'turnDeadline';
const TURN_KEY = 'turnAtDeadline';
const RESULT_KEY = 'result';

interface Snapshot {
  board: number[];
  turn: Side;
  status: GameStatus;
  history: Move[];
  notations: string[];
  players: SeatInfo[];
  deadline: number | null;
}

export class GameRoom extends DurableObject {
  private state: DurableObjectState;

  constructor(state: DurableObjectState, _env: Env) {
    super(state, _env);
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
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
    const status = storedResult && storedResult !== 'playing' ? storedResult : game.status;
    return {
      board: Array.from(game.board),
      turn: game.turn,
      status,
      history: game.history,
      notations: game.notations,
      players: seats.map((s) => s.info),
      deadline: game.status === 'playing' && seats.length === 2 ? deadline : null
    };
  }

  /** 走子后重置这一方的 30 秒计时 */
  private async startClock(side: Side): Promise<number> {
    const deadline = Date.now() + TURN_MS;
    await this.state.storage.put({
      [DEADLINE_KEY]: deadline,
      [TURN_KEY]: side
    });
    await this.state.storage.setAlarm(deadline);
    return deadline;
  }

  private async stopClock(): Promise<void> {
    await this.state.storage.delete(DEADLINE_KEY);
    await this.state.storage.delete(TURN_KEY);
    await this.state.storage.deleteAlarm();
  }

  /** 超时判负：重新读状态核对，避免已走子后旧 alarm 误判 */
  async alarm(): Promise<void> {
    const deadline = await this.state.storage.get<number>(DEADLINE_KEY);
    const turnAt = await this.state.storage.get<Side>(TURN_KEY);
    if (!deadline || turnAt === undefined || Date.now() < deadline) return;

    const game = await this.loadGame();
    if (game.status !== 'playing' || game.turn !== turnAt) return;

    // 直接把结果写进历史之外的一个标记，广播给客户端
    await this.stopClock();
    const loser = turnAt;
    const result: GameStatus = loser === 1 ? 'black-win' : 'red-win';
    await this.state.storage.put(RESULT_KEY, result);
    this.broadcast(this.seats(), { type: 'timeout', loser, status: result });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string') return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
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
        const info: SeatInfo = { name: msg.name ?? '玩家', side };
        ws.serializeAttachment(info);
        seats.push({ ws, info });
      }
      const joinedSide = (ws.deserializeAttachment() as SeatInfo | null)?.side;
      const snap = await this.snapshot(game, seats);
      this.send(ws, { type: 'joined', side: joinedSide, ...snap });
      this.broadcast(seats, { type: 'opponent', ...snap });
      // 两人到齐且对局进行中才开始计时
      if (seats.length === 2 && game.status === 'playing') {
        const deadline = await this.startClock(game.turn);
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
      if (game.turn !== seat.info.side) {
        this.send(ws, { type: 'error', message: '还没轮到你' });
        return;
      }
      if (!game.move(msg.from, msg.to)) {
        this.send(ws, { type: 'error', message: '非法着法' });
        return;
      }
      await this.state.storage.put({
        history: game.history,
        notations: game.notations
      });
      if (game.status !== 'playing') {
        await this.stopClock();
        await this.state.storage.put(RESULT_KEY, game.status);
      }
      const deadline = game.status === 'playing' ? await this.startClock(game.turn) : null;
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
      const deadline = await this.startClock(1);
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
