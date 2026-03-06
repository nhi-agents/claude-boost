/**
 * Standalone script run by the wake-refresh launchd job.
 * Reads all wake-enabled tasks and schedules pmset wake events
 * for the next 24 hours of upcoming runs.
 */
import { Cron } from "croner";
import { getAllTasks } from "../store.js";

const LOOK_AHEAD_MS = 24 * 60 * 60 * 1000; // 24 hours
const WAKE_LEAD_MS = 2 * 60 * 1000; // 2 minutes before task

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatPmsetTime(date: Date): string {
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function scheduleWake(wakeTime: Date): Promise<boolean> {
  const proc = Bun.spawn(
    ["sudo", "-n", "pmset", "schedule", "wakeorpoweron", formatPmsetTime(wakeTime)],
    { stdout: "pipe", stderr: "pipe" },
  );
  await proc.exited;
  return proc.exitCode === 0;
}

async function main() {
  const tasks = getAllTasks({ enabledOnly: true });
  const wakeTasks = tasks.filter((t) => t.wakeOnSchedule);

  if (wakeTasks.length === 0) {
    console.log("No wake-enabled tasks found.");
    return;
  }

  const now = Date.now();
  const horizon = now + LOOK_AHEAD_MS;
  let scheduled = 0;
  let failed = 0;

  for (const task of wakeTasks) {
    const cron = Cron(task.schedule);
    let next = cron.nextRun();

    while (next && next.getTime() < horizon) {
      const wakeTime = new Date(next.getTime() - WAKE_LEAD_MS);
      if (wakeTime.getTime() > now) {
        const ok = await scheduleWake(wakeTime);
        if (ok) {
          scheduled++;
          console.log(`Scheduled wake for "${task.name}" at ${wakeTime.toISOString()}`);
        } else {
          failed++;
        }
      }
      next = cron.nextRun(next);
    }
  }

  console.log(`Done: ${scheduled} wake events scheduled, ${failed} failed.`);
}

main().catch((err) => {
  console.error("refresh-wakes failed:", err);
  process.exit(1);
});
