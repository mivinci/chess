import assert from 'node:assert/strict';
import http from 'node:http';
import { signRoomToken } from '../src/lib/room/token';

const SECRET = 'dev-only-change-me-in-production';

/** 连不上（被拒）的场景：拿 HTTP 状态码 */
function rejectedStatus(path: string) {
  return new Promise<number | undefined>((resolve, reject) => {
    const req = http.request(
      {
        host: 'localhost',
        port: 8787,
        path,
        method: 'GET',
        headers: {
          Upgrade: 'websocket',
          Connection: 'Upgrade',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version': '13'
        }
      },
      (res) => {
        resolve(res.statusCode);
        res.destroy();
      }
    );
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

assert.equal(await rejectedStatus('/ws/match'), 403, '无 token 应 403');
console.log('无 token: 403');
assert.equal(await rejectedStatus('/ws/match?token=fake.signature'), 403, '伪造 token 应 403');
console.log('伪造 token: 403');

const wrong = await signRoomToken('wrong-secret');
assert.equal(
  await rejectedStatus(`/ws/match?token=${encodeURIComponent(wrong)}`),
  403,
  '错误密钥 token 应 403'
);
console.log('错误密钥: 403');

/** 有效 token：真正建 WS 连接，应能入队 */
const good = await signRoomToken(SECRET);
const ws = new WebSocket(`ws://localhost:8787/ws/match?token=${encodeURIComponent(good)}`);
const queued = await new Promise<{ position: number }>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('有效 token 未收到 queued')), 3000);
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data as string);
    if (m.type === 'queued') {
      clearTimeout(timer);
      resolve(m);
    }
  };
  ws.onerror = () => {
    clearTimeout(timer);
    reject(new Error('有效 token 连接被拒'));
  };
  ws.onopen = () => ws.send(JSON.stringify({ type: 'queue' }));
});
assert.equal(queued.position, 1);
console.log('有效 token: 连接成功并入队');
ws.close();

console.log('WS 鉴权全部通过');
process.exit(0);
