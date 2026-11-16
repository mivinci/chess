import assert from 'node:assert/strict';
import {
  BLACK,
  ChessGame,
  generateLegalMoves,
  idx,
  isInCheck,
  KING,
  RED,
  ROOK,
  type Board
} from '../src/lib/chess/index';

const game = new ChessGame();
assert.equal(game.board.filter((p) => p !== 0).length, 32, '开局应有 32 枚棋子');

const opening = game.legalMoves();
console.log('红方开局合法着法:', opening.length);
assert.ok(opening.length >= 40, '开局着法数异常');

const mv = game.move(idx(7, 7), idx(4, 7));
assert.ok(mv, '炮二平五应为合法着法');
console.log('记谱:', game.notations[0]);
assert.equal(game.turn, BLACK, '走完后应轮到黑方');

game.undo();
assert.equal(game.turn, RED, '悔棋后应回到红方');
assert.equal(game.board[idx(7, 7)], 6, '悔棋后炮应回到原位');
assert.equal(game.board[idx(4, 7)], 0, '悔棋后目标格应为空');

const b: Board = new Int8Array(90);
b[idx(4, 9)] = KING;
b[idx(4, 0)] = -KING;
b[idx(4, 5)] = ROOK;
assert.equal(isInCheck(b, BLACK), true, '红车同列应将军黑将');
assert.equal(isInCheck(b, RED), false, '红帅未被将军');

b[idx(4, 5)] = 0;
assert.equal(isInCheck(b, BLACK), true, '将帅照面应判为被将');
b[idx(4, 5)] = ROOK;

b[idx(4, 5)] = 0;
b[idx(4, 9)] = 0;
b[idx(3, 9)] = KING;
b[idx(0, 5)] = ROOK;
assert.equal(isInCheck(b, BLACK), false, '红车离开同列后应将军解除');

const mate: Board = new Int8Array(90);
mate[idx(4, 0)] = -KING;
mate[idx(4, 9)] = KING;
mate[idx(4, 2)] = ROOK;
mate[idx(3, 1)] = ROOK;
mate[idx(5, 1)] = ROOK;
assert.equal(isInCheck(mate, BLACK), true, '将死局面应处于被将状态');
assert.equal(generateLegalMoves(mate, BLACK).length, 0, '将死局面不应有合法着法');

console.log('规则引擎冒烟测试全部通过');
