import assert from 'node:assert/strict';
import { searchBestMove } from '../src/lib/chess/ai';
import { BLACK, ChessGame, idx } from '../src/lib/chess/index';

const game = new ChessGame();

const humanMove = game.move(idx(7, 7), idx(4, 7));
assert.ok(humanMove, '玩家落子应成功');
assert.equal(game.turn, BLACK, '玩家走完后应轮到黑方');
console.log('玩家:', game.notations.at(-1), '| 轮到黑方');

// 页面修复后的传法：直接把当前行棋方交给 AI
const aiSide = game.turn;
const result = searchBestMove(game.board, aiSide, 3);
assert.ok(result.move, 'AI 应返回着法');
const aiMove = game.move(result.move.from, result.move.to);
assert.ok(aiMove, 'AI 着法应能通过规则校验并落在棋盘上');
assert.equal(game.notations.length, 2, '双方各走一步，共两步');

console.log('AI:', game.notations.at(-1), `(${result.nodes} nodes)`);
console.log('棋谱:', game.notations.join(' / '));
console.log('人机对局流程测试通过');
