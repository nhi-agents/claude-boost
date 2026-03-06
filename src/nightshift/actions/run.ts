import { randomUUID } from "crypto";
import { getTask } from "../store.js";
import { createExecution, updateExecution } from "../store.js";
import { shellEscape } from "../scheduler/shell.js";
import type { NightshiftInput } from "../../types/index.js";

const MAX_OUTPUT = 1024 * 1024; // 1MB cap

export async function handleRun(input: NightshiftInput) {
  if (!input.taskId) return { success: false, error: "taskId is required" };

  const task = getTask(input.taskId);
  if (!task) return { success: false, error: `Task not found: ${input.taskId}` };

  const execId = randomUUID().slice(0, 12);
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  createExecution({
    id: execId,
    taskId: task.id,
    trigger: "manual",
    startedAt,
  });

  // Build command
  const args = ["-p", task.command];
  if (task.skipPermissions) {
    args.push("--dangerously-skip-permissions");
  }

  try {
    const proc = Bun.spawn(["claude", ...args], {
      cwd: task.workingDirectory,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ...task.env },
    });

    // Set up timeout
    const timeoutId = setTimeout(() => {
      proc.kill("SIGTERM");
      setTimeout(() => proc.kill("SIGKILL"), 5000);
    }, task.timeout * 1000);

    const exitCode = await proc.exited;
    clearTimeout(timeoutId);

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const output = stdout.slice(0, MAX_OUTPUT);
    const durationMs = Date.now() - startMs;

    const timedOut = durationMs >= task.timeout * 1000;
    const status =
      timedOut ? "timeout" : exitCode === 0 ? "success" : "failure";

    updateExecution(execId, {
      status,
      completedAt: new Date().toISOString(),
      durationMs,
      exitCode: exitCode ?? undefined,
      outputPreview: output.slice(0, 500),
      error: stderr ? stderr.slice(0, 500) : undefined,
    });

    return {
      success: status === "success",
      executionId: execId,
      status,
      durationMs,
      exitCode,
      outputPreview: output.slice(0, 500),
      error: stderr ? stderr.slice(0, 500) : undefined,
    };
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const errorMsg =
      err instanceof Error ? err.message : String(err);

    updateExecution(execId, {
      status: "failure",
      completedAt: new Date().toISOString(),
      durationMs,
      error: errorMsg,
    });

    return {
      success: false,
      executionId: execId,
      status: "failure",
      durationMs,
      error: errorMsg,
    };
  }
}
