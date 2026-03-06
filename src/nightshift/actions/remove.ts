import { getTask, deleteTask } from "../store.js";
import { createScheduler } from "../scheduler/index.js";
import type { NightshiftInput } from "../../types/index.js";

export async function handleRemove(input: NightshiftInput) {
  if (!input.taskId) return { success: false, error: "taskId is required" };

  const task = getTask(input.taskId);
  if (!task) return { success: false, error: `Task not found: ${input.taskId}` };

  // Unregister from OS scheduler first
  try {
    const scheduler = createScheduler();
    await scheduler.unregister(task.id);
  } catch (err) {
    // Log but continue — we still want to clean up DB
    console.error("Scheduler unregister warning:", err);
  }

  const deleted = deleteTask(task.id);

  return {
    success: deleted,
    message: deleted
      ? `Task "${task.name}" removed`
      : "Task could not be deleted",
  };
}
