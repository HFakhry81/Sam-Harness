import type { SqlDriver } from "./types.js";

export type Migration = {
  version: number;
  name: string;
  sql: string;
};

/** Versioned schema — apply in order. SQLite dialect; Postgres adapts TEXT/INTEGER. */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "phase3_core",
    sql: `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cost_cap_usd REAL NOT NULL DEFAULT 0.5,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kv_docs (
  tenant_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, kind)
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  phase TEXT NOT NULL DEFAULT 'idle',
  checkpoint_step TEXT,
  attempt INTEGER NOT NULL DEFAULT 0,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  exit_code INTEGER,
  idempotency_key TEXT,
  meta TEXT NOT NULL DEFAULT '{}',
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_runs_tenant_status ON runs (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_runs_thread ON runs (tenant_id, thread_id);

CREATE TABLE IF NOT EXISTS run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  duration_ms REAL,
  cost_usd REAL,
  detail TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events (run_id, at);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  meta TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_approvals_tenant ON approvals (tenant_id, status);

CREATE TABLE IF NOT EXISTS cost_entries (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  day TEXT NOT NULL,
  at TEXT NOT NULL,
  run_id TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  cloud INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_cost_tenant_day ON cost_entries (tenant_id, day);

CREATE TABLE IF NOT EXISTS checkpoints (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  parent_checkpoint_id TEXT,
  type TEXT,
  checkpoint BLOB,
  metadata BLOB,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);

CREATE TABLE IF NOT EXISTS checkpoint_writes (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  channel TEXT NOT NULL,
  type TEXT,
  value BLOB,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);

CREATE TABLE IF NOT EXISTS json_import_log (
  tenant_id TEXT NOT NULL,
  source_file TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, source_file)
);
`,
  },
];

function pgAdapt(sql: string): string {
  // SQLite BLOB → BYTEA; INTEGER booleans stay INTEGER.
  return sql.replace(/\bBLOB\b/gi, "BYTEA");
}

export function appliedVersions(driver: SqlDriver): Set<number> {
  try {
    driver.exec(`
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);`);
  } catch {
    /* exists */
  }
  const rows = driver.prepare("SELECT version FROM schema_migrations").all();
  return new Set(rows.map((r) => Number(r.version)));
}

export function migrate(driver: SqlDriver): { applied: number[] } {
  const have = appliedVersions(driver);
  const applied: number[] = [];
  for (const m of MIGRATIONS) {
    if (have.has(m.version)) continue;
    const sql = driver.kind === "postgres" ? pgAdapt(m.sql) : m.sql;
    driver.transaction(() => {
      driver.exec(sql);
      driver
        .prepare(
          "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)"
        )
        .run(m.version, m.name, new Date().toISOString());
    });
    applied.push(m.version);
  }
  return { applied };
}

/** Async migrate for Postgres handle. */
export async function migratePostgres(exec: (sql: string, params?: unknown[]) => Promise<void>, query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>): Promise<{ applied: number[] }> {
  await exec(`
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);`);
  const rows = await query("SELECT version FROM schema_migrations");
  const have = new Set(rows.map((r) => Number(r.version)));
  const applied: number[] = [];
  for (const m of MIGRATIONS) {
    if (have.has(m.version)) continue;
    await exec(pgAdapt(m.sql));
    await exec(
      "INSERT INTO schema_migrations (version, name, applied_at) VALUES ($1, $2, $3)",
      [m.version, m.name, new Date().toISOString()]
    );
    applied.push(m.version);
  }
  return { applied };
}
