import { searchBestMove } from './ai';
import type { Board, Move, Side } from './types';

export type SearchPurpose = 'move' | 'hint';

export interface SearchRequest {
  id: number;
  board: Board;
  side: Side;
  depth: number;
  purpose: SearchPurpose;
}

export interface SearchResponse {
  id: number;
  purpose: SearchPurpose;
  move: Move | null;
  score: number;
  nodes: number;
  time: number;
}

const worker = self as unknown as {
  onmessage: ((event: MessageEvent<SearchRequest>) => void) | null;
  postMessage: (message: SearchResponse) => void;
};

worker.onmessage = (event) => {
  const { id, board, side, depth, purpose } = event.data;
  const start = performance.now();
  const result = searchBestMove(board, side, depth);
  worker.postMessage({ id, purpose, ...result, time: performance.now() - start });
};
