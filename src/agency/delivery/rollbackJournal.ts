/**
 * P10 — Rollback journal for Level-3 file writes under target repos.
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

export type RollbackEntry = {
  id: string;
  at: string;
  targetRepo: string;
  filePath: string;
  action: "write" | "restore";
  backupPath?: string;
  note?: string;
};

export type RollbackStore = { entries: RollbackEntry[] };

function journalPath(harnessRoot: string): string {
  return path.join(harnessRoot, "rollback-journal.json");
}

function backupDir(harnessRoot: string): string {
  return path.join(harnessRoot, "rollback-backups");
}

function load(harnessRoot: string): RollbackStore {
  const p = journalPath(harnessRoot);
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    /* ignore */
  }
  return { entries: [] };
}

function save(harnessRoot: string, store: RollbackStore): void {
  fs.writeFileSync(journalPath(harnessRoot), JSON.stringify(store, null, 2), "utf-8");
}

export function loadRollbackJournal(harnessRoot: string): RollbackStore {
  return load(harnessRoot);
}

/**
 * Record a batch of Level-3 writes into the rollback journal (one entry per file).
 * Used by the implementer after applying a pack of file changes.
 */
export function appendRollbackEntry(
  harnessRoot: string,
  opts: {
    targetRepo: string;
    files: Array<{ path: string; action?: "write" | "restore" }>;
    summary?: string;
  }
): RollbackEntry[] {
  const entries: RollbackEntry[] = [];
  for (const f of opts.files) {
    if ((f.action || "write") !== "write") continue;
    entries.push(
      recordWriteWithBackup(harnessRoot, {
        targetRepo: opts.targetRepo,
        filePath: f.path,
        note: opts.summary,
      })
    );
  }
  return entries;
}

export function listRollback(harnessRoot: string): RollbackEntry[] {
  return load(harnessRoot).entries;
}

export function recordWriteWithBackup(
  harnessRoot: string,
  opts: { targetRepo: string; filePath: string; note?: string }
): RollbackEntry {
  const abs = path.isAbsolute(opts.filePath)
    ? opts.filePath
    : path.join(opts.targetRepo, opts.filePath);
  const id = `rb-${crypto.randomBytes(4).toString("hex")}`;
  let backupPath: string | undefined;
  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
    const dir = backupDir(harnessRoot);
    fs.mkdirSync(dir, { recursive: true });
    backupPath = path.join(dir, `${id}${path.extname(abs) || ".bak"}`);
    fs.copyFileSync(abs, backupPath);
  }
  const entry: RollbackEntry = {
    id,
    at: new Date().toISOString(),
    targetRepo: opts.targetRepo,
    filePath: abs,
    action: "write",
    backupPath,
    note: opts.note,
  };
  const store = load(harnessRoot);
  store.entries.unshift(entry);
  if (store.entries.length > 200) store.entries.length = 200;
  save(harnessRoot, store);
  return entry;
}

export function restoreRollback(harnessRoot: string, id: string): RollbackEntry {
  const store = load(harnessRoot);
  const src = store.entries.find((e) => e.id === id && e.action === "write");
  if (!src) throw new Error("rollback entry not found");
  if (!src.backupPath || !fs.existsSync(src.backupPath)) {
    throw new Error("no backup available for this entry (file was new)");
  }
  fs.mkdirSync(path.dirname(src.filePath), { recursive: true });
  fs.copyFileSync(src.backupPath, src.filePath);
  const entry: RollbackEntry = {
    id: `rb-restore-${crypto.randomBytes(3).toString("hex")}`,
    at: new Date().toISOString(),
    targetRepo: src.targetRepo,
    filePath: src.filePath,
    action: "restore",
    backupPath: src.backupPath,
    note: `Restored from ${src.id}`,
  };
  store.entries.unshift(entry);
  save(harnessRoot, store);
  return entry;
}
