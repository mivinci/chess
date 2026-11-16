import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';

/** 排队超时：60 秒没配上就提示 */
const WAIT_MS = 60_000;
const ROOM_ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('queue') }),
  z.object({ type: z.literal('cancel') })
]);
type ClientMessage = z.infer<typeof ClientMessageSchema>;

interface Waiter {
  ws: WebSocket;
  /** 入队时间戳，存在 attachment 里，休眠恢复不丢 */
  enqueuedAt: number;
}

export class MatchQueue extends DurableObject {
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

  /** 已入队、未匹配的等待者，按入队时间 FIFO。attachment 不是 number 的就是没排队 */
  private waiters(): Waiter[] {
    return this.state
      .getWebSockets()
      .map((ws) => ({ ws, enqueuedAt: ws.deserializeAttachment() as number }))
      .filter((w): w is Waiter => typeof w.enqueuedAt === 'number' && w.enqueuedAt > 0)
      .sort((a, b) => a.enqueuedAt - b.enqueuedAt);
  }

  /** DO 只有一个 alarm，永远指向最早入队者的超时点 */
  private async rearmAlarm(): Promise<void> {
    const waiters = this.waiters();
    if (waiters.length === 0) {
      await this.state.storage.deleteAlarm();
      return;
    }
    await this.state.storage.setAlarm(waiters[0].enqueuedAt + WAIT_MS);
  }

  /** 把当前队列位置广播给所有等待者，前端显示「第 N 位」 */
  private announceQueue(): void {
    const waiters = this.waiters();
    waiters.forEach((w, i) => this.send(w.ws, { type: 'queued', position: i + 1, waiting: waiters.length }));
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

    if (msg.type === 'queue') {
      const current = ws.deserializeAttachment() as number | null;
      if (typeof current === 'number' && current > 0) {
        this.announceQueue();
        return;
      }

      const now = Date.now();
      ws.serializeAttachment(now);
      const waiters = this.waiters();

      if (waiters.length >= 2) {
        const self = waiters.find((w) => w.ws === ws)!;
        const opponent = waiters.find((w) => w.ws !== ws)!;
        const roomId = this.generateRoomId();

        // 先摘掉 attachment，防止关闭过程中被当成还在排队
        for (const w of [opponent, self]) w.ws.serializeAttachment(null);
        for (const w of [opponent, self]) this.send(w.ws, { type: 'matched', roomId });
        for (const w of [opponent, self]) w.ws.close(1000, 'matched');

        await this.rearmAlarm();
        return;
      }

      this.announceQueue();
      await this.rearmAlarm();
      return;
    }

    if (msg.type === 'cancel') {
      const current = ws.deserializeAttachment() as number | null;
      if (typeof current === 'number' && current > 0) {
        ws.serializeAttachment(null);
        this.send(ws, { type: 'cancelled' });
        this.announceQueue();
        await this.rearmAlarm();
      }
    }
  }

  /** 超时清理：只踢过期的人，然后重置 alarm 指向下一个 */
  async alarm(): Promise<void> {
    const now = Date.now();
    const expired = this.waiters().filter((w) => now >= w.enqueuedAt + WAIT_MS);
    for (const w of expired) {
      w.ws.serializeAttachment(null);
      this.send(w.ws, { type: 'timeout' });
      w.ws.close(1000, 'timeout');
    }
    if (expired.length) {
      this.announceQueue();
      await this.rearmAlarm();
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const current = ws.deserializeAttachment() as number | null;
    if (typeof current === 'number' && current > 0) {
      ws.serializeAttachment(null);
      this.announceQueue();
      await this.rearmAlarm();
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  private generateRoomId(): string {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => ROOM_ID_CHARS[b % ROOM_ID_CHARS.length]).join('');
  }

  private send(ws: WebSocket, payload: unknown) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }
}
