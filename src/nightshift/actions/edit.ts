import cronstrue from "cronstrue";
import { Cron } from "croner";
import { createScheduler } from "../scheduler/index.js";
import { DarwinScheduler } from "../scheduler/darwin.js";
import { getTask, updateTask } from "../store.js";
import type { NightshiftInput, NightshiftTask } from "../../types/index.js";

// Fields that are baked into the scheduler plist/script and require re-registration
const SCHEDULER_FIELDS = new Set([
  "schedule",
  "command",
  "workingDirectory",
  "timeout",
  "timezone",
  "env",
  "skipPermissions",
  "wakeOnSchedule",
  "worktree",
]);

function needsReregister(input: NightshiftInput): boolean {
  for (const field of SCHEDULER_FIELDS) {
    if ((input as Record<string, unknown>)[field] !== undefined) return true;
  }
  return false;
}

export async function handleEdit(input: NightshiftInput) {
  if (!input.taskId) return { success: false, error: "taskId is required" };

  const existing = getTask(input.taskId);
  if (!existing) return { success: false, error: `Task not found: ${input.taskId}` };

  // Validate new cron expression if provided
  if (input.schedule) {
    try {
      Cron(input.schedule);
    } catch {
      return {
        success: false,
        error: `Invalid cron expression: ${input.schedule}. Use standard 5-field cron (e.g. "0 2 * * *" for 2am daily).`,
      };
    }
  }

  // Build updates object from provided fields
  const updates: Partial<NightshiftTask> = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.description !== undefined) updates.description = input.description;
  if (input.schedule !== undefined) updates.schedule = input.schedule;
  if (input.timezone !== undefined) updates.timezone = input.timezone;
  if (input.command !== undefined) updates.command = input.command;
  if (input.workingDirectory !== undefined) updates.workingDirectory = input.workingDirectory;
  if (input.timeout !== undefined) updates.timeout = input.timeout;
  if (input.skipPermissions !== undefined) updates.skipPermissions = input.skipPermissions;
  if (input.wakeOnSchedule !== undefined) updates.wakeOnSchedule = input.wakeOnSchedule;
  if (input.tags !== undefined) updates.tags = input.tags;
  if (input.env !== undefined) updates.env = input.env;
  if (input.worktree !== undefined) {
    updates.worktree = {
      enabled: input.worktree.enabled ?? existing.worktree.enabled,
      basePath: input.worktree.basePath ?? existing.worktree.basePath,
      branchPrefix: input.worktree.branchPrefix ?? existing.worktree.branchPrefix,
      remoteName: input.worktree.remoteName ?? existing.worktree.remoteName,
    };
  }

  if (Object.keys(updates).length === 0) {
    return { success: true, task: existing, changed: false };
  }

  const reregister = needsReregister(input);

  // If scheduler-affecting fields changed, unregister first
  if (reregister) {
    const scheduler = createScheduler();
    try {
      await scheduler.unregister(existing.id);
    } catch {
      // Scheduler entry may not exist — continue
    }
  }

  // Update DB
  const updated = updateTask(existing.id, updates);
  if (!updated) {
    // Re-register the old config if DB update fails
    if (reregister) {
      const scheduler = createScheduler();
      await scheduler.register(existing);
    }
    return { success: false, error: "Failed to update task in database" };
  }

  // Re-register with scheduler if needed
  if (reregister) {
    try {
      const scheduler = createScheduler();
      await scheduler.register(updated);
    } catch (err) {
      // Roll back: restore old values in DB and re-register old config
      updateTask(existing.id, existing);
      try {
        const scheduler = createScheduler();
        await scheduler.register(existing);
      } catch {
        // Best-effort rollback
      }
      return {
        success: false,
        error: `Task updated but scheduler re-registration failed (rolled back): ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // Compute next runs for display
  const schedule = updated.schedule;
  const cron = Cron(schedule);
  const nextRuns: string[] = [];
  let next = cron.nextRun();
  for (let i = 0; i < 3 && next; i++) {
    nextRuns.push(next.toISOString());
    next = cron.nextRun(next);
  }

  // Handle wake scheduling if relevant
  let wakeInfo: { scheduled: boolean; error?: string } | undefined;
  if (updated.wakeOnSchedule && reregister) {
    const scheduler = createScheduler();
    if (scheduler instanceof DarwinScheduler) {
      wakeInfo = await scheduler.scheduleWake(updated);
    }
  }

  return {
    success: true,
    task: updated,
    changed: true,
    schedule: {
      cron: schedule,
      human: cronstrue.toString(schedule),
      nextRuns,
    },
    ...(wakeInfo ? { wake: wakeInfo } : {}),
  };
}
