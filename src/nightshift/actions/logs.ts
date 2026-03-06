import { readFileSync } from "fs";
import { getConfig } from "../../config/index.js";
import { getTask } from "../store.js";
import type { NightshiftInput } from "../../types/index.js";

export async function handleLogs(input: NightshiftInput) {
  if (!input.taskId) return { success: false, error: "taskId is required" };

  const task = getTask(input.taskId);
  if (!task) return { success: false, error: `Task not found: ${input.taskId}` };

  const logDir = getConfig().nightshift.logDir;
  const stream = input.stream ?? "both";
  const lines = input.lines ?? 100;

  const result: { stdout?: string; stderr?: string } = {};

  if (stream === "stdout" || stream === "both") {
    try {
      const content = readFileSync(`${logDir}/${task.id}.out.log`, "utf-8");
      result.stdout = content.split("\n").slice(-lines).join("\n");
    } catch {
      result.stdout = "(no stdout log found)";
    }
  }

  if (stream === "stderr" || stream === "both") {
    try {
      const content = readFileSync(`${logDir}/${task.id}.err.log`, "utf-8");
      result.stderr = content.split("\n").slice(-lines).join("\n");
    } catch {
      result.stderr = "(no stderr log found)";
    }
  }

  return {
    success: true,
    task: { id: task.id, name: task.name },
    ...result,
  };
}
