import {
  ADVISOR,
  CANNON,
  ELEPHANT,
  idx,
  KING,
  KNIGHT,
  PAWN,
  ROOK,
  type Board,
  type Side,
  typeOf,
  sideOf
} from './types';

const BACK_RANK = [ROOK, KNIGHT, ELEPHANT, ADVISOR, KING, ADVISOR, ELEPHANT, KNIGHT, ROOK];

export function initialBoard(): Board {
  const b = new Int8Array(90);
  for (let x = 0; x < 9; x++) {
    b[idx(x, 0)] = -BACK_RANK[x];
    b[idx(x, 9)] = BACK_RANK[x];
  }
  b[idx(1, 2)] = -CANNON;
  b[idx(7, 2)] = -CANNON;
  b[idx(1, 7)] = CANNON;
  b[idx(7, 7)] = CANNON;
  for (const x of [0, 2, 4, 6, 8]) {
    b[idx(x, 3)] = -PAWN;
    b[idx(x, 6)] = PAWN;
  }
  return b;
}

export function findKing(board: Board, side: Side): number {
  return board.indexOf(KING * side);
}

const LABELS: Record<number, Record<string, string>> = {
  1: { r: '帅', b: '将' },
  2: { r: '仕', b: '士' },
  3: { r: '相', b: '象' },
  4: { r: '马', b: '马' },
  5: { r: '车', b: '车' },
  6: { r: '炮', b: '炮' },
  7: { r: '兵', b: '卒' }
};

export function pieceLabel(p: number): string {
  if (p === 0) return '';
  return LABELS[typeOf(p)][sideOf(p) === 1 ? 'r' : 'b'];
}
