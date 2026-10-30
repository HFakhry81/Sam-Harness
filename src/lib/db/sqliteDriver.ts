/**
 * Embedded SQLite driver via Node.js built-in `node:sqlite` (DatabaseSync).
 * Avoids native better-sqlite3 builds on Windows/Linux CI.
 */
import * as fs from "fs";
import * as path from "path";
import { DatabaseSync } from "node:sqlite";
import type { SqlDriver, SqlParams, SqlRow, SqlStatement } from "./types.js";

type Stmt = ReturnType<DatabaseSync["prepare"]>;

function wrapStatement(stmt: Stmt): SqlStatement {
  return {
    run(...params: SqlParams) {
      const r = stmt.run(...(params as never[]));
      return {
        changes: Number(r.changes ?? 0),
        lastInsertRowid: r.lastInsertRowid as number | bigint | undefined,
      };
    },
    get(...params: SqlParams) {
      const row = stmt.get(...(params as never[]));
      return row as SqlRow | undefined;
    },
    all(...params: SqlParams) {
      return stmt.all(...(params as never[])) as SqlRow[];
    },
  };
}

export function openSqlite(filePath: string): SqlDriver {
  if (filePath !== ":memory:") {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }
  const db = new DatabaseSync(filePath);
  try {
    // WAL + busy_timeout: parallel Vitest workers / CP children must not
    // fail immediately with SQLITE_BUSY ("database is locked").
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA busy_timeout = 8000;");
    db.exec("PRAGMA synchronous = NORMAL;");
    db.exec("PRAGMA foreign_keys = ON;");
  } catch {
    /* memory / restricted */
  }

  return {
    kind: "sqlite",
    location: filePath,
    exec(sql: string) {
      db.exec(sql);
    },
    prepare(sql: string) {
      return wrapStatement(db.prepare(sql));
    },
    transaction<T>(fn: () => T): T {
      db.exec("BEGIN");
      try {
        const out = fn();
        db.exec("COMMIT");
        return out;
      } catch (e) {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* ignore */
        }
        throw e;
      }
    },
    close() {
      db.close();
    },
  };
}
