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

export function updateTask(
  id: string,
  updates: Partial<
    Pick<
      NightshiftTask,
      | "name"
      | "description"
      | "schedule"
      | "timezone"
      | "command"
      | "workingDirectory"
      | "timeout"
      | "enabled"
      | "skipPermissions"
      | "wakeOnSchedule"
      | "worktree"
      | "tags"
      | "env"
    >
  >,
): NightshiftTask | null {
  const db = getDb();
  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  if (updates.name !== undefined) {
    sets.push("name = ?");
    params.push(updates.name);
  }
  if (updates.description !== undefined) {
    sets.push("description = ?");
    params.push(updates.description);
  }
  if (updates.schedule !== undefined) {
    sets.push("schedule = ?");
    params.push(updates.schedule);
  }
  if (updates.timezone !== undefined) {
    sets.push("timezone = ?");
    params.push(updates.timezone);
  }
  if (updates.command !== undefined) {
    sets.push("command = ?");
    params.push(updates.command);
  }
  if (updates.workingDirectory !== undefined) {
    sets.push("working_directory = ?");
    params.push(updates.workingDirectory);
  }
  if (updates.timeout !== undefined) {
    sets.push("timeout = ?");
    params.push(updates.timeout);
  }
  if (updates.enabled !== undefined) {
    sets.push("enabled = ?");
    params.push(updates.enabled ? 1 : 0);
  }
  if (updates.skipPermissions !== undefined) {
    sets.push("skip_permissions = ?");
    params.push(updates.skipPermissions ? 1 : 0);
  }
  if (updates.wakeOnSchedule !== undefined) {
    sets.push("wake_on_schedule = ?");
    params.push(updates.wakeOnSchedule ? 1 : 0);
  }
  if (updates.worktree !== undefined) {
    sets.push("worktree_enabled = ?");
    params.push(updates.worktree.enabled ? 1 : 0);
    if (updates.worktree.basePath !== undefined) {
      sets.push("worktree_base_path = ?");
      params.push(updates.worktree.basePath ?? null);
    }
    sets.push("worktree_branch_prefix = ?");
    params.push(updates.worktree.branchPrefix);
    sets.push("worktree_remote_name = ?");
    params.push(updates.worktree.remoteName);
  }
  if (updates.tags !== undefined) {
    sets.push("tags = ?");
    params.push(JSON.stringify(updates.tags));
  }
  if (updates.env !== undefined) {
    sets.push("env = ?");
    params.push(JSON.stringify(updates.env));
  }

  if (sets.length === 0) return getTask(id);

  sets.push("updated_at = ?");
  params.push(new Date().toISOString());

  params.push(id);
  db.run(
    `UPDATE nightshift_tasks SET ${sets.join(", ")} WHERE id = ?`,
    params,
  );

  return getTask(id);
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
