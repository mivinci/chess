import { moveNotation } from './game';
import { isInCheck, makeMove, unmakeMove } from './moves';
import { opponent, sideOf, typeOf, type Board, type Move, type Side } from './types';

const VALUE: Record<number, number> = {
  1: 100_000,
  2: 200,
  3: 200,
  4: 400,
  5: 900,
  6: 450,
  7: 100
};

/**
 * 给提示走法生成一句人话解释。基于走法的客观特征，不编造搜索过程。
 * board 为走子前的局面，side 为走子方，score 是搜索返回的局面评估（走子方视角，正数占优）。
 */
export function explainHint(board: Board, move: Move | null, side: Side, score: number): string {
  if (!move) return '没有可走的棋';

  const notation = moveNotation(board, move);
  const work = board.slice();
  const moving = work[move.from];
  const captured = work[move.to];

  const wasInCheck = isInCheck(work, side);
  makeMove(work, move);
  const givesCheck = isInCheck(work, opponent(side));
  unmakeMove(work, move, moving);

  const reasons: string[] = [];
  if (wasInCheck) reasons.push('化解将军');
  if (captured !== 0) {
    const gain = VALUE[typeOf(captured)];
    reasons.push(`吃掉${captureName(captured)}${gain >= 400 ? '，赢下关键子力' : ''}`);
  }
  if (givesCheck) reasons.push('将军，迫使对方应对');
  if (reasons.length === 0) {
    const forward = side === 1 ? move.to < move.from : move.to > move.from;
    reasons.push(forward ? '向前推进，争夺主动' : '调整位置，稳固阵形');
  }

  return `${notation}：${reasons.join('；')}。${stance(score)}（评估 ${formatScore(score)}）`;
}

function stance(score: number): string {
  if (score > 300) return '局面明显占优';
  if (score > 80) return '略占优';
  if (score < -300) return '局势不利，这是较好的应对';
  if (score < -80) return '局面稍亏';
  return '局势大致均衡';
}

function captureName(piece: number): string {
  const type = typeOf(piece);
  const names: Record<number, string> = {
    1: '将/帅',
    2: '士',
    3: '象',
    4: '马',
    5: '车',
    6: '炮',
    7: '兵/卒'
  };
  return names[type] ?? '棋子';
}

function formatScore(score: number): string {
  const n = Math.round(score);
  return n > 0 ? `+${n}` : String(n);
}
