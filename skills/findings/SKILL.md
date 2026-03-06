---
name: Boost Findings
description: This skill should be used when the user asks to "record a finding", "log a bug", "search findings", "list findings", "track issue", "add finding", or needs to store and recall code analysis results.
user-invocable: true
allowed-tools:
  - mcp__boost__boost_findings
---

# Boost Findings - Code Analysis Memory

Store, search, and manage findings from code analysis. Findings persist across sessions with full-text search.

Parse user arguments from the skill invocation (text after the trigger phrase).

Use the `boost_findings` tool with the appropriate action parameter.

## Actions

**List findings** (default, or "list"):
Use `boost_findings` with `action: "list"`.
- Optional: `typeFilter` (bug, security, performance, quality, note)
- Optional: `severityFilter` (critical, high, medium, low, info)
- Optional: `statusFilter` (open, fixed, wontfix, duplicate)
- Optional: `limit`

**Add finding** ("add", "record", "log"):
Use `boost_findings` with `action: "add"` and:
- `title`: Short summary (required)
- `description`: Detailed explanation (required)
- `type`: bug, security, performance, quality, or note
- `severity`: critical, high, medium, low, or info
- Optional: `filePaths`, `tags`

**Search** ("search", "find", "recall"):
Use `boost_findings` with `action: "search"` and `query`.
- Uses FTS5 full-text search across titles, descriptions, and tags

**Get by ID** ("get"):
Use `boost_findings` with `action: "get"` and `id`.

**Update status** ("update", "fix", "close"):
Use `boost_findings` with `action: "update"`, `id`, and `status`.

## Examples

- `/boost:findings` — list all open findings
- `/boost:findings add bug: SQL injection in login handler`
- `/boost:findings search authentication`
- `/boost:findings update abc123 fixed`
