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
  moves: Move[];
  notations: string[];
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
    !r.notations.every((n) => typeof n === 'string')
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
