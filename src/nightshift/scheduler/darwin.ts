import { BaseScheduler } from "./base.js";
import { shellEscape, sanitizeForComment } from "./shell.js";
import { getConfig } from "../../config/index.js";
import type { NightshiftTask } from "../../types/index.js";
import { Cron } from "croner";
import { mkdirSync, writeFileSync, existsSync, unlinkSync, readdirSync } from "fs";
import { join } from "path";

const PLIST_DIR = `${process.env.HOME}/Library/LaunchAgents`;
const PLIST_PREFIX = "com.claude.boost";
const SCRIPTS_DIR = `${process.env.HOME}/.claude/boost/scripts`;

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Convert a 5-field cron expression to launchd StartCalendarInterval entries.
 * Supports: *, specific values, lists (1,3,5), ranges (1-5), steps (*​/5).
 */
function cronToCalendarInterval(
  cron: string,
): Array<Record<string, number>> {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Invalid cron: ${cron}`);

  const [minute, hour, day, month, weekday] = parts;

  const fieldMap: [string, string, number, number][] = [
    [minute!, "Minute", 0, 59],
    [hour!, "Hour", 0, 23],
    [day!, "Day", 1, 31],
    [month!, "Month", 1, 12],
    [weekday!, "Weekday", 0, 7],
  ];

  function expandField(
    field: string,
    min: number,
    max: number,
  ): number[] | null {
    if (field === "*") return null; // any value

    const values = new Set<number>();

    for (const part of field.split(",")) {
      const stepMatch = part.match(/^(\*|(\d+)-(\d+))\/(\d+)$/);
      if (stepMatch) {
        const start = stepMatch[2] ? parseInt(stepMatch[2]) : min;
        const end = stepMatch[3] ? parseInt(stepMatch[3]) : max;
        const step = parseInt(stepMatch[4]!);
        for (let i = start; i <= end; i += step) values.add(i);
        continue;
      }

      const rangeMatch = part.match(/^(\d+)-(\d+)$/);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1]!);
        const end = parseInt(rangeMatch[2]!);
        for (let i = start; i <= end; i++) values.add(i);
        continue;
      }

      const num = parseInt(part);
      if (!isNaN(num)) values.add(num);
    }

    return values.size > 0 ? [...values].sort((a, b) => a - b) : null;
  }

  // Expand all fields
  const expanded = fieldMap.map(([field, key, min, max]) => ({
    key,
    values: expandField(field, min, max),
  }));

  // Build cartesian product of all specified values
  function cartesian(
    fields: typeof expanded,
    idx: number,
    current: Record<string, number>,
  ): Array<Record<string, number>> {
    if (idx >= fields.length) return [{ ...current }];

    const { key, values } = fields[idx]!;
    if (!values) return cartesian(fields, idx + 1, current);

    const results: Array<Record<string, number>> = [];
    for (const v of values) {
      current[key] = v;
      results.push(...cartesian(fields, idx + 1, current));
    }
    delete current[key];
    return results;
  }

  const intervals = cartesian(expanded, 0, {});
  return intervals.length > 0 ? intervals : [{}]; // empty = every minute
}

function buildPlist(task: NightshiftTask, scriptPath: string): string {
  const label = `${PLIST_PREFIX}.${task.id}`;
  const logDir = getConfig().nightshift.logDir;
  mkdirSync(logDir, { recursive: true });

  const intervals = cronToCalendarInterval(task.schedule);
  const intervalXml = intervals
    .map((interval) => {
      const entries = Object.entries(interval)
        .map(
          ([k, v]) =>
            `        <key>${escapeXml(k)}</key>\n        <integer>${v}</integer>`,
        )
        .join("\n");
      return `      <dict>\n${entries}\n      </dict>`;
    })
    .join("\n");

  const envXml = Object.entries(task.env)
    .map(
      ([k, v]) =>
        `      <key>${escapeXml(k)}</key>\n      <string>${escapeXml(v)}</string>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${escapeXml(label)}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${escapeXml(scriptPath)}</string>
    </array>
    <key>StartCalendarInterval</key>
    <array>
${intervalXml}
    </array>
    <key>StandardOutPath</key>
    <string>${escapeXml(`${logDir}/${task.id}.out.log`)}</string>
    <key>StandardErrorPath</key>
    <string>${escapeXml(`${logDir}/${task.id}.err.log`)}</string>
    <key>WorkingDirectory</key>
    <string>${escapeXml(task.workingDirectory)}</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>PATH</key>
      <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:${escapeXml(`${process.env.HOME}/.bun/bin`)}:${escapeXml(`${process.env.HOME}/.local/bin`)}</string>
      <key>HOME</key>
      <string>${escapeXml(process.env.HOME ?? "")}</string>
${envXml}
    </dict>
</dict>
</plist>`;
}

function buildScript(task: NightshiftTask): string {
  const claudeBin = Bun.which("claude") ?? "claude";
  const claudeArgs = [claudeBin, "-p", shellEscape(task.command)];
  if (task.skipPermissions) {
    claudeArgs.push("--dangerously-skip-permissions");
  }

  const comment = sanitizeForComment(task.name);

  const caffeinatePrefix = task.wakeOnSchedule ? "caffeinate -s " : "";

  if (task.worktree.enabled) {
    const prefix = task.worktree.branchPrefix || "boost/";
    const remote = task.worktree.remoteName || "origin";
    const basePath =
      task.worktree.basePath ??
      `$(dirname ${shellEscape(task.workingDirectory)})/.boost-worktrees`;

    return `#!/bin/bash
# Boost Nightshift: ${comment}
set -euo pipefail

MAIN_REPO=${shellEscape(task.workingDirectory)}
WORKTREE_BASE=${shellEscape(basePath)}
BRANCH="${prefix}${task.id.slice(0, 8)}-$(date +%Y%m%d-%H%M%S)"
WORKTREE_DIR="$WORKTREE_BASE/$BRANCH"

mkdir -p "$WORKTREE_BASE"
cd "$MAIN_REPO"

git worktree add -b "$BRANCH" "$WORKTREE_DIR" HEAD
cd "$WORKTREE_DIR"

# Run Claude (caffeinate prevents sleep during execution)
${caffeinatePrefix}timeout ${task.timeout} ${claudeArgs.join(" ")} || true

# Commit and push if there are changes
if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git commit -m "boost(nightshift): ${comment}"
  git push -u ${shellEscape(remote)} "$BRANCH" || echo "Push failed, branch kept for manual review"
fi

# Cleanup worktree
cd "$MAIN_REPO"
git worktree remove "$WORKTREE_DIR" --force 2>/dev/null || true
`;
  }

  return `#!/bin/bash
# Boost Nightshift: ${comment}
set -euo pipefail

cd ${shellEscape(task.workingDirectory)}
${caffeinatePrefix}timeout ${task.timeout} ${claudeArgs.join(" ")}
`;
}

export class DarwinScheduler extends BaseScheduler {
  private plistPath(taskId: string): string {
    return join(PLIST_DIR, `${PLIST_PREFIX}.${taskId}.plist`);
  }

  private scriptPath(taskId: string): string {
    return join(SCRIPTS_DIR, `${taskId}.sh`);
  }

  /**
   * Schedule macOS to wake from sleep before a task runs.
   * Uses `sudo -n pmset` (non-interactive) — requires passwordless sudo for pmset.
   * Returns { scheduled, error? } so callers can warn without failing.
   */
  async scheduleWake(
    task: NightshiftTask,
  ): Promise<{ scheduled: boolean; error?: string }> {
    const cron = Cron(task.schedule);
    const nextRun = cron.nextRun();
    if (!nextRun) return { scheduled: false, error: "No upcoming run" };

    // Wake 2 minutes before the task
    const wakeTime = new Date(nextRun.getTime() - 2 * 60 * 1000);
    if (wakeTime.getTime() <= Date.now()) {
      return { scheduled: false, error: "Next run is too soon to schedule wake" };
    }

    // pmset expects "MM/DD/YYYY HH:MM:SS"
    const pad = (n: number) => String(n).padStart(2, "0");
    const timeStr = `${pad(wakeTime.getMonth() + 1)}/${pad(wakeTime.getDate())}/${wakeTime.getFullYear()} ${pad(wakeTime.getHours())}:${pad(wakeTime.getMinutes())}:${pad(wakeTime.getSeconds())}`;

    const proc = Bun.spawn(
      ["sudo", "-n", "pmset", "schedule", "wakeorpoweron", timeStr],
      { stdout: "pipe", stderr: "pipe" },
    );
    await proc.exited;

    if (proc.exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      if (stderr.includes("sudo") || stderr.includes("password")) {
        return {
          scheduled: false,
          error:
            "sudo requires a password. To enable wake scheduling, add to /etc/sudoers.d/boost:\n" +
            `  ${process.env.USER} ALL=(root) NOPASSWD: /usr/bin/pmset schedule *`,
        };
      }
      return { scheduled: false, error: `pmset failed: ${stderr.trim()}` };
    }

    return { scheduled: true };
  }

  /**
   * Register (or re-register) the companion launchd job that refreshes
   * wake events daily for all tasks with wakeOnSchedule enabled.
   */
  async ensureWakeRefresher(): Promise<void> {
    const refreshId = "wake-refresh";
    const plistFile = join(PLIST_DIR, `${PLIST_PREFIX}.${refreshId}.plist`);
    const scriptFile = join(SCRIPTS_DIR, `${refreshId}.sh`);
    const logDir = getConfig().nightshift.logDir;
    mkdirSync(logDir, { recursive: true });
    mkdirSync(SCRIPTS_DIR, { recursive: true });

    // Script that re-schedules wake events for all wake-enabled tasks
    const script = `#!/bin/bash
# Boost: refresh wake schedules for nightshift tasks
set -euo pipefail
export PATH="$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:$PATH"
cd ${shellEscape(join(import.meta.dir, "..", "..", ".."))}
bun run src/nightshift/scheduler/refresh-wakes.ts
`;
    writeFileSync(scriptFile, script, { mode: 0o755 });

    const label = `${PLIST_PREFIX}.${refreshId}`;
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${escapeXml(label)}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${escapeXml(scriptFile)}</string>
    </array>
    <key>StartCalendarInterval</key>
    <array>
      <dict>
        <key>Hour</key>
        <integer>0</integer>
        <key>Minute</key>
        <integer>0</integer>
      </dict>
      <dict>
        <key>Hour</key>
        <integer>12</integer>
        <key>Minute</key>
        <integer>0</integer>
      </dict>
    </array>
    <key>StandardOutPath</key>
    <string>${escapeXml(`${logDir}/${refreshId}.out.log`)}</string>
    <key>StandardErrorPath</key>
    <string>${escapeXml(`${logDir}/${refreshId}.err.log`)}</string>
    <key>WorkingDirectory</key>
    <string>${escapeXml(join(import.meta.dir, "..", "..", ".."))}</string>
</dict>
</plist>`;

    // Unload old version if present
    if (existsSync(plistFile)) {
      const unload = Bun.spawn(["launchctl", "unload", plistFile], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await unload.exited;
    }

    writeFileSync(plistFile, plist);
    const proc = Bun.spawn(["launchctl", "load", plistFile], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
  }

  async register(task: NightshiftTask): Promise<void> {
    mkdirSync(SCRIPTS_DIR, { recursive: true });
    mkdirSync(PLIST_DIR, { recursive: true });

    // Write the execution script
    const script = buildScript(task);
    const scriptFile = this.scriptPath(task.id);
    writeFileSync(scriptFile, script, { mode: 0o755 });

    // Write and load the plist
    const plist = buildPlist(task, scriptFile);
    const plistFile = this.plistPath(task.id);
    writeFileSync(plistFile, plist);

    const proc = Bun.spawn(["launchctl", "load", plistFile], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;

    if (proc.exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      // Clean up on failure
      try { unlinkSync(plistFile); } catch {}
      try { unlinkSync(scriptFile); } catch {}
      throw new Error(`launchctl load failed: ${stderr}`);
    }

    // Schedule wake event and companion refresher if enabled
    if (task.wakeOnSchedule) {
      const wakeResult = await this.scheduleWake(task);
      await this.ensureWakeRefresher();
      if (!wakeResult.scheduled) {
        // Non-fatal: task is registered, just warn about wake
        console.error(`Wake scheduling warning: ${wakeResult.error}`);
      }
    }
  }

  async unregister(taskId: string): Promise<void> {
    const plistFile = this.plistPath(taskId);

    if (existsSync(plistFile)) {
      const proc = Bun.spawn(["launchctl", "unload", plistFile], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;
      try { unlinkSync(plistFile); } catch {}
    }

    const scriptFile = this.scriptPath(taskId);
    try { unlinkSync(scriptFile); } catch {}
  }

  async isRegistered(taskId: string): Promise<boolean> {
    return existsSync(this.plistPath(taskId));
  }

  async getStatus(
    taskId: string,
  ): Promise<{ registered: boolean; healthy: boolean; details?: string }> {
    const registered = existsSync(this.plistPath(taskId));
    if (!registered) return { registered: false, healthy: false };

    const label = `${PLIST_PREFIX}.${taskId}`;
    const proc = Bun.spawn(["launchctl", "list", label], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    return {
      registered: true,
      healthy: proc.exitCode === 0,
      details: stdout.trim(),
    };
  }

  async listRegistered(): Promise<string[]> {
    try {
      const files = readdirSync(PLIST_DIR);
      return files
        .filter(
          (f) => f.startsWith(`${PLIST_PREFIX}.`) && f.endsWith(".plist"),
        )
        .map((f) =>
          f
            .replace(`${PLIST_PREFIX}.`, "")
            .replace(".plist", ""),
        );
    } catch {
      return [];
    }
  }
}
