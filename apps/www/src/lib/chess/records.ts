import type { GameStatus } from './game';
import type { Move, Side } from './types';

const STORAGE_KEY = 'chinese-chess-records';
const MAX_RECORDS = 50;

export interface GameRecord {
  id: string;
  playedAt: number;
  playerSide: Side;
  difficulty: string;
  pace: string;
  result: GameStatus;
  /** 结束原因：无棋可走（将死/困毙）或超时。旧记录没有 */
  endReason?: 'checkmate' | 'timeout';
  moves: Move[];
  notations: string[];
  /** 旧记录没有这个字段，缺省当作人机对战 */
  source?: 'ai' | 'room';
  /** 分支来源：从哪一局的第几步派生。旧记录没有 */
  parentId?: string;
  step?: number;
  /** 房间对局的房间号，分支时作为 parentId；人机对局没有 */
  roomId?: string;
}

function isMove(value: unknown): value is Move {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.from === 'number' &&
    typeof m.to === 'number' &&
    typeof m.captured === 'number'
  );
}

function parseRecord(value: unknown): GameRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const r = value as Record<string, unknown>;
  if (
    typeof r.id !== 'string' ||
    typeof r.playedAt !== 'number' ||
    (r.playerSide !== 1 && r.playerSide !== -1) ||
    typeof r.difficulty !== 'string' ||
    typeof r.pace !== 'string' ||
    (r.result !== 'playing' && r.result !== 'red-win' && r.result !== 'black-win') ||
    !Array.isArray(r.moves) ||
    !r.moves.every(isMove) ||
    !Array.isArray(r.notations) ||
    !r.notations.every((n) => typeof n === 'string') ||
    (r.source !== undefined && r.source !== 'ai' && r.source !== 'room') ||
    (r.parentId !== undefined && (typeof r.parentId !== 'string' || !/^[A-Z0-9]{4,12}$/.test(r.parentId))) ||
    (r.step !== undefined && (!Number.isInteger(r.step) || (r.step as number) < 1)) ||
    (r.roomId !== undefined && (typeof r.roomId !== 'string' || !/^[A-Z0-9]{4,12}$/.test(r.roomId))) ||
    (r.endReason !== undefined && r.endReason !== 'checkmate' && r.endReason !== 'timeout')
  ) {
    return null;
  }
  return r as unknown as GameRecord;
}

export function loadRecords(): GameRecord[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(parseRecord).filter((r): r is GameRecord => r !== null);
  } catch {
    return [];
  }
}

export function saveRecord(record: GameRecord): void {
  if (typeof localStorage === 'undefined') return;
  const records = [record, ...loadRecords()].slice(0, MAX_RECORDS);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // 存储不可用或超配额时静默跳过，不影响对局
  }
}

export function deleteRecord(id: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(loadRecords().filter((r) => r.id !== id))
    );
  } catch {
    // 忽略
  }
}

export function clearRecords(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 忽略
  }
}
