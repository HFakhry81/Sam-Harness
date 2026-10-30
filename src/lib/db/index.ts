/**
 * Persistence entry — SQLite under output home by default; optional Postgres via DATABASE_URL.
 */
import * as fs from "fs";
import * as path from "path";
import { openSqlite } from "./sqliteDriver.js";
import { openPostgres, type PostgresHandle } from "./postgresDriver.js";
import { migrate, migratePostgres } from "./migrations.js";
import { importJsonState, type ImportResult } from "./importJson.js";
import { backupSqlite } from "./backup.js";
import * as docsRepo from "./docsRepo.js";
import * as runsRepo from "./runsRepo.js";
import {
  DEFAULT_TENANT_ID,
  getActiveTenantId,
  normalizeTenantId,
  tenantDbPath,
  tenantStateDir,
} from "../tenant/context.js";
import type { DocKind, SqlDriver } from "./types.js";
import { createLogger } from "../observability/logger.js";

const log = createLogger("db");

export type Persistence = {
  driver: SqlDriver;
  postgres?: PostgresHandle;
  tenantId: string;
  dbPath: string;
  importResult?: ImportResult;
};

let hub: Persistence | null = null;
let initPromise: Promise<Persistence> | null = null;

function resolveSqlitePath(tenantId: string): string {
  const envPath = String(process.env.SAM_DATABASE_PATH || "").trim();
  if (envPath === ":memory:") return ":memory:";
  if (envPath) {
    fs.mkdirSync(path.dirname(path.resolve(envPath)), { recursive: true });
    return path.resolve(envPath);
  }
  return tenantDbPath(tenantId);
}

function ensureTenant(driver: SqlDriver, tenantId: string): void {
  const now = new Date().toISOString();
  driver
    .prepare(
      `INSERT INTO tenants (id, name, cost_cap_usd, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`
    )
    .run(
      tenantId,
      tenantId === DEFAULT_TENANT_ID ? "Local owner" : tenantId,
      0.5,
      now,
      now
    );
}

/**
 * Initialize persistence (idempotent). Prefer await at process start.
 * SQLite is sync-ready after this; Postgres uses async handle for migrations.
 */
export async function initPersistence(opts?: {
  cwd?: string;
  tenantId?: string;
  skipImport?: boolean;
  skipBackup?: boolean;
}): Promise<Persistence> {
  if (hub) return hub;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const tenantId = normalizeTenantId(opts?.tenantId || getActiveTenantId());
    const databaseUrl = String(process.env.DATABASE_URL || "").trim();
    const cwd = opts?.cwd || process.cwd();

    if (databaseUrl) {
      const pg = await openPostgres(databaseUrl);
      await migratePostgres(
        (sql, params) => pg.execAsync(sql, params as never),
        (sql, params) => pg.queryAsync(sql, params as never)
      );
      // Mirror schema into a local SQLite cache for sync repo access
      const cachePath = resolveSqlitePath(tenantId);
      const driver = openSqlite(cachePath);
      migrate(driver);
      ensureTenant(driver, tenantId);
      let importResult: ImportResult | undefined;
      if (!opts?.skipImport) {
        importResult = importJsonState(driver, tenantId, cwd);
      }
      // Best-effort push kv_docs to Postgres
      try {
        const kinds = docsRepo.listDocKinds(driver, tenantId);
        for (const kind of kinds) {
          const payload = docsRepo.getDoc(driver, tenantId, kind);
          if (payload == null) continue;
          await pg.execAsync(
            `INSERT INTO kv_docs (tenant_id, kind, payload, updated_at)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (tenant_id, kind) DO UPDATE SET
               payload = EXCLUDED.payload,
               updated_at = EXCLUDED.updated_at`,
            [tenantId, kind, JSON.stringify(payload), new Date().toISOString()]
          );
        }
      } catch (e) {
        log.warn({ err: String(e) }, "postgres kv sync skipped");
      }
      hub = {
        driver,
        postgres: pg,
        tenantId,
        dbPath: cachePath,
        importResult,
      };
      log.info(
        { backend: "postgres+sqlite-cache", tenantId, dbPath: cachePath },
        "persistence ready"
      );
      return hub;
    }

    const dbPath = resolveSqlitePath(tenantId);
    const driver = openSqlite(dbPath);
    migrate(driver);
    ensureTenant(driver, tenantId);

    let importResult: ImportResult | undefined;
    if (!opts?.skipImport) {
      importResult = importJsonState(driver, tenantId, cwd);
      if (importResult.imported.length) {
        log.info({ imported: importResult.imported }, "imported legacy JSON state");
      }
    }

    if (!opts?.skipBackup && dbPath !== ":memory:") {
      const backupDir = path.join(tenantStateDir(tenantId), "backups");
      const b = backupSqlite(driver, { backupDir, label: "boot", keep: 10 });
      if (b.ok) log.info({ backup: b.path }, "sqlite backup");
    }

    hub = { driver, tenantId, dbPath, importResult };
    log.info({ backend: "sqlite", tenantId, dbPath }, "persistence ready");
    return hub;
  })();
  try {
    return await initPromise;
  } catch (e) {
    initPromise = null;
    throw e;
  }
}

/** Sync init for SQLite-only paths (tests / CLI without top-level await). */
export function initPersistenceSync(opts?: {
  cwd?: string;
  tenantId?: string;
  skipImport?: boolean;
  skipBackup?: boolean;
}): Persistence {
  if (hub) return hub;
  if (String(process.env.DATABASE_URL || "").trim()) {
    throw new Error("initPersistenceSync cannot open Postgres — use await initPersistence()");
  }
  const tenantId = normalizeTenantId(opts?.tenantId || getActiveTenantId());
  const dbPath = resolveSqlitePath(tenantId);
  const driver = openSqlite(dbPath);
  migrate(driver);
  ensureTenant(driver, tenantId);
  let importResult: ImportResult | undefined;
  if (!opts?.skipImport) {
    importResult = importJsonState(driver, tenantId, opts?.cwd || process.cwd());
  }
  if (!opts?.skipBackup && dbPath !== ":memory:") {
    backupSqlite(driver, {
      backupDir: path.join(tenantStateDir(tenantId), "backups"),
      label: "boot",
      keep: 10,
    });
  }
  hub = { driver, tenantId, dbPath, importResult };
  return hub;
}

export function getPersistence(): Persistence {
  if (!hub) {
    return initPersistenceSync({ skipBackup: true });
  }
  return hub;
}

export function getDriver(): SqlDriver {
  return getPersistence().driver;
}

export function isPersistenceReady(): boolean {
  return hub != null;
}

/** Test helper — close and clear singleton. */
export function __resetPersistenceForTests(): void {
  try {
    hub?.driver.close();
  } catch {
    /* ignore */
  }
  if (hub?.postgres) {
    void hub.postgres.closeAsync();
  }
  hub = null;
  initPromise = null;
}

export function loadDoc<T>(kind: DocKind, tenantId?: string): T | null {
  const p = getPersistence();
  return docsRepo.getDoc<T>(p.driver, tenantId || p.tenantId, kind);
}

export function saveDoc(kind: DocKind, payload: unknown, tenantId?: string): void {
  const p = getPersistence();
  const tid = tenantId || p.tenantId;
  docsRepo.setDoc(p.driver, tid, kind, payload);
  if (p.postgres) {
    void p.postgres
      .execAsync(
        `INSERT INTO kv_docs (tenant_id, kind, payload, updated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, kind) DO UPDATE SET
           payload = EXCLUDED.payload,
           updated_at = EXCLUDED.updated_at`,
        [tid, kind, JSON.stringify(payload), new Date().toISOString()]
      )
      .catch((e) => log.warn({ err: String(e), kind }, "postgres doc sync failed"));
  }
}

export { docsRepo, runsRepo, backupSqlite, importJsonState };
export type { SqlDriver, DocKind, Persistence as PersistenceHub };
