import { generateLegalMoves, makeMove, unmakeMove } from './moves';
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

function evaluate(board: Board, side: Side): number {
  let score = 0;
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
  const stand = evaluate(board, side);
  if (ply >= 4) return stand;
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;

  for (const move of generateLegalMoves(board, side)) {
    if (move.captured === 0) continue;
    const moving = board[move.from];
    makeMove(board, move);
    const score = -quiesce(board, opponent(side), -beta, -alpha, ply + 1);
    unmakeMove(board, move, moving);
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
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
