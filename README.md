# claude-boost

Overnight automation and superpowers for Claude Code. An MCP server that adds scheduled task execution and a persistent findings memory to your Claude Code sessions.

## Features

### Nightshift — Scheduled Tasks

Schedule Claude Code to run tasks automatically on a cron schedule. Perfect for nightly code reviews, security audits, dependency updates, or any recurring automation.

- **Cron scheduling** via macOS launchd (plist-based, survives reboots)
- **Sleep prevention** — `wakeOnSchedule` wakes your Mac from sleep via `pmset` and keeps it awake with `caffeinate` during execution
- **Git worktree isolation** — each run gets its own branch, auto-commits and pushes changes
- **Execution tracking** — full history with status, duration, exit codes, and output previews
- **Log access** — read stdout/stderr from past runs directly through the tool

### Findings — Persistent Code Analysis Memory

Store and recall findings from code analysis sessions. Claude can record bugs, security issues, performance problems, and quality notes, then search them later using full-text search.

- **Categorized findings** — type (bug, security, performance, quality, note) and severity levels
- **Full-text search** — powered by SQLite FTS5
- **Status tracking** — open, fixed, wontfix, duplicate

## Requirements

- [Bun](https://bun.sh) >= 1.0.0
- macOS (launchd scheduler; the findings tool works on any platform)
- [GNU coreutils](https://formulae.brew.sh/formula/coreutils) — provides `timeout`, used to enforce time limits on scheduled tasks
  ```bash
  brew install coreutils
  ```

## Installation

Install boost as a Claude Code plugin:

```bash
claude plugin add --name boost /path/to/claude-boost
```

Or if hosted on GitHub:

```bash
claude plugin add --name boost github:nhiquach/claude-boost
```

This registers the MCP server so it's available in all your Claude Code sessions automatically.

## Usage

Once configured, Claude Code gains two tools:

### `boost_nightshift`

| Action | Description |
|--------|-------------|
| `add` | Create a scheduled task with a cron expression and prompt |
| `list` | Show all tasks with next run times and last execution status |
| `run` | Execute a task immediately (manual trigger) |
| `remove` | Delete a task and unregister from the scheduler |
| `status` | Check scheduler health for a task |
| `history` | View execution history for a task |
| `logs` | Read stdout/stderr output from past runs |

**Example — schedule a nightly code review:**

```
Use boost_nightshift to add a task called "nightly-review" that runs at 2am daily
with the prompt "Review all changed files for bugs and security issues, then
create a summary in REVIEW.md". Enable worktree isolation so it runs on its own branch.
Enable wakeOnSchedule so my laptop wakes up for it.
```

#### Wake on Schedule

Set `wakeOnSchedule: true` to ensure your Mac wakes from sleep for scheduled tasks. This does two things:

1. **`pmset schedule wakeorpoweron`** — schedules macOS to wake 2 minutes before the task runs
2. **`caffeinate -s`** — prevents the system from sleeping while the task executes

A companion launchd job (`com.claude.boost.wake-refresh`) runs twice daily to refresh wake events for the next 24 hours.

**Setup:** `pmset schedule` requires sudo. To enable passwordless access for just this command:

```bash
sudo visudo -f /etc/sudoers.d/boost
```

Add this line (replace `yourusername` with your macOS username):

```
yourusername ALL=(root) NOPASSWD: /usr/bin/pmset schedule *
```

Without this, tasks still run normally — they just can't wake a sleeping machine.

### `boost_findings`

| Action | Description |
|--------|-------------|
| `add` | Record a finding with type, severity, and description |
| `list` | Filter findings by type, severity, or status |
| `get` | Retrieve a specific finding by ID |
| `update` | Change a finding's status |
| `search` | Full-text search across all findings |

## Configuration

Optional config file at `~/.claude/boost/config.json`:

```json
{
  "nightshift": {
    "defaultTimeout": 300,
    "defaultTimezone": "America/Los_Angeles",
    "worktree": {
      "branchPrefix": "boost/",
      "remoteName": "origin"
    },
    "logDir": "~/.claude/boost/logs"
  }
}
```

Environment variables:
- `BOOST_DB` — custom path for the SQLite database (default: `~/.claude/boost/boost.db`)
- `BOOST_CONFIG` — custom path for the config file

## Data Storage

All data lives in `~/.claude/boost/`:
- `boost.db` — SQLite database (WAL mode) for tasks, executions, and findings
- `logs/` — stdout/stderr log files from scheduled runs
- `scripts/` — generated shell scripts for each scheduled task
- `config.json` — optional configuration overrides

Scheduled tasks register as launchd agents in `~/Library/LaunchAgents/` with the prefix `com.claude.boost`.

## Development

```bash
bun run dev     # Start with auto-reload
bun test        # Run tests
```
