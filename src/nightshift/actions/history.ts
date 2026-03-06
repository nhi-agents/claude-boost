import { getExecutions } from "../store.js";
import { getTask } from "../store.js";
import type { NightshiftInput } from "../../types/index.js";

export async function handleHistory(input: NightshiftInput) {
  if (!input.taskId) return { success: false, error: "taskId is required" };

  const task = getTask(input.taskId);
  if (!task) return { success: false, error: `Task not found: ${input.taskId}` };

  const executions = getExecutions(task.id, input.limit ?? 20);

  return {
    success: true,
    task: { id: task.id, name: task.name },
    executions: executions.map((e) => ({
      id: e.id,
      status: e.status,
      trigger: e.trigger,
      startedAt: e.startedAt,
      completedAt: e.completedAt,
      durationMs: e.durationMs,
      exitCode: e.exitCode,
      outputPreview: e.outputPreview,
      error: e.error,
    })),
    count: executions.length,
  };
}
