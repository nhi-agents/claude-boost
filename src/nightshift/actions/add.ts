import { randomUUID } from "crypto";
import cronstrue from "cronstrue";
import { Cron } from "croner";
import { getConfig } from "../../config/index.js";
import { createScheduler } from "../scheduler/index.js";
import { DarwinScheduler } from "../scheduler/darwin.js";
import { createTask, deleteTask } from "../store.js";
import type { NightshiftInput, NightshiftTask } from "../../types/index.js";

export async function handleAdd(input: NightshiftInput) {
  if (!input.name) return { success: false, error: "name is required" };
  if (!input.schedule) return { success: false, error: "schedule is required" };
  if (!input.command) return { success: false, error: "command is required" };

  // Validate cron
  let cronExpr: string;
  try {
    // Try as raw cron first
    Cron(input.schedule); // validates
    cronExpr = input.schedule;
  } catch {
    return {
      success: false,
      error: `Invalid cron expression: ${input.schedule}. Use standard 5-field cron (e.g. "0 2 * * *" for 2am daily).`,
    };
  }

  // Verify GNU timeout is available (required for scheduled execution)
  if (!Bun.which("timeout")) {
    return {
      success: false,
      error:
        "GNU timeout is required for scheduled tasks but was not found. " +
        "Install it with: brew install coreutils",
    };
  }

  const config = getConfig();

  const task: NightshiftTask = {
    id: randomUUID().slice(0, 8),
    name: input.name,
    description: input.description,
    schedule: cronExpr,
    timezone: input.timezone ?? config.nightshift.defaultTimezone,
    command: input.command,
    workingDirectory: input.workingDirectory ?? process.cwd(),
    timeout: input.timeout ?? config.nightshift.defaultTimeout,
    enabled: true,
    skipPermissions: input.skipPermissions ?? false,
    wakeOnSchedule: input.wakeOnSchedule ?? false,
    worktree: {
      enabled: input.worktree?.enabled ?? false,
      basePath: input.worktree?.basePath,
      branchPrefix:
        input.worktree?.branchPrefix ??
        config.nightshift.worktree.branchPrefix,
      remoteName:
        input.worktree?.remoteName ??
        config.nightshift.worktree.remoteName,
    },
    tags: input.tags ?? [],
    env: input.env ?? {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Phase 1: save to DB
  const saved = createTask(task);

  // Phase 2: register with OS scheduler
  try {
    const scheduler = createScheduler();
    await scheduler.register(saved);
  } catch (err) {
    // Rollback DB on scheduler failure
    deleteTask(saved.id);
    return {
      success: false,
      error: `Task saved but scheduler registration failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Compute next runs for display
  const cron = Cron(cronExpr);
  const nextRuns: string[] = [];
  let next = cron.nextRun();
  for (let i = 0; i < 3 && next; i++) {
    nextRuns.push(next.toISOString());
    next = cron.nextRun(next);
  }

  // Surface wake scheduling info
  let wakeInfo: { scheduled: boolean; error?: string } | undefined;
  if (saved.wakeOnSchedule) {
    const scheduler = createScheduler();
    if (scheduler instanceof DarwinScheduler) {
      wakeInfo = await scheduler.scheduleWake(saved);
    }
  }

  return {
    success: true,
    task: saved,
    schedule: {
      cron: cronExpr,
      human: cronstrue.toString(cronExpr),
      nextRuns,
    },
    ...(wakeInfo ? { wake: wakeInfo } : {}),
  };
}
