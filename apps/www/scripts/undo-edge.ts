import assert from 'node:assert/strict';
import { ChessGame, idx } from '../src/lib/chess/index';

// 悔棋回到开局：连续走 4 步后全悔
const g = new ChessGame();
const seq: [number, number][] = [
  [idx(7, 7), idx(4, 7)],
  [idx(1, 0), idx(2, 2)],
  [idx(7, 9), idx(6, 7)],
  [idx(8, 0), idx(8, 2)]
];
for (const [from, to] of seq) {
  assert.ok(g.move(from, to), '测试着法应合法');
}
assert.equal(g.history.length, 4);
assert.equal(g.pieceIds.filter((id) => id !== 0).length, 32);
for (let i = 0; i < 4; i++) assert.ok(g.undo());
assert.equal(g.history.length, 0, '全部悔棋后历史应清空');
assert.equal(g.board[idx(7, 7)], 6, '开局炮应在原位');
assert.equal(g.pieceIds[idx(7, 7)] > 0, true, '棋子身份应恢复');
assert.equal(g.notations.length, 0);

// 吃子后悔棋：被吃棋子(id)应复活到原格
const c = new ChessGame();
c.board.fill(0);
c.pieceIds.fill(0);
c.board[idx(4, 9)] = 1;
c.pieceIds[idx(4, 9)] = 1;
c.board[idx(4, 5)] = 5;
c.pieceIds[idx(4, 5)] = 50;
c.board[idx(4, 4)] = -7;
c.pieceIds[idx(4, 4)] = 77;
assert.ok(c.move(idx(4, 5), idx(4, 4)));
assert.equal(c.pieceIds[idx(4, 4)], 50);
assert.ok(c.undo());
assert.equal(c.board[idx(4, 4)], -7, '被吃棋子应复活');
assert.equal(c.pieceIds[idx(4, 4)], 77, '被吃棋子身份应复活');
assert.equal(c.board[idx(4, 5)], 5, '吃子方应退回');

// reset 后 id 与 board 完全一致
c.reset();
for (let i = 0; i < 90; i++) {
  assert.equal(c.board[i] !== 0, c.pieceIds[i] !== 0, `格 ${i} 的棋子与身份应一致`);
}

console.log('悔棋与重置边界测试通过');
