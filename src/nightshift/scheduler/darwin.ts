import { BaseScheduler } from "./base.js";
import { shellEscape, sanitizeForComment } from "./shell.js";
import { getConfig } from "../../config/index.js";
import { getAllTasks } from "../store.js";
import type { NightshiftTask } from "../../types/index.js";
import { Cron } from "croner";
import { mkdirSync, writeFileSync, existsSync, unlinkSync, readdirSync } from "fs";
import { join } from "path";

const PLIST_DIR = `${process.env.HOME}/Library/LaunchAgents`;
const PLIST_PREFIX = "com.claude.boost";
const SCRIPTS_DIR = `${process.env.HOME}/.claude/boost/scripts`;
const DAEMON_PLIST_DIR = "/Library/LaunchDaemons";
const WAKE_KICKER_LABEL = `${PLIST_PREFIX}.wake-kicker`;
const WAKE_KICKER_PLIST_PATH = `${DAEMON_PLIST_DIR}/${WAKE_KICKER_LABEL}.plist`;
const WAKE_LEAD_MINUTES = 2;

/**
 * Generate a copy-pasteable setup command that configures passwordless sudo
 * for wake scheduling. Emitted in error messages when sudo fails.
 * Uses a heredoc inside bash -c for robust multi-line content.
 */
function wakeSetupCommand(): string {
  const user = process.env.USER ?? "$(whoami)";
  const dp = WAKE_KICKER_PLIST_PATH;
  return `sudo bash -c 'cat > /etc/sudoers.d/boost << "BOOST_EOF"
# Boost: wakeOnSchedule support for Claude Code scheduled tasks.
${user} ALL=(root) NOPASSWD: /usr/bin/pmset schedule *
${user} ALL=(root) NOPASSWD: /bin/cp /tmp/${WAKE_KICKER_LABEL}.plist ${dp}
${user} ALL=(root) NOPASSWD: /bin/chmod 644 ${dp}
${user} ALL=(root) NOPASSWD: /usr/sbin/chown root\\:wheel ${dp}
${user} ALL=(root) NOPASSWD: /bin/launchctl bootstrap system ${dp}
${user} ALL=(root) NOPASSWD: /bin/launchctl bootout system/${WAKE_KICKER_LABEL}
${user} ALL=(root) NOPASSWD: /bin/rm ${dp}
BOOST_EOF
chmod 440 /etc/sudoers.d/boost'`;
}

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

/**
 * Shift StartCalendarInterval entries back by `minutes` to create
 * a pre-task wake schedule. Handles minute/hour wraparound.
 *
 * Note: day-boundary crossing (e.g., 00:01 → 23:59) adjusts Hour
 * but does not adjust Day/Weekday, which is correct for daily tasks
 * but may misfire for weekly/monthly tasks at midnight. Acceptable for V1.
 */
function shiftIntervalsBack(
  intervals: Array<Record<string, number>>,
  minutes: number,
): Array<Record<string, number>> {
  return intervals.map((interval) => {
    const result = { ...interval };
    if (!("Minute" in result)) return result;

    result.Minute -= minutes;
    if (result.Minute < 0) {
      result.Minute += 60;
      if ("Hour" in result) {
        result.Hour -= 1;
        if (result.Hour < 0) {
          result.Hour += 24;
        }
      }
    }

    return result;
  });
}

function buildWakeKickerScript(): string {
  const logFile = join(getConfig().nightshift.logDir, "wake-kicker.log");
  return `#!/bin/bash
# Boost: Promote DarkWake to Full Wake for scheduled LaunchAgents.
# On battery, pmset wakeorpoweron only triggers a DarkWake (no display/GUI).
# caffeinate -u asserts user activity, turning on the display and establishing
# the Aqua session so LaunchAgents can fire on schedule.
set -euo pipefail

LOG=${shellEscape(logFile)}
echo "$(date '+%Y-%m-%d %H:%M:%S') wake-kicker: promoting to full wake" >> "$LOG"

# Assert user activity: turns display on, promotes DarkWake to UserWake.
# Hold for 5 minutes — enough for LaunchAgents to start and caffeinate themselves.
/usr/bin/caffeinate -u -t 300

echo "$(date '+%Y-%m-%d %H:%M:%S') wake-kicker: done" >> "$LOG"
`;
}

function buildWakeKickerPlist(
  scriptPath: string,
  intervals: Array<Record<string, number>>,
): string {
  const logDir = getConfig().nightshift.logDir;
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

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${escapeXml(WAKE_KICKER_LABEL)}</string>
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
    <string>${escapeXml(`${logDir}/wake-kicker.out.log`)}</string>
    <key>StandardErrorPath</key>
    <string>${escapeXml(`${logDir}/wake-kicker.err.log`)}</string>
</dict>
</plist>`;
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
# Allow non-zero exits from Claude/timeout (exit 124 = timeout reached)
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

  /** Run a command with sudo -n (non-interactive). */
  private async sudo(
    ...args: string[]
  ): Promise<{ ok: boolean; stderr: string }> {
    const proc = Bun.spawn(["sudo", "-n", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    const stderr = await new Response(proc.stderr).text();
    return { ok: proc.exitCode === 0, stderr: stderr.trim() };
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
            "sudo requires a password for pmset. Run this once to enable wake scheduling:\n\n" +
            wakeSetupCommand(),
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

  /**
   * Install or update the wake-kicker LaunchDaemon.
   * Aggregates schedules from all wake-enabled tasks and creates a single
   * system-level daemon that promotes DarkWake → Full Wake via caffeinate -u.
   *
   * This is necessary because pmset wakeorpoweron on battery only triggers
   * a DarkWake (no display, no Aqua session), and LaunchAgents require Aqua.
   * The daemon runs in the System session (active during DarkWake) and asserts
   * user activity to establish the Aqua session before LaunchAgents fire.
   */
  async ensureWakeKicker(): Promise<{ installed: boolean; error?: string }> {
    const tasks = getAllTasks({ enabledOnly: true });
    const wakeTasks = tasks.filter((t) => t.wakeOnSchedule);

    if (wakeTasks.length === 0) {
      await this.removeWakeKicker();
      return { installed: false };
    }

    // Collect all intervals from wake-enabled tasks, shifted back 2 minutes
    const allIntervals: Array<Record<string, number>> = [];
    for (const task of wakeTasks) {
      const taskIntervals = cronToCalendarInterval(task.schedule);
      allIntervals.push(
        ...shiftIntervalsBack(taskIntervals, WAKE_LEAD_MINUTES),
      );
    }

    // Deduplicate intervals (multiple tasks at the same time)
    const seen = new Set<string>();
    const uniqueIntervals = allIntervals.filter((interval) => {
      const key = JSON.stringify(interval);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Write the wake-kicker script
    mkdirSync(SCRIPTS_DIR, { recursive: true });
    const scriptPath = join(SCRIPTS_DIR, "wake-kicker.sh");
    writeFileSync(scriptPath, buildWakeKickerScript(), { mode: 0o755 });

    // Generate the plist and write to temp location
    const plist = buildWakeKickerPlist(scriptPath, uniqueIntervals);
    const tmpPlist = `/tmp/${WAKE_KICKER_LABEL}.plist`;
    writeFileSync(tmpPlist, plist);

    const daemonPlist = join(
      DAEMON_PLIST_DIR,
      `${WAKE_KICKER_LABEL}.plist`,
    );

    // Unload existing daemon if present (ignore errors)
    await this.sudo(
      "launchctl",
      "bootout",
      `system/${WAKE_KICKER_LABEL}`,
    );

    // Install plist to /Library/LaunchDaemons/
    const cp = await this.sudo("cp", tmpPlist, daemonPlist);
    if (!cp.ok) {
      try {
        unlinkSync(tmpPlist);
      } catch {}
      if (cp.stderr.includes("sudo") || cp.stderr.includes("password")) {
        return {
          installed: false,
          error:
            "sudo requires a password for the wake kicker. Run this once to enable:\n\n" +
            wakeSetupCommand(),
        };
      }
      return {
        installed: false,
        error: `Failed to install wake kicker: ${cp.stderr}`,
      };
    }

    // Set correct ownership and permissions for LaunchDaemon
    await this.sudo("chmod", "644", daemonPlist);
    await this.sudo("chown", "root:wheel", daemonPlist);

    // Load the daemon
    const load = await this.sudo(
      "launchctl",
      "bootstrap",
      "system",
      daemonPlist,
    );
    if (!load.ok) {
      return {
        installed: false,
        error: `Failed to load wake kicker: ${load.stderr}`,
      };
    }

    try {
      unlinkSync(tmpPlist);
    } catch {}
    return { installed: true };
  }

  /** Remove the wake-kicker LaunchDaemon if installed. */
  async removeWakeKicker(): Promise<void> {
    await this.sudo(
      "launchctl",
      "bootout",
      `system/${WAKE_KICKER_LABEL}`,
    );
    await this.sudo(
      "rm",
      join(DAEMON_PLIST_DIR, `${WAKE_KICKER_LABEL}.plist`),
    );
    const scriptFile = join(SCRIPTS_DIR, "wake-kicker.sh");
    try {
      unlinkSync(scriptFile);
    } catch {}
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

    // Schedule wake event, companion refresher, and wake kicker if enabled
    if (task.wakeOnSchedule) {
      const wakeResult = await this.scheduleWake(task);
      await this.ensureWakeRefresher();
      const kickerResult = await this.ensureWakeKicker();
      if (!wakeResult.scheduled) {
        // Non-fatal: task is registered, just warn about wake
        console.error(`Wake scheduling warning: ${wakeResult.error}`);
      }
      if (!kickerResult.installed) {
        console.error(`Wake kicker warning: ${kickerResult.error}`);
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

    // Refresh wake kicker — removes it if no wake-enabled tasks remain
    await this.ensureWakeKicker();
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
