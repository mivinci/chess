export const RED = 1;
export const BLACK = -1;
export type Side = typeof RED | typeof BLACK;

export const KING = 1;
export const ADVISOR = 2;
export const ELEPHANT = 3;
export const KNIGHT = 4;
export const ROOK = 5;
export const CANNON = 6;
export const PAWN = 7;
export type PieceType =
  | typeof KING
  | typeof ADVISOR
  | typeof ELEPHANT
  | typeof KNIGHT
  | typeof ROOK
  | typeof CANNON
  | typeof PAWN;

/** 0 = 空格；正数 = 红方，负数 = 黑方；绝对值 = PieceType */
export type Board = Int8Array;

export interface Move {
  from: number;
  to: number;
  /** 被吃掉的棋子，0 表示未吃子 */
  captured: number;
}

export const xOf = (i: number): number => i % 9;
export const yOf = (i: number): number => Math.floor(i / 9);
export const idx = (x: number, y: number): number => y * 9 + x;
export const inBoard = (x: number, y: number): boolean => x >= 0 && x < 9 && y >= 0 && y < 10;
export const sideOf = (p: number): Side => (p > 0 ? RED : BLACK);
export const typeOf = (p: number): PieceType => Math.abs(p) as PieceType;
export const opponent = (s: Side): Side => (s === RED ? BLACK : RED);
