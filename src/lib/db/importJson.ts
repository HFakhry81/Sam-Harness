/**
 * One-time import of legacy cwd JSON state files into kv_docs / related tables.
 */
import * as fs from "fs";
import * as path from "path";
import type { DocKind, SqlDriver } from "./types.js";
import { getDoc, setDoc } from "./docsRepo.js";

const DEFAULT_COST_CAP_USD = 0.5;

const KIND_FILES: Array<{ kind: DocKind; file: string }> = [
  { kind: "daily-ops", file: "daily-ops.json" },
  { kind: "comms-drafts", file: "comms-drafts.json" },
  { kind: "project-memory", file: "project-memory.json" },
  { kind: "hybrid-profile", file: "hybrid-profile.json" },
  { kind: "cost-ledger", file: "cost-ledger.json" },
  { kind: "task-lifecycle", file: "task-lifecycle.json" },
  { kind: "controlplane-session", file: "controlplane-session.json" },
  { kind: "delivery-board", file: "delivery-board.json" },
  { kind: "rollback-journal", file: "rollback-journal.json" },
];

function alreadyImported(driver: SqlDriver, tenantId: string, sourceFile: string): boolean {
  const row = driver
    .prepare(
      "SELECT 1 AS ok FROM json_import_log WHERE tenant_id = ? AND source_file = ?"
    )
    .get(tenantId, sourceFile);
  return Boolean(row);
}

function markImported(driver: SqlDriver, tenantId: string, sourceFile: string): void {
  driver
    .prepare(
      "INSERT OR IGNORE INTO json_import_log (tenant_id, source_file, imported_at) VALUES (?, ?, ?)"
    )
    .run(tenantId, sourceFile, new Date().toISOString());
}

export type ImportResult = {
  imported: string[];
  skipped: string[];
};

export function importJsonState(
  driver: SqlDriver,
  tenantId: string,
  cwd: string
): ImportResult {
  const imported: string[] = [];
  const skipped: string[] = [];

  // Ensure tenant row
  const now = new Date().toISOString();
  driver
    .prepare(
      `INSERT INTO tenants (id, name, cost_cap_usd, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`
    )
    .run(tenantId, tenantId === "local" ? "Local owner" : tenantId, DEFAULT_COST_CAP_USD, now, now);

  for (const { kind, file } of KIND_FILES) {
    const abs = path.join(cwd, file);
    if (!fs.existsSync(abs)) {
      skipped.push(file);
      continue;
    }
    if (alreadyImported(driver, tenantId, file) && getDoc(driver, tenantId, kind) != null) {
      skipped.push(file);
      continue;
    }
    try {
      const raw = JSON.parse(fs.readFileSync(abs, "utf-8"));
      // Only import if DB empty for this kind
      if (getDoc(driver, tenantId, kind) == null) {
        setDoc(driver, tenantId, kind, raw);
        imported.push(file);
      } else {
        skipped.push(file);
      }
      markImported(driver, tenantId, file);
    } catch {
      skipped.push(file);
    }
  }

  // Sync cost cap from hybrid profile if present
  const profile = getDoc<{ costCapUsd?: number }>(driver, tenantId, "hybrid-profile");
  if (profile && typeof profile.costCapUsd === "number") {
    driver
      .prepare("UPDATE tenants SET cost_cap_usd = ?, updated_at = ? WHERE id = ?")
      .run(Math.max(0, profile.costCapUsd), new Date().toISOString(), tenantId);
  }

  return { imported, skipped };
}
