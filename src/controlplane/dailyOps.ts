/**
 * P6 — Daily Ops Agent: scheduled desktop tasks + results ledger.
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

export type DailySchedule = string;

export type DailyOpsItem = {
  id: string;
  title: string;
  prompt: string;
  schedule: DailySchedule;
  enabled: boolean;
  createdAt: string;
  lastRunAt?: string;
  lastResult?: string;
  lastSummary?: string;
};

export type DailyLedgerEntry = {
  id: string;
  taskId: string;
  prompt: string;
  at: string;
  success: boolean;
  summary: string;
};

export type DailyOpsStore = { jobs: DailyOpsItem[]; ledger: DailyLedgerEntry[] };

const FILE = "daily-ops.json";

function load(cwd: string): DailyOpsStore {
  const p = path.join(cwd, FILE);
  try {
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
      return {
        jobs: raw.jobs || raw.items || [],
        ledger: raw.ledger || [],
      };
    }
  } catch {
    /* ignore */
  }
  return { jobs: [], ledger: [] };
}

function save(cwd: string, store: DailyOpsStore): void {
  fs.writeFileSync(path.join(cwd, FILE), JSON.stringify(store, null, 2), "utf-8");
}

export function loadDailyOps(cwd: string): DailyOpsStore {
  return load(cwd);
}

export function addDailyJob(
  cwd: string,
  input: { title: string; schedule?: string; prompt?: string }
): DailyOpsItem {
  const store = load(cwd);
  const title = (input.title || "").trim();
  if (!title) throw new Error("title required");
  const item: DailyOpsItem = {
    id: `ops-${crypto.randomBytes(4).toString("hex")}`,
    title,
    prompt: (input.prompt || title).trim(),
    schedule: input.schedule || "manual",
    enabled: true,
    createdAt: new Date().toISOString(),
  };
  store.jobs.unshift(item);
  save(cwd, store);
  return item;
}

export function toggleDailyJob(cwd: string, id: string): DailyOpsItem | null {
  const store = load(cwd);
  const item = store.jobs.find((i) => i.id === id);
  if (!item) return null;
  item.enabled = !item.enabled;
  save(cwd, store);
  return item;
}

export function removeDailyJob(cwd: string, id: string): boolean {
  const store = load(cwd);
  const n = store.jobs.length;
  store.jobs = store.jobs.filter((i) => i.id !== id);
  save(cwd, store);
  return store.jobs.length < n;
}

export function recordDailyResult(
  cwd: string,
  input: { taskId: string; prompt: string; success: boolean; summary: string }
): DailyLedgerEntry {
  const store = load(cwd);
  const entry: DailyLedgerEntry = {
    id: `led-${Date.now().toString(36)}`,
    taskId: input.taskId,
    prompt: input.prompt,
    at: new Date().toISOString(),
    success: input.success,
    summary: input.summary.slice(0, 800),
  };
  store.ledger.unshift(entry);
  if (store.ledger.length > 100) store.ledger.length = 100;
  const item = store.jobs.find((i) => i.id === input.taskId);
  if (item) {
    item.lastRunAt = entry.at;
    item.lastResult = input.success ? "ok" : "fail";
    item.lastSummary = entry.summary.slice(0, 200);
  }
  save(cwd, store);
  return entry;
}
