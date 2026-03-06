export const SCHEMA = `
-- Nightshift: scheduled tasks
CREATE TABLE IF NOT EXISTS nightshift_tasks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  schedule TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  command TEXT NOT NULL,
  working_directory TEXT NOT NULL,
  timeout INTEGER NOT NULL DEFAULT 300,
  enabled INTEGER NOT NULL DEFAULT 1,
  skip_permissions INTEGER NOT NULL DEFAULT 0,
  wake_on_schedule INTEGER NOT NULL DEFAULT 0,
  worktree_enabled INTEGER NOT NULL DEFAULT 0,
  worktree_base_path TEXT,
  worktree_branch_prefix TEXT DEFAULT 'boost/',
  worktree_remote_name TEXT DEFAULT 'origin',
  tags TEXT DEFAULT '[]',
  env TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Nightshift: execution history
CREATE TABLE IF NOT EXISTS nightshift_executions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES nightshift_tasks(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running',
  trigger_type TEXT NOT NULL DEFAULT 'manual',
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  duration_ms INTEGER,
  exit_code INTEGER,
  output_preview TEXT,
  error TEXT,
  worktree_path TEXT,
  worktree_branch TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_executions_task_id
  ON nightshift_executions(task_id);
CREATE INDEX IF NOT EXISTS idx_executions_status
  ON nightshift_executions(status);
CREATE INDEX IF NOT EXISTS idx_executions_started
  ON nightshift_executions(started_at DESC);

-- Findings: simple memory system
CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  file_paths TEXT DEFAULT '[]',
  tags TEXT DEFAULT '[]',
  severity TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_findings_type ON findings(type);
CREATE INDEX IF NOT EXISTS idx_findings_severity ON findings(severity);
CREATE INDEX IF NOT EXISTS idx_findings_status ON findings(status);

-- FTS5 for full-text search on findings
CREATE VIRTUAL TABLE IF NOT EXISTS findings_fts USING fts5(
  title,
  description,
  tags,
  content=findings,
  content_rowid=rowid
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS findings_ai AFTER INSERT ON findings BEGIN
  INSERT INTO findings_fts(rowid, title, description, tags)
  VALUES (NEW.rowid, NEW.title, NEW.description, NEW.tags);
END;

CREATE TRIGGER IF NOT EXISTS findings_ad AFTER DELETE ON findings BEGIN
  INSERT INTO findings_fts(findings_fts, rowid, title, description, tags)
  VALUES ('delete', OLD.rowid, OLD.title, OLD.description, OLD.tags);
END;

CREATE TRIGGER IF NOT EXISTS findings_au AFTER UPDATE ON findings BEGIN
  INSERT INTO findings_fts(findings_fts, rowid, title, description, tags)
  VALUES ('delete', OLD.rowid, OLD.title, OLD.description, OLD.tags);
  INSERT INTO findings_fts(rowid, title, description, tags)
  VALUES (NEW.rowid, NEW.title, NEW.description, NEW.tags);
END;
`;
