/**
 * In-process metrics for cost / latency / errors (exported via /healthz + /api/metrics).
 */
export type MetricsSnapshot = {
  startedAt: string;
  uptimeSec: number;
  runsTotal: number;
  runsFailed: number;
  runsCancelled: number;
  toolCalls: number;
  llmCalls: number;
  errors: number;
  costUsdTotal: number;
  latencyMs: {
    count: number;
    sum: number;
    avg: number;
    max: number;
  };
};

const startedAt = new Date().toISOString();
const startedMs = Date.now();

const state = {
  runsTotal: 0,
  runsFailed: 0,
  runsCancelled: 0,
  toolCalls: 0,
  llmCalls: 0,
  errors: 0,
  costUsdTotal: 0,
  latencyCount: 0,
  latencySum: 0,
  latencyMax: 0,
};

export function recordRunStart(): void {
  state.runsTotal += 1;
}

export function recordRunEnd(opts: {
  ok: boolean;
  cancelled?: boolean;
  durationMs?: number;
}): void {
  if (opts.cancelled) state.runsCancelled += 1;
  else if (!opts.ok) state.runsFailed += 1;
  if (opts.durationMs != null) recordLatency(opts.durationMs);
}

export function recordToolCall(durationMs?: number): void {
  state.toolCalls += 1;
  if (durationMs != null) recordLatency(durationMs);
}

export function recordLlmCall(opts?: { durationMs?: number; costUsd?: number }): void {
  state.llmCalls += 1;
  if (opts?.costUsd) state.costUsdTotal += opts.costUsd;
  if (opts?.durationMs != null) recordLatency(opts.durationMs);
}

export function recordError(): void {
  state.errors += 1;
}

export function recordCost(usd: number): void {
  state.costUsdTotal += Math.max(0, usd);
}

export function recordLatency(ms: number): void {
  const n = Math.max(0, ms);
  state.latencyCount += 1;
  state.latencySum += n;
  if (n > state.latencyMax) state.latencyMax = n;
}

export function getMetrics(): MetricsSnapshot {
  const count = state.latencyCount;
  return {
    startedAt,
    uptimeSec: Math.round((Date.now() - startedMs) / 1000),
    runsTotal: state.runsTotal,
    runsFailed: state.runsFailed,
    runsCancelled: state.runsCancelled,
    toolCalls: state.toolCalls,
    llmCalls: state.llmCalls,
    errors: state.errors,
    costUsdTotal: Math.round(state.costUsdTotal * 10000) / 10000,
    latencyMs: {
      count,
      sum: Math.round(state.latencySum),
      avg: count ? Math.round(state.latencySum / count) : 0,
      max: Math.round(state.latencyMax),
    },
  };
}

export function __resetMetricsForTests(): void {
  state.runsTotal = 0;
  state.runsFailed = 0;
  state.runsCancelled = 0;
  state.toolCalls = 0;
  state.llmCalls = 0;
  state.errors = 0;
  state.costUsdTotal = 0;
  state.latencyCount = 0;
  state.latencySum = 0;
  state.latencyMax = 0;
}
