import { findKing, initialBoard, pieceLabel } from './board';
import { generateLegalMoves, isInCheck } from './moves';
import {
  ADVISOR,
  ELEPHANT,
  idx,
  KNIGHT,
  opponent,
  RED,
  sideOf,
  type Board,
  type Move,
  type Side,
  typeOf,
  xOf,
  yOf
} from './types';

export type GameStatus = 'playing' | 'red-win' | 'black-win';

export interface IdMove {
  from: number;
  to: number;
  movingId: number;
  capturedId: number;
}

function initialPieceIds(): Int32Array {
  const board = initialBoard();
  const ids = new Int32Array(90);
  let next = 1;
  for (let i = 0; i < 90; i++) {
    if (board[i] !== 0) ids[i] = next++;
  }
  return ids;
}

const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

function fileNumber(x: number, side: Side): number {
  return side === RED ? 9 - x : x + 1;
}

/** 走子前的棋盘 + 着法 => 中文记谱 */
export function moveNotation(board: Board, move: Move): string {
  const piece = board[move.from];
  const side = sideOf(piece);
  const type = typeOf(piece);
  const nums = side === RED ? CN : ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  const fromFile = nums[fileNumber(xOf(move.from), side)];
  const dy = yOf(move.to) - yOf(move.from);
  const forward = side === RED ? dy < 0 : dy > 0;
  const action = dy === 0 ? '平' : forward ? '进' : '退';
  let target: string;
  if (action === '平' || type === KNIGHT || type === ELEPHANT || type === ADVISOR) {
    target = nums[fileNumber(xOf(move.to), side)];
  } else {
    target = nums[Math.abs(dy)];
  }
  return `${pieceLabel(piece)}${fromFile}${action}${target}`;
}

export class ChessGame {
  board: Board = initialBoard();
  /** 每颗棋子的固定身份，0 表示空格；用于界面补间动画 */
  pieceIds: Int32Array = initialPieceIds();
  turn: Side = RED;
  history: Move[] = [];
  idHistory: IdMove[] = [];
  notations: string[] = [];
  lastMove: Move | null = null;
  status: GameStatus = 'playing';

  legalMoves(from?: number): Move[] {
    if (this.status !== 'playing') return [];
    return generateLegalMoves(this.board, this.turn, from);
  }

  inCheck(side: Side = this.turn): boolean {
    return isInCheck(this.board, side);
  }

  kingPos(side: Side): number {
    return findKing(this.board, side);
  }

  move(from: number, to: number): Move | null {
    const legal = this.legalMoves(from);
    const chosen = legal.find((m) => m.to === to);
    if (!chosen) return null;
    const notation = moveNotation(this.board, chosen);
    this.idHistory.push({
      from,
      to,
      movingId: this.pieceIds[from],
      capturedId: this.pieceIds[to]
    });
    this.pieceIds[to] = this.pieceIds[from];
    this.pieceIds[from] = 0;
    this.board[to] = this.board[from];
    this.board[from] = 0;
    this.history.push(chosen);
    this.notations.push(notation);
    this.lastMove = chosen;
    this.turn = opponent(this.turn);
    this.refreshStatus();
    return chosen;
  }

  undo(): boolean {
    const last = this.history.pop();
    if (!last) return false;
    const idMove = this.idHistory.pop();
    if (idMove) {
      this.pieceIds[idMove.from] = idMove.movingId;
      this.pieceIds[idMove.to] = idMove.capturedId;
    }
    const moving = this.board[last.to];
    this.board[last.from] = moving;
    this.board[last.to] = last.captured;
    this.notations.pop();
    this.turn = opponent(this.turn);
    const prev = this.history[this.history.length - 1];
    this.lastMove = prev ?? null;
    this.status = 'playing';
    return true;
  }

  reset(): void {
    this.board = initialBoard();
    this.pieceIds = initialPieceIds();
    this.turn = RED;
    this.history = [];
    this.idHistory = [];
    this.notations = [];
    this.lastMove = null;
    this.status = 'playing';
  }

  private refreshStatus(): void {
    if (generateLegalMoves(this.board, this.turn).length === 0) {
      this.status = this.turn === RED ? 'black-win' : 'red-win';
    }
  }
}

/** 是否有一方可走的着法（含将死/困毙判定） */
export function hasAnyLegalMove(board: Board, side: Side): boolean {
  return generateLegalMoves(board, side).length > 0;
}

/** 供 AI 使用的轻量局面副本 */
export function cloneBoard(board: Board): Board {
  return board.slice();
}

export { idx };
