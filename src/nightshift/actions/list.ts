import cronstrue from "cronstrue";
import { Cron } from "croner";
import { getAllTasks, getLatestExecution } from "../store.js";
import type { NightshiftInput } from "../../types/index.js";

export async function handleList(input: NightshiftInput) {
  const tasks = getAllTasks({ tag: input.tag });

  const result = tasks.map((task) => {
    const latest = getLatestExecution(task.id);
    const cron = Cron(task.schedule);
    const nextRun = cron.nextRun();

    return {
      id: task.id,
      name: task.name,
      description: task.description,
      schedule: cronstrue.toString(task.schedule),
      cron: task.schedule,
      enabled: task.enabled,
      tags: task.tags,
      wakeOnSchedule: task.wakeOnSchedule,
      worktreeEnabled: task.worktree.enabled,
      nextRun: nextRun?.toISOString() ?? null,
      lastRun: latest
        ? {
            status: latest.status,
            startedAt: latest.startedAt,
            durationMs: latest.durationMs,
          }
        : null,
    };
  });

  return { success: true, tasks: result, count: result.length };
}
