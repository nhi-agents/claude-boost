import { getDb } from "../db/index.js";
import type {
  NightshiftTask,
  NightshiftExecution,
  ExecutionStatus,
} from "../types/index.js";

// ── Row ↔ Object converters ──────────────────────────────────

function safeJsonParse<T>(val: unknown, fallback: T): T {
  if (typeof val !== "string") return fallback;
  try {
    return JSON.parse(val) as T;
  } catch {
    return fallback;
  }
}

function rowToTask(row: Record<string, unknown>): NightshiftTask {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? undefined,
    schedule: row.schedule as string,
    timezone: row.timezone as string,
    command: row.command as string,
    workingDirectory: row.working_directory as string,
    timeout: row.timeout as number,
    enabled: (row.enabled as number) === 1,
    skipPermissions: (row.skip_permissions as number) === 1,
    wakeOnSchedule: (row.wake_on_schedule as number) === 1,
    worktree: {
      enabled: (row.worktree_enabled as number) === 1,
      basePath: (row.worktree_base_path as string) ?? undefined,
      branchPrefix: (row.worktree_branch_prefix as string) ?? "boost/",
      remoteName: (row.worktree_remote_name as string) ?? "origin",
    },
    tags: safeJsonParse(row.tags, []),
    env: safeJsonParse(row.env, {}),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function rowToExecution(
  row: Record<string, unknown>,
): NightshiftExecution {
  const status = row.status as string;
  const validStatuses: ExecutionStatus[] = [
    "running",
    "success",
    "failure",
    "timeout",
    "skipped",
  ];

  return {
    id: row.id as string,
    taskId: row.task_id as string,
    status: validStatuses.includes(status as ExecutionStatus)
      ? (status as ExecutionStatus)
      : "failure",
    trigger: (row.trigger_type as "schedule" | "manual") ?? "manual",
    startedAt: row.started_at as string,
    completedAt: (row.completed_at as string) ?? undefined,
    durationMs: (row.duration_ms as number) ?? undefined,
    exitCode: (row.exit_code as number) ?? undefined,
    outputPreview: (row.output_preview as string) ?? undefined,
    error: (row.error as string) ?? undefined,
    worktreePath: (row.worktree_path as string) ?? undefined,
    worktreeBranch: (row.worktree_branch as string) ?? undefined,
  };
}

// ── Task CRUD ─────────────────────────────────────────────────

export function createTask(
  task: NightshiftTask,
): NightshiftTask {
  const db = getDb();
  db.run(
    `INSERT INTO nightshift_tasks
      (id, name, description, schedule, timezone, command, working_directory,
       timeout, enabled, skip_permissions, wake_on_schedule,
       worktree_enabled, worktree_base_path, worktree_branch_prefix, worktree_remote_name,
       tags, env)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      task.id,
      task.name,
      task.description ?? null,
      task.schedule,
      task.timezone,
      task.command,
      task.workingDirectory,
      task.timeout,
      task.enabled ? 1 : 0,
      task.skipPermissions ? 1 : 0,
      task.wakeOnSchedule ? 1 : 0,
      task.worktree.enabled ? 1 : 0,
      task.worktree.basePath ?? null,
      task.worktree.branchPrefix,
      task.worktree.remoteName,
      JSON.stringify(task.tags),
      JSON.stringify(task.env),
    ],
  );

  const row = db
    .query("SELECT * FROM nightshift_tasks WHERE id = ?")
    .get(task.id) as Record<string, unknown>;
  return rowToTask(row);
}

export function getTask(id: string): NightshiftTask | null {
  const db = getDb();
  const row = db
    .query("SELECT * FROM nightshift_tasks WHERE id = ?")
    .get(id) as Record<string, unknown> | null;
  return row ? rowToTask(row) : null;
}

export function getAllTasks(opts?: {
  tag?: string;
  enabledOnly?: boolean;
}): NightshiftTask[] {
  const db = getDb();
  let sql = "SELECT * FROM nightshift_tasks WHERE 1=1";
  const params: (string | number | null)[] = [];

  if (opts?.enabledOnly) {
    sql += " AND enabled = 1";
  }
  if (opts?.tag) {
    sql += " AND tags LIKE ? ESCAPE '\\'";
    const escaped = opts.tag
      .replace(/\\/g, "\\\\")
      .replace(/%/g, "\\%")
      .replace(/_/g, "\\_");
    params.push(`%"${escaped}"%`);
  }

  sql += " ORDER BY created_at DESC";

  const rows = db.query(sql).all(...params) as Record<string, unknown>[];
  return rows.map(rowToTask);
}

export function deleteTask(id: string): boolean {
  const db = getDb();
  const result = db.run(
    "DELETE FROM nightshift_tasks WHERE id = ?",
    [id],
  );
  return result.changes > 0;
}

// ── Execution tracking ────────────────────────────────────────

export function createExecution(
  exec: Pick<
    NightshiftExecution,
    "id" | "taskId" | "trigger" | "startedAt"
  >,
): void {
  const db = getDb();
  db.run(
    `INSERT INTO nightshift_executions (id, task_id, trigger_type, started_at)
     VALUES (?, ?, ?, ?)`,
    [exec.id, exec.taskId, exec.trigger, exec.startedAt],
  );
}

export function updateExecution(
  id: string,
  updates: Partial<
    Pick<
      NightshiftExecution,
      | "status"
      | "completedAt"
      | "durationMs"
      | "exitCode"
      | "outputPreview"
      | "error"
      | "worktreePath"
      | "worktreeBranch"
    >
  >,
): void {
  const db = getDb();
  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  if (updates.status !== undefined) {
    sets.push("status = ?");
    params.push(updates.status);
  }
  if (updates.completedAt !== undefined) {
    sets.push("completed_at = ?");
    params.push(updates.completedAt);
  }
  if (updates.durationMs !== undefined) {
    sets.push("duration_ms = ?");
    params.push(updates.durationMs);
  }
  if (updates.exitCode !== undefined) {
    sets.push("exit_code = ?");
    params.push(updates.exitCode);
  }
  if (updates.outputPreview !== undefined) {
    sets.push("output_preview = ?");
    params.push(updates.outputPreview);
  }
  if (updates.error !== undefined) {
    sets.push("error = ?");
    params.push(updates.error);
  }
  if (updates.worktreePath !== undefined) {
    sets.push("worktree_path = ?");
    params.push(updates.worktreePath);
  }
  if (updates.worktreeBranch !== undefined) {
    sets.push("worktree_branch = ?");
    params.push(updates.worktreeBranch);
  }

  if (sets.length === 0) return;

  params.push(id);
  db.run(
    `UPDATE nightshift_executions SET ${sets.join(", ")} WHERE id = ?`,
    params,
  );
}

export function getExecutions(
  taskId: string,
  limit = 20,
): NightshiftExecution[] {
  const db = getDb();
  const rows = db
    .query(
      `SELECT * FROM nightshift_executions
       WHERE task_id = ?
       ORDER BY started_at DESC
       LIMIT ?`,
    )
    .all(taskId, limit) as Record<string, unknown>[];
  return rows.map(rowToExecution);
}

export function getLatestExecution(
  taskId: string,
): NightshiftExecution | null {
  const db = getDb();
  const row = db
    .query(
      `SELECT * FROM nightshift_executions
       WHERE task_id = ?
       ORDER BY started_at DESC
       LIMIT 1`,
    )
    .get(taskId) as Record<string, unknown> | null;
  return row ? rowToExecution(row) : null;
}
