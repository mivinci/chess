import assert from 'node:assert/strict';
import { signRoomToken } from '../src/lib/room/token';

const SECRET = 'dev-only-change-me-in-production';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const token = await signRoomToken(SECRET);

function client(label: string) {
  return new Promise<{
    ws: WebSocket;
    msgs: Record<string, unknown>[];
    send: (o: unknown) => void;
    last: (type: string) => Record<string, unknown> | undefined;
  }>((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:8787/ws/match?token=${encodeURIComponent(token)}`);
    const msgs: Record<string, unknown>[] = [];
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data as string);
      msgs.push(m);
      console.log(label, '收到', m.type);
    };
    ws.onopen = () =>
      resolve({
        ws,
        msgs,
        send: (o) => ws.send(JSON.stringify(o)),
        last: (type) => [...msgs].reverse().find((m) => m.type === type)
      });
    ws.onerror = reject;
  });
}

// 带有效 token 的两人正常配对
const a = await client('A');
a.send({ type: 'queue' });
await wait(200);
assert.equal(a.last('queued')?.position, 1);

const b = await client('B');
b.send({ type: 'queue' });
await wait(300);
assert.ok(a.last('matched') && b.last('matched'), '带 token 双方应正常配对');
assert.equal(a.last('matched')?.roomId, b.last('matched')?.roomId);
console.log('带凭证的匹配流程通过:', a.last('matched')?.roomId);

a.ws.close();
b.ws.close();
process.exit(0);
