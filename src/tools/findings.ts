import { randomUUID } from "crypto";
import { getDb } from "../db/index.js";
import type { Finding, FindingInput } from "../types/index.js";

function rowToFinding(row: Record<string, unknown>): Finding {
  return {
    id: row.id as string,
    type: row.type as Finding["type"],
    title: row.title as string,
    description: row.description as string,
    filePaths: JSON.parse((row.file_paths as string) ?? "[]"),
    tags: JSON.parse((row.tags as string) ?? "[]"),
    severity: row.severity as Finding["severity"],
    status: row.status as Finding["status"],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function handleAdd(input: FindingInput) {
  if (!input.title) return { success: false, error: "title is required" };
  if (!input.description) return { success: false, error: "description is required" };

  const db = getDb();
  const id = randomUUID().slice(0, 12);

  db.run(
    `INSERT INTO findings (id, type, title, description, file_paths, tags, severity)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.type ?? "note",
      input.title,
      input.description,
      JSON.stringify(input.filePaths ?? []),
      JSON.stringify(input.tags ?? []),
      input.severity ?? "medium",
    ],
  );

  const row = db
    .query("SELECT * FROM findings WHERE id = ?")
    .get(id) as Record<string, unknown>;

  return { success: true, finding: rowToFinding(row) };
}

function handleGet(input: FindingInput) {
  if (!input.id) return { success: false, error: "id is required" };

  const db = getDb();
  const row = db
    .query("SELECT * FROM findings WHERE id = ?")
    .get(input.id) as Record<string, unknown> | null;

  if (!row) return { success: false, error: `Finding not found: ${input.id}` };
  return { success: true, finding: rowToFinding(row) };
}

function handleList(input: FindingInput) {
  const db = getDb();
  let sql = "SELECT * FROM findings WHERE 1=1";
  const params: (string | number | null)[] = [];

  if (input.typeFilter) {
    sql += " AND type = ?";
    params.push(input.typeFilter);
  }
  if (input.severityFilter) {
    sql += " AND severity = ?";
    params.push(input.severityFilter);
  }
  if (input.statusFilter) {
    sql += " AND status = ?";
    params.push(input.statusFilter);
  }

  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(input.limit ?? 50);

  const rows = db.query(sql).all(...params) as Record<string, unknown>[];
  return {
    success: true,
    findings: rows.map(rowToFinding),
    count: rows.length,
  };
}

function handleUpdate(input: FindingInput) {
  if (!input.id) return { success: false, error: "id is required" };

  const db = getDb();
  const existing = db
    .query("SELECT * FROM findings WHERE id = ?")
    .get(input.id) as Record<string, unknown> | null;
  if (!existing) return { success: false, error: `Finding not found: ${input.id}` };

  if (input.status) {
    db.run(
      "UPDATE findings SET status = ?, updated_at = datetime('now') WHERE id = ?",
      [input.status, input.id],
    );
  }

  const row = db
    .query("SELECT * FROM findings WHERE id = ?")
    .get(input.id) as Record<string, unknown>;

  return { success: true, finding: rowToFinding(row) };
}

function handleSearch(input: FindingInput) {
  if (!input.query) return { success: false, error: "query is required" };

  const db = getDb();
  const limit = input.limit ?? 20;

  const rows = db
    .query(
      `SELECT f.* FROM findings f
       JOIN findings_fts fts ON f.rowid = fts.rowid
       WHERE findings_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
    )
    .all(input.query, limit) as Record<string, unknown>[];

  return {
    success: true,
    findings: rows.map(rowToFinding),
    count: rows.length,
  };
}

export async function handleFindings(input: FindingInput) {
  switch (input.action) {
    case "add":
      return handleAdd(input);
    case "get":
      return handleGet(input);
    case "list":
      return handleList(input);
    case "update":
      return handleUpdate(input);
    case "search":
      return handleSearch(input);
    default:
      return {
        success: false,
        error: `Unknown action: ${(input as { action: string }).action}`,
      };
  }
}
