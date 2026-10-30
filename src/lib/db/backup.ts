/**
 * SQLite file backups under tenant state/backups/.
 */
import * as fs from "fs";
import * as path from "path";
import type { SqlDriver } from "./types.js";

export type BackupResult = {
  ok: boolean;
  path?: string;
  error?: string;
};

export function backupSqlite(
  driver: SqlDriver,
  opts: { backupDir: string; label?: string; keep?: number } = { backupDir: "" }
): BackupResult {
  if (driver.kind !== "sqlite" || driver.location === ":memory:") {
    return { ok: false, error: "Backups require a file-backed SQLite database" };
  }
  const backupDir = opts.backupDir;
  if (!backupDir) return { ok: false, error: "backupDir required" };

  try {
    fs.mkdirSync(backupDir, { recursive: true });
    // Checkpoint WAL so the main file is consistent enough to copy
    try {
      driver.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    } catch {
      /* ignore */
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const label = (opts.label || "auto").replace(/[^a-z0-9_-]+/gi, "-");
    const dest = path.join(backupDir, `sam-harness-${label}-${stamp}.sqlite`);
    fs.copyFileSync(driver.location, dest);
    // Also copy -wal/-shm if present
    for (const suf of ["-wal", "-shm"]) {
      const side = driver.location + suf;
      if (fs.existsSync(side)) {
        try {
          fs.copyFileSync(side, dest + suf);
        } catch {
          /* ignore */
        }
      }
    }
    pruneBackups(backupDir, opts.keep ?? 10);
    return { ok: true, path: dest };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

function pruneBackups(dir: string, keep: number): void {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith("sam-harness-") && f.endsWith(".sqlite"))
      .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    for (const extra of files.slice(Math.max(0, keep))) {
      try {
        fs.rmSync(path.join(dir, extra.f), { force: true });
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}
