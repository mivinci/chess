CREATE TABLE IF NOT EXISTS boards (
  parent_id TEXT NOT NULL,
  step INTEGER NOT NULL,
  fork_id TEXT NOT NULL UNIQUE,
  history TEXT NOT NULL,
  notations TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_boards_parent_step ON boards (parent_id, step);
