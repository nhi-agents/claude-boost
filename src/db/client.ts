import { Database } from "bun:sqlite";
import { SCHEMA } from "./schema.js";
import { mkdirSync } from "fs";
import { dirname } from "path";

const DB_PATH =
  process.env.BOOST_DB ??
  `${process.env.HOME}/.claude/boost/boost.db`;

let _db: Database | null = null;

export function getDb(): Database {
  if (_db) return _db;

  mkdirSync(dirname(DB_PATH), { recursive: true });

  _db = new Database(DB_PATH);
  _db.run("PRAGMA journal_mode = WAL");
  _db.run("PRAGMA foreign_keys = ON");
  _db.run("PRAGMA busy_timeout = 5000");

  // Run schema creation (idempotent via IF NOT EXISTS)
  _db.exec(SCHEMA);

  // Migrations for existing databases
  try {
    _db.exec(
      "ALTER TABLE nightshift_tasks ADD COLUMN wake_on_schedule INTEGER NOT NULL DEFAULT 0",
    );
  } catch {
    // Column already exists
  }

  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
