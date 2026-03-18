// ── Nightshift (Scheduled Tasks) ──────────────────────────────

export type ExecutionStatus =
  | "running"
  | "success"
  | "failure"
  | "timeout"
  | "skipped";

export interface WorktreeConfig {
  enabled: boolean;
  basePath?: string;
  branchPrefix: string;
  remoteName: string;
}

export interface NightshiftTask {
  id: string;
  name: string;
  description?: string;
  schedule: string; // cron expression
  timezone: string;
  command: string; // the prompt or command to run
  workingDirectory: string;
  timeout: number; // seconds
  enabled: boolean;
  skipPermissions: boolean;
  wakeOnSchedule: boolean;
  worktree: WorktreeConfig;
  tags: string[];
  env: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface NightshiftExecution {
  id: string;
  taskId: string;
  status: ExecutionStatus;
  trigger: "schedule" | "manual";
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  exitCode?: number;
  outputPreview?: string;
  error?: string;
  worktreePath?: string;
  worktreeBranch?: string;
}

// ── Findings (Simple Memory) ──────────────────────────────────

export interface Finding {
  id: string;
  type: "bug" | "security" | "performance" | "quality" | "note";
  title: string;
  description: string;
  filePaths: string[];
  tags: string[];
  severity: "critical" | "high" | "medium" | "low" | "info";
  status: "open" | "fixed" | "wontfix" | "duplicate";
  createdAt: string;
  updatedAt: string;
}

// ── Tool Inputs ───────────────────────────────────────────────

export interface NightshiftInput {
  action:
    | "add"
    | "edit"
    | "list"
    | "run"
    | "remove"
    | "status"
    | "logs"
    | "history";
  // add
  name?: string;
  schedule?: string;
  command?: string;
  description?: string;
  workingDirectory?: string;
  timeout?: number;
  timezone?: string;
  tags?: string[];
  skipPermissions?: boolean;
  wakeOnSchedule?: boolean;
  worktree?: Partial<WorktreeConfig>;
  env?: Record<string, string>;
  // run / remove / logs / history
  taskId?: string;
  // list
  tag?: string;
  // logs
  lines?: number;
  stream?: "stdout" | "stderr" | "both";
  // history
  limit?: number;
}

export interface FindingInput {
  action: "add" | "list" | "get" | "update" | "search";
  // add
  type?: Finding["type"];
  title?: string;
  description?: string;
  filePaths?: string[];
  tags?: string[];
  severity?: Finding["severity"];
  // get / update
  id?: string;
  // update
  status?: Finding["status"];
  // search
  query?: string;
  // list / search
  limit?: number;
  typeFilter?: Finding["type"];
  severityFilter?: Finding["severity"];
  statusFilter?: Finding["status"];
}
