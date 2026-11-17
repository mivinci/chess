import { generateLegalMoves, isInCheck, makeMove, unmakeMove } from './moves';
import {
  ADVISOR,
  CANNON,
  ELEPHANT,
  KING,
  KNIGHT,
  opponent,
  PAWN,
  RED,
  ROOK,
  sideOf,
  type Board,
  type Move,
  type Side,
  typeOf,
  xOf,
  yOf
} from './types';

const MATE = 1_000_000;

const VALUE: Record<number, number> = {
  [KING]: 100_000,
  [ROOK]: 900,
  [CANNON]: 450,
  [KNIGHT]: 400,
  [ELEPHANT]: 200,
  [ADVISOR]: 200,
  [PAWN]: 100
};

export interface SearchResult {
  move: Move | null;
  score: number;
  nodes: number;
}

interface Context {
  nodes: number;
}

/** 对方九宫的格坐标（x 3..5，y 0..2 或 7..9） */
function inEnemyPalace(x: number, y: number, own: Side): boolean {
  const relY = own === RED ? y : 9 - y; // 换算成「从自己这边数」的行号
  return x >= 3 && x <= 5 && relY >= 7;
}

/**
 * 残局协同分：子力少了之后，引导 AI 用马、兵配合车做杀，
 * 而不是单车来回将、_scores 原地打转。
 * 只在双方重子都少时启用，避免干扰开局布局。
 */
function coordinationBonus(board: Board, own: Side): number {
  const enemy = opponent(own);
  const enemyKing = board.indexOf(KING * enemy);
  if (enemyKing < 0) return 0;
  const ex = xOf(enemyKing);
  const ey = yOf(enemyKing);
  const enemyRelY = enemy === RED ? ey : 9 - ey;
  const enemyAtHome = enemyRelY >= 7;

  // 判断残局：进攻方重子（车/马/炮）不超过 2，或防守方已无车/炮
  let ownHeavy = 0;
  let enemyHeavy = 0;
  for (let i = 0; i < 90; i++) {
    const p = board[i];
    if (p === 0) continue;
    const t = typeOf(p);
    if (t !== ROOK && t !== KNIGHT && t !== CANNON) continue;
    if (sideOf(p) === own) ownHeavy++;
    else enemyHeavy++;
  }
  if (ownHeavy === 0 || ownHeavy > 2 || enemyHeavy > 2) return 0;

  let bonus = 0;
  // 逼对方将离位：将不在底线九宫中央时加分
  if (!enemyAtHome) bonus += 60;
  if (ex !== 4) bonus += 25;

  for (let i = 0; i < 90; i++) {
    const p = board[i];
    if (p === 0 || sideOf(p) !== own) continue;
    const t = typeOf(p);
    const x = xOf(i);
    const y = yOf(i);
    const relY = own === RED ? y : 9 - y; // 从自己这边数，越大越靠近对方底线

    switch (t) {
      case KNIGHT: {
        // 卧槽 / 挂角：对方九宫侧翼（x=3 或 5）且逼近底线
        if ((x === 3 || x === 5) && relY >= 6) bonus += 90;
        else if (x >= 3 && x <= 5 && relY >= 5) bonus += 40;
        break;
      }
      case PAWN: {
        // 兵逼近对方九宫：越靠近底线越值钱，进入九宫再加
        if (relY >= 6) bonus += 40 + (relY - 6) * 30;
        if (inEnemyPalace(x, y, own)) bonus += 70;
        break;
      }
      case ROOK: {
        // 车控制对方底线（将所在行）：给压制分
        const enemyBackRank = enemy === RED ? 9 : 0;
        if (y === enemyBackRank) bonus += 35;
        // 车与对方将同列且中间无阻挡
        if (x === ex) {
          let clear = true;
          const lo = Math.min(y, ey) + 1;
          const hi = Math.max(y, ey);
          for (let yy = lo; yy < hi; yy++) {
            if (board[yy * 9 + x] !== 0) { clear = false; break; }
          }
          if (clear) bonus += 45;
        }
        break;
      }
    }
  }
  return bonus;
}

function evaluate(board: Board, side: Side): number {
  let score = coordinationBonus(board, side) - coordinationBonus(board, opponent(side));
  for (let i = 0; i < 90; i++) {
    const piece = board[i];
    if (piece === 0) continue;
    const own = sideOf(piece);
    const type = typeOf(piece);
    let value = VALUE[type];
    const x = xOf(i);
    const y = yOf(i);
    const forwardY = own === RED ? y : 9 - y;

    switch (type) {
      case PAWN:
        if (forwardY <= 4) value += 40 + (4 - forwardY) * 25;
        if (x >= 3 && x <= 5) value += 15;
        break;
      case KNIGHT:
        if (forwardY < 5) value += 25;
        if (x >= 2 && x <= 6) value += 20;
        break;
      case CANNON:
        if (x >= 3 && x <= 5) value += 20;
        if (forwardY <= 5) value += 10;
        break;
      case ROOK:
        if (forwardY <= 5) value += 20;
        break;
      case KING:
        if (own === RED ? y === 9 : y === 0) value += 30;
        break;
    }

    score += own === side ? value : -value;
  }
  return score;
}

function orderMoves(moves: Move[], board: Board): void {
  moves.sort((a, b) => {
    const aGain = a.captured === 0 ? 0 : VALUE[typeOf(a.captured)] * 10 - VALUE[typeOf(board[a.from])];
    const bGain = b.captured === 0 ? 0 : VALUE[typeOf(b.captured)] * 10 - VALUE[typeOf(board[b.from])];
    return bGain - aGain;
  });
}

function quiesce(board: Board, side: Side, alpha: number, beta: number, ply: number): number {
  // 被将军时必须搜完所有应将着法，不能停在 stand-pat——
  // 否则会把「下一手被将死」误判成平静局面，看不到连续将军的杀。
  const checked = isInCheck(board, side);
  const stand = checked ? -Infinity : evaluate(board, side);
  if (ply >= 6) return evaluate(board, side);
  if (!checked) {
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
  }

  const moves = generateLegalMoves(board, side);
  if (moves.length === 0) return -MATE + ply; // 将死 / 困毙

  for (const move of moves) {
    // 平静局面只延伸吃子；被将军时所有着法都要看（应将）
    if (!checked && move.captured === 0) continue;
    const moving = board[move.from];
    makeMove(board, move);
    const score = -quiesce(board, opponent(side), -beta, -alpha, ply + 1);
    unmakeMove(board, move, moving);
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  // 被将军但找不到能改善的着法时，返回 stand-pat 评估（不能留 -Infinity）
  return alpha === -Infinity ? evaluate(board, side) : alpha;
}

function negamax(
  board: Board,
  side: Side,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
  ctx: Context
): number {
  ctx.nodes++;
  const moves = generateLegalMoves(board, side);
  if (moves.length === 0) return -MATE + ply;
  if (depth <= 0) return quiesce(board, side, alpha, beta, 0);

  orderMoves(moves, board);
  let best = -Infinity;
  for (const move of moves) {
    const moving = board[move.from];
    makeMove(board, move);
    const score = -negamax(board, opponent(side), depth - 1, -beta, -alpha, ply + 1, ctx);
    unmakeMove(board, move, moving);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

/** 在 board 的副本上搜索，传入的 board 不会被修改 */
export function searchBestMove(board: Board, side: Side, depth: number): SearchResult {
  const work = board.slice();
  const ctx: Context = { nodes: 0 };
  const moves = generateLegalMoves(work, side);
  if (moves.length === 0) return { move: null, score: -MATE, nodes: 0 };

  orderMoves(moves, work);
  let bestMove = moves[0];
  let best = -Infinity;
  let alpha = -Infinity;
  const beta = Infinity;

  for (const move of moves) {
    const moving = work[move.from];
    makeMove(work, move);
    const score = -negamax(work, opponent(side), depth - 1, -beta, -alpha, 1, ctx);
    unmakeMove(work, move, moving);
    if (score > best) {
      best = score;
      bestMove = move;
    }
    if (best > alpha) alpha = best;
  }
  return { move: bestMove, score: best, nodes: ctx.nodes };
}
