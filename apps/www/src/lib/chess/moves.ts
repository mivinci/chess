import { findKing } from './board';
import {
  ADVISOR,
  CANNON,
  ELEPHANT,
  idx,
  inBoard,
  KING,
  KNIGHT,
  opponent,
  PAWN,
  ROOK,
  sideOf,
  type Board,
  type Move,
  type Side,
  typeOf,
  xOf,
  yOf
} from './types';

const ORTHO = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
] as const;

const DIAG = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1]
] as const;

const ELEPHANT_STEPS = [
  [2, 2],
  [2, -2],
  [-2, 2],
  [-2, -2]
] as const;

const KNIGHT_STEPS = [
  [1, 2],
  [2, 1],
  [-1, 2],
  [-2, 1],
  [1, -2],
  [2, -1],
  [-1, -2],
  [-2, -1]
] as const;

function inPalace(x: number, y: number, side: Side): boolean {
  // 必须同时满足棋盘边界：将帅在底线往外「退」时 y 会变成 10（或 -1），
  // 只判 y>=7 / y<=2 会生成 idx 越界的着法（93~95、负数），写坏棋盘。
  return inBoard(x, y) && x >= 3 && x <= 5 && (side === 1 ? y >= 7 : y <= 2);
}

/** 只按棋子自身规则生成着法，不检查是否自将 */
export function generatePseudoMoves(board: Board, side: Side, from?: number): Move[] {
  const moves: Move[] = [];
  const add = (f: number, t: number) => {
    const target = board[t];
    if (target !== 0 && sideOf(target) === side) return;
    moves.push({ from: f, to: t, captured: target });
  };

  const origins: number[] = [];
  if (from !== undefined) {
    origins.push(from);
  } else {
    for (let i = 0; i < 90; i++) {
      if (board[i] !== 0 && sideOf(board[i]) === side) origins.push(i);
    }
  }

  for (const f of origins) {
    const piece = board[f];
    if (piece === 0 || sideOf(piece) !== side) continue;
    const type = typeOf(piece);
    const x = xOf(f);
    const y = yOf(f);

    if (type === ROOK || type === CANNON) {
      for (const [dx, dy] of ORTHO) {
        let nx = x + dx;
        let ny = y + dy;
        let jumped = false;
        while (inBoard(nx, ny)) {
          const t = idx(nx, ny);
          const q = board[t];
          if (type === ROOK) {
            if (q === 0) add(f, t);
            else {
              add(f, t);
              break;
            }
          } else if (!jumped) {
            if (q === 0) add(f, t);
            else jumped = true;
          } else if (q !== 0) {
            add(f, t);
            break;
          }
          nx += dx;
          ny += dy;
        }
      }
    } else if (type === KNIGHT) {
      for (const [dx, dy] of KNIGHT_STEPS) {
        const legX = Math.abs(dx) === 2 ? x + dx / 2 : x;
        const legY = Math.abs(dy) === 2 ? y + dy / 2 : y;
        if (board[idx(legX, legY)] !== 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (inBoard(nx, ny)) add(f, idx(nx, ny));
      }
    } else if (type === ELEPHANT) {
      for (const [dx, dy] of ELEPHANT_STEPS) {
        if (board[idx(x + dx / 2, y + dy / 2)] !== 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (!inBoard(nx, ny)) continue;
        if (side === 1 ? ny < 5 : ny > 4) continue;
        add(f, idx(nx, ny));
      }
    } else if (type === ADVISOR || type === KING) {
      const steps = type === ADVISOR ? DIAG : ORTHO;
      for (const [dx, dy] of steps) {
        const nx = x + dx;
        const ny = y + dy;
        if (inPalace(nx, ny, side)) add(f, idx(nx, ny));
      }
    } else if (type === PAWN) {
      const forward = side === 1 ? -1 : 1;
      const ny = y + forward;
      if (inBoard(x, ny)) add(f, idx(x, ny));
      const crossed = side === 1 ? y <= 4 : y >= 5;
      if (crossed) {
        for (const dx of [-1, 1]) {
          if (inBoard(x + dx, y)) add(f, idx(x + dx, y));
        }
      }
    }
  }

  return moves;
}

/** 当前 side 是否被将军（含将帅照面）。直接扫描攻击线，避免生成全部着法 */
export function isInCheck(board: Board, side: Side): boolean {
  const kingPos = findKing(board, side);
  if (kingPos < 0) return true;

  const enemy = opponent(side);
  const enemyKing = findKing(board, enemy);
  const kx = xOf(kingPos);
  const ky = yOf(kingPos);

  if (enemyKing >= 0 && xOf(enemyKing) === kx) {
    const ey = yOf(enemyKing);
    let clear = true;
    for (let y = Math.min(ky, ey) + 1; y < Math.max(ky, ey); y++) {
      if (board[idx(kx, y)] !== 0) {
        clear = false;
        break;
      }
    }
    if (clear) return true;
  }

  // 车：第一个棋子即为车；炮：隔一个炮架后的第一个棋子为炮
  for (const [dx, dy] of ORTHO) {
    let nx = kx + dx;
    let ny = ky + dy;
    let screened = false;
    while (inBoard(nx, ny)) {
      const q = board[idx(nx, ny)];
      if (q !== 0) {
        if (!screened) {
          if (sideOf(q) === enemy && typeOf(q) === ROOK) return true;
          screened = true;
        } else {
          if (sideOf(q) === enemy && typeOf(q) === CANNON) return true;
          break;
        }
      }
      nx += dx;
      ny += dy;
    }
  }

  // 马：从将的位置反推 8 个马位，并检查对应的马腿
  for (const [dx, dy] of KNIGHT_STEPS) {
    const nx = kx + dx;
    const ny = ky + dy;
    if (!inBoard(nx, ny)) continue;
    const q = board[idx(nx, ny)];
    if (q === 0 || sideOf(q) !== enemy || typeOf(q) !== KNIGHT) continue;
    const legX = Math.abs(dx) === 2 ? nx - dx / 2 : nx;
    const legY = Math.abs(dy) === 2 ? ny - dy / 2 : ny;
    if (board[idx(legX, legY)] === 0) return true;
  }

  // 兵/卒：敌方前进方向上的一格，以及过河后的横向两格
  const approachY = side === 1 ? ky - 1 : ky + 1;
  if (inBoard(kx, approachY)) {
    const q = board[idx(kx, approachY)];
    if (q !== 0 && sideOf(q) === enemy && typeOf(q) === PAWN) return true;
  }
  const enemyCrossed = enemy === 1 ? ky <= 4 : ky >= 5;
  if (enemyCrossed) {
    for (const dx of [-1, 1]) {
      if (!inBoard(kx + dx, ky)) continue;
      const q = board[idx(kx + dx, ky)];
      if (q !== 0 && sideOf(q) === enemy && typeOf(q) === PAWN) return true;
    }
  }

  return false;
}

export function makeMove(board: Board, move: Move): void {
  board[move.to] = board[move.from];
  board[move.from] = 0;
}

/** movingPiece 必须是走子前的 board[move.from] */
export function unmakeMove(board: Board, move: Move, movingPiece: number): void {
  board[move.from] = movingPiece;
  board[move.to] = move.captured;
}

/** 过滤掉走完后自己被将的着法。会临时修改 board 并原样恢复 */
export function generateLegalMoves(board: Board, side: Side, from?: number): Move[] {
  const legal: Move[] = [];
  for (const move of generatePseudoMoves(board, side, from)) {
    const moving = board[move.from];
    makeMove(board, move);
    const safe = !isInCheck(board, side);
    unmakeMove(board, move, moving);
    if (safe) legal.push(move);
  }
  return legal;
}
