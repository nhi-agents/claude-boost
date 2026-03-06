---
name: Boost Nightshift
description: This skill should be used when the user asks to "schedule a task", "add overnight task", "list scheduled tasks", "run task now", "remove scheduled task", "nightshift", "cron task", "automate overnight", or needs to manage scheduled Claude Code tasks.
user-invocable: true
allowed-tools:
  - mcp__boost__boost_nightshift
---

# Boost Nightshift - Scheduled Task Automation

Schedule and manage automated Claude Code tasks using macOS launchd.

Parse user arguments from the skill invocation (text after the trigger phrase).

Use the `boost_nightshift` tool with the appropriate action parameter.

## CRITICAL: One-Time vs Recurring

**BEFORE using `action: "add"`, clarify with the user:**
- "Do you want this to run ONCE or on a RECURRING schedule?"

Natural language like "at 2am" gets converted to cron, which is **always recurring**. Users often expect one-time execution.

- **One-time execution:** Use `action: "run"` on an existing task for immediate execution
- **Recurring tasks:** Use `action: "add"` only after confirming recurring intent

## Actions

**List tasks** (default, or "list"):
Use `boost_nightshift` with `action: "list"`.
- Optional: `tag` to filter by tag

**Add task** ("add", "schedule"):
Use `boost_nightshift` with `action: "add"` and:
- `name`: Task name (required)
- `schedule`: Cron expression (e.g., "0 2 * * *" for 2am daily)
- `command`: The prompt Claude should execute
- Recommended defaults: `skipPermissions: true`, `wakeOnSchedule: true`
- Optional: `worktree: { enabled: true }` for tasks that modify code
- Optional: `description`, `workingDirectory`, `timeout`, `timezone`, `tags`, `env`

**Run immediately** ("run"):
Use `boost_nightshift` with `action: "run"` and `taskId`.

**Remove task** ("remove", "delete"):
Use `boost_nightshift` with `action: "remove"` and `taskId`.

**Check status** ("status"):
Use `boost_nightshift` with `action: "status"` and `taskId`.

**View logs** ("logs"):
Use `boost_nightshift` with `action: "logs"` and `taskId`.
- Optional: `lines` (default: 100), `stream`: "stdout" | "stderr" | "both"

**Execution history** ("history"):
Use `boost_nightshift` with `action: "history"` and `taskId`.
- Optional: `limit` to cap results

## Examples

- `/boost:nightshift` — list all scheduled tasks
- `/boost:nightshift add "nightly-review" at 2am: review all changed files for bugs`
- `/boost:nightshift run abc12345`
- `/boost:nightshift logs abc12345`
- `/boost:nightshift remove abc12345`
