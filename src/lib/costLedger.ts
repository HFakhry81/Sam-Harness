/**
 * Runtime cost-cap enforcement — per-run + per-day token/cost ledger by model.
 * Ledger persisted in embedded DB (legacy cost-ledger.json imported once).
 */
import { loadHybridProfile } from "../controlplane/hybridProfile.js";
import { loadStoreDoc, saveStoreDoc } from "./db/storeBridge.js";
import { getActiveTenantId } from "./tenant/context.js";
import { getDriver, getPersistence } from "./db/index.js";
import { recordCost } from "./observability/metrics.js";
import * as crypto from "crypto";

const FILE = "cost-ledger.json";

/** Rough USD per 1M tokens (input/output averaged) for cloud estimates. */
const MODEL_USD_PER_1M: Record<string, number> = {
  default: 0.4,
  "gpt-oss:120b-cloud": 0.8,
  "claude": 3.0,
  "gemini": 0.5,
};

export class CostCapExceededError extends Error {
  readonly code = "COST_CAP_EXCEEDED";
  constructor(
    message: string,
    public readonly spentUsd: number,
    public readonly capUsd: number,
    public readonly scope: "day" | "run" = "day"
  ) {
    super(message);
    this.name = "CostCapExceededError";
  }
}

export type CostUsageEntry = {
  at: string;
  runId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  cloud: boolean;
};

export type CostLedger = {
  day: string; // YYYY-MM-DD (local)
  entries: CostUsageEntry[];
  byModel: Record<string, { inputTokens: number; outputTokens: number; costUsd: number; calls: number }>;
  runs: Record<string, { costUsd: number; inputTokens: number; outputTokens: number; cloudCalls: number }>;
};

export type CostBudgetSnapshot = {
  day: string;
  capUsd: number;
  spentUsd: number;
  remainingUsd: number;
  runId: string | null;
  runSpentUsd: number;
  byModel: CostLedger["byModel"];
  blocked: boolean;
  blockReason: string | null;
};

let activeRunId: string | null = null;

function dayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function emptyLedger(day = dayKey()): CostLedger {
  return { day, entries: [], byModel: {}, runs: {} };
}

export function estimateCostUsd(opts: {
  model: string;
  inputTokens: number;
  outputTokens: number;
}): number {
  const key = Object.keys(MODEL_USD_PER_1M).find(
    (k) => k !== "default" && opts.model.toLowerCase().includes(k.toLowerCase())
  );
  const rate = MODEL_USD_PER_1M[key || "default"] ?? MODEL_USD_PER_1M.default;
  const tokens = Math.max(0, opts.inputTokens) + Math.max(0, opts.outputTokens);
  return (tokens / 1_000_000) * rate;
}

/** Flat estimate when token counts are unknown (one cloud specialist call). */
export function estimateCloudCallUsd(model: string, promptChars = 0, outputChars = 0): number {
  const inputTokens = Math.max(200, Math.ceil(promptChars / 4));
  const outputTokens = Math.max(150, Math.ceil(outputChars / 4));
  return Math.max(0.0001, estimateCostUsd({ model, inputTokens, outputTokens }));
}

export function loadCostLedger(cwd: string): CostLedger {
  const raw = loadStoreDoc<Partial<CostLedger>>(cwd, "cost-ledger", FILE, emptyLedger());
  if (raw.day !== dayKey()) {
    const fresh = emptyLedger();
    saveCostLedger(cwd, fresh);
    return fresh;
  }
  return {
    day: raw.day || dayKey(),
    entries: Array.isArray(raw.entries) ? raw.entries : [],
    byModel: raw.byModel || {},
    runs: raw.runs || {},
  };
}

export function saveCostLedger(cwd: string, ledger: CostLedger): void {
  saveStoreDoc(cwd, "cost-ledger", ledger);
}

function mirrorCostEntry(
  cwd: string,
  row: CostUsageEntry
): void {
  try {
    getPersistence();
    const tenantId = getActiveTenantId();
    getDriver()
      .prepare(
        `INSERT INTO cost_entries (
          id, tenant_id, day, at, run_id, model, input_tokens, output_tokens, cost_usd, cloud
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        `ce-${crypto.randomBytes(4).toString("hex")}`,
        tenantId,
        dayKey(),
        row.at,
        row.runId,
        row.model,
        row.inputTokens,
        row.outputTokens,
        row.costUsd,
        row.cloud ? 1 : 0
      );
    // Per-tenant day spend can also be derived from tenants.cost_cap_usd
    void cwd;
  } catch {
    /* ignore mirror failures */
  }
}

export function beginCostRun(runId?: string): string {
  activeRunId = runId || `run-${Date.now().toString(36)}`;
  return activeRunId;
}

export function endCostRun(): void {
  activeRunId = null;
}

export function getActiveRunId(): string | null {
  return activeRunId;
}

export function dailySpentUsd(cwd: string): number {
  const ledger = loadCostLedger(cwd);
  return ledger.entries.reduce(
    (s, e) => s + (e.cloud ? e.costUsd || 0 : 0),
    0
  );
}

export function getCostCapUsd(cwd: string): number {
  const profile = loadHybridProfile(cwd);
  return Math.max(0, Number(profile.costCapUsd) || 0);
}

export function getCostBudget(cwd: string): CostBudgetSnapshot {
  const ledger = loadCostLedger(cwd);
  const capUsd = getCostCapUsd(cwd);
  // Only cloud entries count against the daily $ cap (local/free are $0 but still tracked).
  const spentUsd = ledger.entries.reduce(
    (s, e) => s + (e.cloud ? e.costUsd || 0 : 0),
    0
  );
  const remainingUsd = Math.max(0, capUsd - spentUsd);
  const runId = activeRunId;
  const runSpentUsd = runId && ledger.runs[runId] ? ledger.runs[runId].costUsd : 0;
  // Cap of $0 means no cloud spend allowed (spent 0 >= cap 0 → blocked)
  const blocked = spentUsd >= capUsd;
  return {
    day: ledger.day,
    capUsd,
    spentUsd: round4(spentUsd),
    remainingUsd: round4(remainingUsd),
    runId,
    runSpentUsd: round4(runSpentUsd),
    byModel: ledger.byModel,
    blocked,
    blockReason: blocked
      ? capUsd <= 0
        ? `Daily cost cap is $${capUsd} — cloud calls are blocked`
        : `Daily cost cap exceeded: spent $${round4(spentUsd)} / cap $${capUsd}`
      : null,
  };
}

/** Sum tokens for the active (or given) run — cloud + local. */
export function getRunTokenTotals(
  cwd: string,
  runId?: string | null
): { inputTokens: number; outputTokens: number; costUsd: number; cloudCalls: number } {
  const ledger = loadCostLedger(cwd);
  const id = runId || activeRunId;
  if (!id || !ledger.runs[id]) {
    return { inputTokens: 0, outputTokens: 0, costUsd: 0, cloudCalls: 0 };
  }
  return { ...ledger.runs[id] };
}

export function assertWithinCostCap(cwd: string, additionalUsd = 0): CostBudgetSnapshot {
  const budget = getCostBudget(cwd);
  const add = Math.max(0, additionalUsd);
  // Any positive cloud charge against a zero/exhausted cap must fail
  if (add > 0 && budget.spentUsd + add > budget.capUsd + 1e-9) {
    throw new CostCapExceededError(
      `Cost cap exceeded: this cloud call (~$${round4(add)}) would bring daily spend to $${round4(budget.spentUsd + add)} (cap $${budget.capUsd}). Switch hybrid mode to local, raise the cap, or wait until tomorrow.`,
      budget.spentUsd,
      budget.capUsd,
      "day"
    );
  }
  if (add === 0 && budget.blocked) {
    throw new CostCapExceededError(
      budget.blockReason || `Cost cap exceeded ($${budget.spentUsd} / $${budget.capUsd})`,
      budget.spentUsd,
      budget.capUsd,
      "day"
    );
  }
  return budget;
}

export function recordUsage(
  cwd: string,
  entry: {
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
    cloud?: boolean;
    runId?: string;
  }
): CostUsageEntry {
  const inputTokens = Math.max(0, Math.floor(entry.inputTokens || 0));
  const outputTokens = Math.max(0, Math.floor(entry.outputTokens || 0));
  const cloud = entry.cloud !== false;
  const costUsd =
    entry.costUsd != null
      ? Math.max(0, entry.costUsd)
      : estimateCostUsd({ model: entry.model, inputTokens, outputTokens });

  if (cloud && costUsd > 0) {
    assertWithinCostCap(cwd, costUsd);
  }

  const ledger = loadCostLedger(cwd);
  const runId = entry.runId || activeRunId || "adhoc";
  const row: CostUsageEntry = {
    at: new Date().toISOString(),
    runId,
    model: entry.model,
    inputTokens,
    outputTokens,
    costUsd: round4(costUsd),
    cloud,
  };
  ledger.entries.push(row);
  if (ledger.entries.length > 2000) {
    ledger.entries = ledger.entries.slice(-1500);
  }

  const bm = ledger.byModel[entry.model] || {
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    calls: 0,
  };
  bm.inputTokens += inputTokens;
  bm.outputTokens += outputTokens;
  bm.costUsd = round4(bm.costUsd + costUsd);
  bm.calls += 1;
  ledger.byModel[entry.model] = bm;

  const run = ledger.runs[runId] || {
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cloudCalls: 0,
  };
  run.costUsd = round4(run.costUsd + costUsd);
  run.inputTokens += inputTokens;
  run.outputTokens += outputTokens;
  if (cloud) run.cloudCalls += 1;
  ledger.runs[runId] = run;

  saveCostLedger(cwd, ledger);
  if (cloud && costUsd > 0) recordCost(costUsd);
  mirrorCostEntry(cwd, row);
  return row;
}

/**
 * Pre-flight for a cloud call: assert budget, then record estimated usage.
 * Call after a successful cloud invoke (or before if charging reservatively).
 */
export function chargeCloudCall(
  cwd: string,
  opts: { model: string; prompt?: string; output?: string; runId?: string }
): CostUsageEntry {
  const inputTokens = Math.max(200, Math.ceil(String(opts.prompt || "").length / 4));
  const outputTokens = Math.max(150, Math.ceil(String(opts.output || "").length / 4));
  const costUsd = estimateCostUsd({ model: opts.model, inputTokens, outputTokens });
  assertWithinCostCap(cwd, costUsd);
  return recordUsage(cwd, {
    model: opts.model,
    inputTokens,
    outputTokens,
    costUsd,
    cloud: true,
    runId: opts.runId,
  });
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Test helper */
export function __resetActiveRunForTests(): void {
  activeRunId = null;
}
