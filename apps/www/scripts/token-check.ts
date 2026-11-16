import assert from 'node:assert/strict';
import { signRoomToken, verifyRoomToken } from '../src/lib/room/token';

const SECRET = 'test-secret';

const token = await signRoomToken(SECRET);
assert.equal((await verifyRoomToken(token, SECRET)).ok, true, '有效 token 应通过');
assert.equal((await verifyRoomToken(token, 'wrong-secret')).ok, false, '错误密钥应拒绝');
assert.equal((await verifyRoomToken('garbage', SECRET)).ok, false, '乱码应拒绝');
assert.equal((await verifyRoomToken(null, SECRET)).ok, false, '空 token 应拒绝');

const bucket = Math.floor(Date.now() / 60_000);
assert.equal(
  (await verifyRoomToken(`${bucket}.${'0'.repeat(64)}`, SECRET)).ok,
  false,
  '伪造签名应拒绝'
);

const [b, sig] = token.split('.');
assert.equal(
  (await verifyRoomToken(`${Number(b) + 5}.${sig}`, SECRET)).ok,
  false,
  '未来时间的 token 应拒绝'
);

// 同一分钟内两次签发应完全一致（这是按分钟限流的前提）
assert.equal(await signRoomToken(SECRET), token, '同一分钟签发的 token 应相同');
console.log('token 校验全部通过');
