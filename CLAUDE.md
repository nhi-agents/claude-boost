# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

claude-boost is an MCP (Model Context Protocol) server that gives Claude Code two tools:
- **boost_nightshift** — schedule and manage automated Claude Code tasks via cron (macOS launchd)
- **boost_findings** — store, search, and manage code analysis findings with FTS5 full-text search

It runs as a stdio MCP server invoked by Claude Code via `.mcp.json`.

## Commands

```bash
bun run start          # Start the MCP server (production)
bun run dev            # Start with --watch for auto-reload
bun test               # Run tests
```

The MCP server is launched by Claude Code via `scripts/run-mcp.sh`, which runs `bun install --silent` then `exec bun run src/index.ts`.

## Architecture

**Runtime:** Bun (not Node). Uses `bun:sqlite` for the database and `Bun.spawn` for process execution.

**Entrypoint:** `src/index.ts` — Creates an MCP `Server` with stdio transport, registers two tools (`boost_nightshift`, `boost_findings`), dispatches to handlers.

**Two tool domains:**

1. **Nightshift** (`src/nightshift/`) — Scheduled task management
   - `index.ts` — Router dispatching to action handlers by `input.action`
   - `actions/` — One file per action: add, run, list, remove, status, history, logs
   - `store.ts` — SQLite CRUD for tasks and executions (row↔object conversion)
   - `scheduler/` — OS scheduler abstraction:
     - `base.ts` — Abstract `BaseScheduler` class
     - `darwin.ts` — macOS implementation using launchd plist files + shell scripts
     - `shell.ts` — Shell escaping utilities with security patterns (`shellEscape`, `sanitizeForComment`)
     - `index.ts` — Factory `createScheduler()` (currently macOS only)

2. **Findings** (`src/tools/findings.ts`) — Self-contained CRUD + FTS5 search for code findings

**Database:** `src/db/` — SQLite via `bun:sqlite`, stored at `~/.claude/boost/boost.db`. Schema in `src/db/schema.ts` uses `CREATE IF NOT EXISTS` for idempotent init. WAL mode, foreign keys enabled.

**Config:** `src/config/index.ts` — JSON config at `~/.claude/boost/config.json`, deep-merged with defaults. Env overrides: `BOOST_DB`, `BOOST_CONFIG`.

**Tool schemas:** `src/tools/schemas.ts` — MCP tool definitions with JSON Schema input validation.

**Types:** `src/types/index.ts` — All shared TypeScript interfaces (task, execution, finding, tool inputs).

## Key Patterns

- Each nightshift action handler validates required fields, returns `{ success: boolean, error?: string, ... }`
- The scheduler writes launchd plist files to `~/Library/LaunchAgents/` and shell scripts to `~/.claude/boost/scripts/`
- Cron expressions are converted to launchd `StartCalendarInterval` via cartesian product expansion in `darwin.ts`
- Task add does a two-phase commit: save to DB first, then register with scheduler; rolls back DB on scheduler failure
- DB stores booleans as integers (0/1) and arrays/objects as JSON strings
- All IDs are truncated UUIDs (8 or 12 chars)
- `wakeOnSchedule` wraps task scripts with `caffeinate -s` and schedules `pmset wakeorpoweron` via `sudo -n` (non-interactive). A companion launchd job (`wake-refresh`) re-schedules wake events twice daily. The `refresh-wakes.ts` script is standalone and run by launchd directly.
- DB migrations for new columns use try/catch `ALTER TABLE ADD COLUMN` in `client.ts` (SQLite lacks `IF NOT EXISTS` for columns)
