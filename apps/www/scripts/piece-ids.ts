import assert from 'node:assert/strict';
import { ChessGame, idx } from '../src/lib/chess/index';

const game = new ChessGame();

// 开局：32 颗棋子各有唯一身份，位置与棋子一一对应
const initialIds = Array.from(game.pieceIds);
assert.equal(initialIds.filter((id) => id !== 0).length, 32);
assert.equal(new Set(initialIds.filter((id) => id !== 0)).size, 32);

const cannonId = game.pieceIds[idx(7, 7)];
assert.ok(cannonId > 0);

// 炮二平五：id 跟着棋子走到新位置，起点清空
game.move(idx(7, 7), idx(4, 7));
assert.equal(game.pieceIds[idx(4, 7)], cannonId, '同一颗炮的身份应保留并出现在新坐标');
assert.equal(game.pieceIds[idx(7, 7)], 0, '起点应清空');

// 悔棋：身份回到原坐标
game.undo();
assert.equal(game.pieceIds[idx(7, 7)], cannonId, '悔棋后身份应回到原坐标');
assert.equal(game.pieceIds[idx(4, 7)], 0);

// 吃子：被吃棋子的身份消失，吃子方保留自己的身份
const captureGame = new ChessGame();
const targetId = captureGame.pieceIds[idx(4, 6)];
assert.ok(targetId > 0);
// 手工布置一个红车可以吃掉中兵的局面
captureGame.board.fill(0);
captureGame.pieceIds.fill(0);
captureGame.board[idx(4, 9)] = 1;
captureGame.pieceIds[idx(4, 9)] = 1;
captureGame.board[idx(4, 5)] = 5;
captureGame.pieceIds[idx(4, 5)] = 50;
captureGame.board[idx(4, 4)] = -7;
captureGame.pieceIds[idx(4, 4)] = targetId;
const move = captureGame.move(idx(4, 5), idx(4, 4));
assert.ok(move, '车吃卒应合法');
assert.equal(captureGame.pieceIds[idx(4, 4)], 50, '吃子方身份保留');
assert.ok(!Array.from(captureGame.pieceIds).includes(targetId), '被吃棋子身份应消失');

console.log('棋子身份与坐标同步测试通过');
