import { searchBestMove } from '../src/lib/chess/ai';
import { idx, type Board } from '../src/lib/chess/types';
import { KING, ROOK, KNIGHT, PAWN, ELEPHANT, ADVISOR, RED, BLACK } from '../src/lib/chess/types';

// 近似用户截图的残局：黑车马卒 vs 红单车相兵
function makeBoard(): Board {
  const b = new Int8Array(90) as Board;
  // 红方
  b[idx(4, 9)] = KING * RED;      // 帅 底线
  b[idx(8, 9)] = ROOK * RED;      // 车 右下
  b[idx(4, 7)] = ELEPHANT * RED;  // 相
  b[idx(5, 5)] = PAWN * RED;      // 过河兵（黑象吃不到）
  // 黑方
  b[idx(4, 0)] = KING * BLACK;    // 将
  b[idx(3, 1)] = ADVISOR * BLACK;
  b[idx(5, 1)] = ADVISOR * BLACK;
  b[idx(6, 2)] = KNIGHT * BLACK;  // 马
  b[idx(7, 2)] = ROOK * BLACK;    // 车
  b[idx(8, 2)] = ELEPHANT * BLACK;
  b[idx(0, 3)] = PAWN * BLACK;
  b[idx(4, 3)] = PAWN * BLACK;
  b[idx(6, 3)] = PAWN * BLACK;
  return b;
}

const board = makeBoard();
for (const depth of [2, 3, 4]) {
  const t = performance.now();
  const r = searchBestMove(board, BLACK, depth);
  const ms = (performance.now() - t).toFixed(0);
  const from = r.move ? `${r.move.from}` : '-';
  const to = r.move ? `${r.move.to}` : '-';
  const captured = r.move?.captured ?? 0;
  console.log(`depth ${depth}: ${ms}ms ${r.nodes} nodes | score ${r.score} | ${from}->${to} captured=${captured}`);
}
