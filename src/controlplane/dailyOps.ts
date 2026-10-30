/**
 * P6 — Daily Ops Agent: persistent cron-style schedules + results ledger.
 * Scheduler tick survives Control Plane restarts (state in daily-ops.json).
 * Run history also mirrored under SAM_OUTPUT_HOME/runs/daily-ops/.
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { ensureOutputHome } from "../lib/outputHome.js";

export type DailySchedule = string;

export type DailyOpsItem = {
  id: string;
  title: string;
  prompt: string;
  schedule: DailySchedule;
  enabled: boolean;
  createdAt: string;
  lastRunAt?: string;
  nextRunAt?: string;
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
  runDir?: string;
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

/** Normalize UI aliases to a comparable schedule string. */
export function normalizeSchedule(raw: string | undefined): string {
  const s = String(raw || "manual").trim().toLowerCase();
  if (!s || s === "manual") return "manual";
  if (s === "daily-09" || s === "daily-09:00") return "0 9 * * *";
  if (s === "daily-18" || s === "daily-18:00") return "0 18 * * *";
  if (s === "weekdays-09" || s === "weekdays-09:00") return "0 9 * * 1-5";
  // HH:MM → cron minute hour * * *
  const hm = s.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) {
    const h = Number(hm[1]);
    const m = Number(hm[2]);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return `${m} ${h} * * *`;
  }
  // already cron-ish (5 fields) or pass-through
  return s;
}

/**
 * Minimal 5-field cron matcher: minute hour dom month dow
 * Supports *, ranges (1-5), lists (1,2,3), and step forms like star/n.
 */
export function cronMatches(expr: string, date: Date = new Date()): boolean {
  const parts = normalizeSchedule(expr).split(/\s+/);
  if (parts.length !== 5) return false;
  const [minE, hourE, domE, monE, dowE] = parts;
  const values = [
    date.getMinutes(),
    date.getHours(),
    date.getDate(),
    date.getMonth() + 1,
    date.getDay(), // 0=Sun
  ];
  const exprs = [minE, hourE, domE, monE, dowE];
  return exprs.every((e, i) => fieldMatches(e, values[i], i === 4));
}

function fieldMatches(expr: string, value: number, isDow: boolean): boolean {
  if (expr === "*") return true;
  return expr.split(",").some((token) => {
    const stepParts = token.split("/");
    const rangePart = stepParts[0];
    const step = stepParts[1] ? Number(stepParts[1]) : 1;
    if (!Number.isFinite(step) || step < 1) return false;
    let start: number;
    let end: number;
    if (rangePart === "*") {
      start = isDow ? 0 : 0;
      end = isDow ? 6 : value >= 31 ? 31 : 59;
      if (!isDow && value <= 23 && end === 59) {
        // infer max by field loosely: minutes 0-59, hours 0-23 handled via value check below
      }
      // For */n against a concrete value: value % step === 0 (when start=0)
      if (rangePart === "*") return value % step === 0;
    }
    if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-").map(Number);
      start = a;
      end = b;
    } else {
      start = Number(rangePart);
      end = start;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
    if (value < start || value > end) return false;
    return (value - start) % step === 0;
  });
}

/** Compute next run after `from` for a schedule (searches up to 8 days, 1-min steps). */
export function computeNextRunAt(
  schedule: string,
  from: Date = new Date()
): string | undefined {
  const norm = normalizeSchedule(schedule);
  if (norm === "manual") return undefined;
  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  for (let i = 0; i < 60 * 24 * 8; i++) {
    if (cronMatches(norm, cursor)) return cursor.toISOString();
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return undefined;
}

/**
 * A job is due when enabled, schedule is not manual, and either:
 * - nextRunAt <= now, or
 * - cron matches current minute and lastRunAt is not this same minute.
 */
export function isJobDue(job: DailyOpsItem, now: Date = new Date()): boolean {
  if (!job.enabled) return false;
  const sched = normalizeSchedule(job.schedule);
  if (sched === "manual") return false;
  if (job.nextRunAt) {
    const next = Date.parse(job.nextRunAt);
    if (Number.isFinite(next) && next <= now.getTime()) {
      // avoid double-fire in the same minute
      if (job.lastRunAt) {
        const last = new Date(job.lastRunAt);
        if (
          last.getFullYear() === now.getFullYear() &&
          last.getMonth() === now.getMonth() &&
          last.getDate() === now.getDate() &&
          last.getHours() === now.getHours() &&
          last.getMinutes() === now.getMinutes()
        ) {
          return false;
        }
      }
      return true;
    }
  }
  if (!cronMatches(sched, now)) return false;
  if (job.lastRunAt) {
    const last = new Date(job.lastRunAt);
    if (
      last.getFullYear() === now.getFullYear() &&
      last.getMonth() === now.getMonth() &&
      last.getDate() === now.getDate() &&
      last.getHours() === now.getHours() &&
      last.getMinutes() === now.getMinutes()
    ) {
      return false;
    }
  }
  return true;
}

export function addDailyJob(
  cwd: string,
  input: { title: string; schedule?: string; prompt?: string }
): DailyOpsItem {
  const store = load(cwd);
  const title = (input.title || "").trim();
  if (!title) throw new Error("title required");
  const schedule = normalizeSchedule(input.schedule || "manual");
  const item: DailyOpsItem = {
    id: `ops-${crypto.randomBytes(4).toString("hex")}`,
    title,
    prompt: (input.prompt || title).trim(),
    schedule,
    enabled: true,
    createdAt: new Date().toISOString(),
    nextRunAt: computeNextRunAt(schedule),
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
  if (item.enabled) {
    item.nextRunAt = computeNextRunAt(item.schedule);
  }
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

export function updateJobSchedule(
  cwd: string,
  id: string,
  schedule: string
): DailyOpsItem | null {
  const store = load(cwd);
  const item = store.jobs.find((i) => i.id === id);
  if (!item) return null;
  item.schedule = normalizeSchedule(schedule);
  item.nextRunAt = computeNextRunAt(item.schedule);
  save(cwd, store);
  return item;
}

function mirrorRunHistory(
  entry: DailyLedgerEntry,
  job: DailyOpsItem | undefined
): string {
  const layout = ensureOutputHome();
  const day = entry.at.slice(0, 10);
  const runDir = path.join(layout.runs, "daily-ops", day, entry.id);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "result.json"),
    JSON.stringify(
      {
        ...entry,
        job: job
          ? {
              id: job.id,
              title: job.title,
              schedule: job.schedule,
            }
          : undefined,
      },
      null,
      2
    ),
    "utf-8"
  );
  return runDir;
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
  const item = store.jobs.find((i) => i.id === input.taskId);
  try {
    entry.runDir = mirrorRunHistory(entry, item);
  } catch {
    /* non-fatal */
  }
  store.ledger.unshift(entry);
  if (store.ledger.length > 200) store.ledger.length = 200;
  if (item) {
    item.lastRunAt = entry.at;
    item.lastResult = input.success ? "ok" : "fail";
    item.lastSummary = entry.summary.slice(0, 200);
    item.nextRunAt = computeNextRunAt(item.schedule, new Date(entry.at));
  }
  save(cwd, store);
  return entry;
}

export type SchedulerHandle = {
  stop: () => void;
  tickNow: () => Promise<string[]>;
};

export type SchedulerOptions = {
  cwd: string;
  intervalMs?: number;
  /** Called for each due job; return summary. Throw/reject → recorded as fail. */
  onRun: (job: DailyOpsItem) => Promise<{ success: boolean; summary: string }>;
  /** Optional clock for tests */
  now?: () => Date;
};

/**
 * Start an in-process scheduler that ticks every intervalMs (default 30s).
 * State persists in daily-ops.json so schedules survive process restart.
 */
export function startDailyOpsScheduler(opts: SchedulerOptions): SchedulerHandle {
  const intervalMs = Math.max(5_000, opts.intervalMs ?? 30_000);
  let stopped = false;
  let running = false;

  const tickNow = async (): Promise<string[]> => {
    if (running) return [];
    running = true;
    const fired: string[] = [];
    try {
      const now = opts.now ? opts.now() : new Date();
      const store = load(opts.cwd);
      // Refresh nextRunAt for jobs missing it
      let dirty = false;
      for (const job of store.jobs) {
        if (job.enabled && !job.nextRunAt && normalizeSchedule(job.schedule) !== "manual") {
          job.nextRunAt = computeNextRunAt(job.schedule, now);
          dirty = true;
        }
      }
      if (dirty) save(opts.cwd, store);

      for (const job of store.jobs) {
        if (!isJobDue(job, now)) continue;
        fired.push(job.id);
        try {
          const result = await opts.onRun(job);
          recordDailyResult(opts.cwd, {
            taskId: job.id,
            prompt: job.prompt,
            success: result.success,
            summary: result.summary,
          });
        } catch (e: any) {
          recordDailyResult(opts.cwd, {
            taskId: job.id,
            prompt: job.prompt,
            success: false,
            summary: e?.message || String(e),
          });
        }
      }
    } finally {
      running = false;
    }
    return fired;
  };

  const timer = setInterval(() => {
    if (stopped) return;
    void tickNow();
  }, intervalMs);
  // Don't keep process alive solely for the scheduler in tests
  if (typeof timer.unref === "function") timer.unref();

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
    tickNow,
  };
}
