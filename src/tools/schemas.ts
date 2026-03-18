import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const TOOLS: Tool[] = [
  {
    name: "boost_nightshift",
    description:
      "Schedule and manage automated Claude Code tasks that run overnight or on a cron schedule. " +
      "Supports worktree isolation so each task runs on its own branch. " +
      "Actions: add (create scheduled task), edit (update task fields), list (show all tasks), run (execute now), " +
      "remove (delete task), status (check scheduler health), logs (read output), history (execution records).",
    inputSchema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          enum: ["add", "edit", "list", "run", "remove", "status", "logs", "history"],
          description: "The operation to perform",
        },
        name: {
          type: "string",
          description: "Task name (for add/edit)",
        },
        schedule: {
          type: "string",
          description:
            'Cron expression, e.g. "0 2 * * *" for 2am daily (for add/edit)',
        },
        command: {
          type: "string",
          description: "The prompt/command for Claude to execute (for add/edit)",
        },
        description: {
          type: "string",
          description: "Human-readable description of what the task does",
        },
        workingDirectory: {
          type: "string",
          description: "Directory to run in (defaults to cwd)",
        },
        timeout: {
          type: "number",
          description: "Timeout in seconds (default 300)",
        },
        timezone: {
          type: "string",
          description: "Timezone (defaults to system timezone)",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags for filtering",
        },
        skipPermissions: {
          type: "boolean",
          description:
            "If true, runs with --dangerously-skip-permissions for unattended execution",
        },
        wakeOnSchedule: {
          type: "boolean",
          description:
            "If true, schedules macOS to wake from sleep before the task runs (requires sudo for pmset). Also wraps execution with caffeinate to prevent sleep during the run.",
        },
        worktree: {
          type: "object",
          properties: {
            enabled: { type: "boolean" },
            basePath: { type: "string" },
            branchPrefix: { type: "string" },
            remoteName: { type: "string" },
          },
          description: "Git worktree config for isolated execution",
        },
        env: {
          type: "object",
          description: "Extra environment variables",
        },
        taskId: {
          type: "string",
          description: "Task ID (for edit/run/remove/status/logs/history)",
        },
        tag: {
          type: "string",
          description: "Filter by tag (for list)",
        },
        lines: {
          type: "number",
          description: "Number of log lines to return (for logs, default 100)",
        },
        stream: {
          type: "string",
          enum: ["stdout", "stderr", "both"],
          description: "Which log stream to read (for logs, default both)",
        },
        limit: {
          type: "number",
          description: "Max results to return (for history)",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "boost_findings",
    description:
      "Store, search, and manage findings from code analysis — bugs, security issues, " +
      "performance problems, quality notes. Uses full-text search for recall. " +
      "Actions: add (store finding), list (filter by type/severity/status), " +
      "get (by ID), update (change status), search (full-text query).",
    inputSchema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          enum: ["add", "list", "get", "update", "search"],
          description: "The operation to perform",
        },
        type: {
          type: "string",
          enum: ["bug", "security", "performance", "quality", "note"],
          description: "Finding type (for add)",
        },
        title: {
          type: "string",
          description: "Short title (for add)",
        },
        description: {
          type: "string",
          description: "Detailed description (for add)",
        },
        filePaths: {
          type: "array",
          items: { type: "string" },
          description: "Affected file paths (for add)",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags for categorization (for add)",
        },
        severity: {
          type: "string",
          enum: ["critical", "high", "medium", "low", "info"],
          description: "Severity level (for add)",
        },
        id: {
          type: "string",
          description: "Finding ID (for get/update)",
        },
        status: {
          type: "string",
          enum: ["open", "fixed", "wontfix", "duplicate"],
          description: "New status (for update)",
        },
        query: {
          type: "string",
          description: "Search query (for search)",
        },
        limit: {
          type: "number",
          description: "Max results (for list/search)",
        },
        typeFilter: {
          type: "string",
          enum: ["bug", "security", "performance", "quality", "note"],
          description: "Filter by type (for list)",
        },
        severityFilter: {
          type: "string",
          enum: ["critical", "high", "medium", "low", "info"],
          description: "Filter by severity (for list)",
        },
        statusFilter: {
          type: "string",
          enum: ["open", "fixed", "wontfix", "duplicate"],
          description: "Filter by status (for list)",
        },
      },
      required: ["action"],
    },
  },
];
