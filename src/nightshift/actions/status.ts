import { createScheduler } from "../scheduler/index.js";
import { getTask } from "../store.js";
import type { NightshiftInput } from "../../types/index.js";

export async function handleStatus(input: NightshiftInput) {
  if (!input.taskId) return { success: false, error: "taskId is required" };

  const task = getTask(input.taskId);
  if (!task) return { success: false, error: `Task not found: ${input.taskId}` };

  const scheduler = createScheduler();
  const status = await scheduler.getStatus(task.id);

  return {
    success: true,
    task: { id: task.id, name: task.name, enabled: task.enabled },
    scheduler: status,
    platform: process.platform,
  };
}
