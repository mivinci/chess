import { searchBestMove } from '../src/lib/chess/ai';
import { ChessGame, idx } from '../src/lib/chess/index';

const game = new ChessGame();
for (const depth of [2, 3, 4]) {
  const start = performance.now();
  const result = searchBestMove(game.board, game.turn, depth);
  const elapsed = (performance.now() - start).toFixed(0);
  console.log(
    `depth ${depth}: ${elapsed}ms, ${result.nodes} nodes, score ${result.score}, move ${result.move?.from}->${result.move?.to}`
  );
}

console.log('棋盘未被搜索修改:', game.board[idx(7, 7)] === 6);
