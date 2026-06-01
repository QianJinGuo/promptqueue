import BetterSqlite3 from "better-sqlite3";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

export interface DatabaseOptions {
  path: string;
  wal?: boolean;
}

function resolveDbPath(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

export function createDatabase(options: DatabaseOptions): BetterSqlite3.Database {
  const resolvedPath = resolveDbPath(options.path);

  if (resolvedPath !== ":memory:") {
    mkdirSync(dirname(resolvedPath), { recursive: true });
  }

  const db = new BetterSqlite3(resolvedPath);

  if (options.wal !== false) {
    db.pragma("journal_mode = WAL");
    db.pragma("wal_autocheckpoint = 1000");
  }

  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  return db;
}

export function runMigrations(db: BetterSqlite3.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set(
    (
      db.prepare("SELECT version FROM _migrations").all() as Array<{
        version: number;
      }>
    ).map((row) => row.version)
  );

  const metaUrl = import.meta.url;
  const currentDir = metaUrl
    ? dirname(fileURLToPath(metaUrl))
    : dirname(fileURLToPath(`file://${__filename}`));
  const migrationsDir = join(currentDir, "migrations");
  let files: string[];
  try {
    files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  } catch {
    return;
  }

  for (const file of files) {
    const match = file.match(/^(\d+)/);
    if (!match) continue;

    const version = parseInt(match[1]!, 10);
    if (applied.has(version)) continue;

    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    const txn = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (version) VALUES (?)").run(version);
    });
    txn();
  }
}

export function closeDatabase(db: BetterSqlite3.Database): void {
  db.close();
}
