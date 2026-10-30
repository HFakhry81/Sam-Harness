/**
 * Durable, resumable run records — checkpoint step, cancel, retry metadata.
 */
import { getDriver, getPersistence, runsRepo } from "./db/index.js";
import type { RunEvent, RunRecord, RunStatus } from "./db/types.js";
import { getActiveTenantId } from "./tenant/context.js";
import {
  recordRunEnd,
  recordRunStart,
  boundLogger,
} from "./observability/index.js";
import { withRetry } from "./retry.js";

const log = boundLogger("runs");

export function startDurableRun(input: {
  mode: string;
  runId?: string;
  threadId?: string;
  idempotencyKey?: string;
  meta?: Record<string, unknown>;
  tenantId?: string;
}): RunRecord {
  const tenantId = input.tenantId || getActiveTenantId();
  const driver = getDriver();
  const run = runsRepo.createRun(driver, {
    tenantId,
    mode: input.mode,
    threadId: input.threadId || input.runId,
    idempotencyKey: input.idempotencyKey,
    meta: { ...(input.meta || {}), requestedRunId: input.runId },
  });
  // If caller supplied runId, prefer aligning when new
  recordRunStart();
  appendTimeline(run.id, {
    kind: "run",
    name: "start",
    status: "start",
    detail: { mode: input.mode },
  });
  log.info({ runId: run.id, mode: input.mode }, "durable run started");
  return run;
}

export function checkpointRun(
  runId: string,
  step: string,
  detail?: Record<string, unknown>,
  tenantId: string = getActiveTenantId()
): RunRecord | null {
  const driver = getDriver();
  const updated = runsRepo.updateRun(driver, tenantId, runId, {
    status: "checkpointed",
    phase: step,
    checkpointStep: step,
    meta: {
      ...(runsRepo.getRun(driver, tenantId, runId)?.meta || {}),
      lastCheckpointAt: new Date().toISOString(),
      ...(detail || {}),
    },
  });
  if (updated) {
    appendTimeline(runId, {
      kind: "checkpoint",
      name: step,
      status: "ok",
      detail,
      tenantId,
    });
  }
  return updated;
}

export function finishDurableRun(
  runId: string,
  opts: {
    ok: boolean;
    exitCode?: number | null;
    cancelled?: boolean;
    durationMs?: number;
    tenantId?: string;
  }
): RunRecord | null {
  const tenantId = opts.tenantId || getActiveTenantId();
  const status: RunStatus = opts.cancelled
    ? "cancelled"
    : opts.ok
      ? "completed"
      : "failed";
  const updated = runsRepo.updateRun(getDriver(), tenantId, runId, {
    status,
    phase: status,
    endedAt: new Date().toISOString(),
    exitCode: opts.exitCode ?? (opts.ok ? 0 : 1),
  });
  recordRunEnd({
    ok: Boolean(opts.ok),
    cancelled: opts.cancelled,
    durationMs: opts.durationMs,
  });
  appendTimeline(runId, {
    kind: "run",
    name: status,
    status: opts.ok ? "end" : "error",
    durationMs: opts.durationMs,
    tenantId,
  });
  return updated;
}

export function cancelDurableRun(
  runId: string,
  tenantId: string = getActiveTenantId()
): RunRecord | null {
  const updated = runsRepo.requestCancel(getDriver(), tenantId, runId);
  if (updated) {
    appendTimeline(runId, {
      kind: "run",
      name: "cancel",
      status: "error",
      tenantId,
    });
  }
  return updated;
}

export function isRunCancelRequested(
  runId: string,
  tenantId: string = getActiveTenantId()
): boolean {
  const run = runsRepo.getRun(getDriver(), tenantId, runId);
  return Boolean(run?.cancelRequested);
}

export function getDurableRun(
  runId: string,
  tenantId: string = getActiveTenantId()
): RunRecord | null {
  return runsRepo.getRun(getDriver(), tenantId, runId);
}

export function listDurableRuns(
  opts: { limit?: number; status?: RunStatus; tenantId?: string } = {}
): RunRecord[] {
  return runsRepo.listRuns(getDriver(), opts.tenantId || getActiveTenantId(), opts);
}

export function appendTimeline(
  runId: string,
  event: {
    kind: string;
    name: string;
    status: RunEvent["status"];
    durationMs?: number;
    costUsd?: number;
    detail?: Record<string, unknown>;
    tenantId?: string;
  }
): RunEvent {
  getPersistence();
  return runsRepo.appendRunEvent(getDriver(), {
    runId,
    tenantId: event.tenantId || getActiveTenantId(),
    at: new Date().toISOString(),
    kind: event.kind,
    name: event.name,
    status: event.status,
    durationMs: event.durationMs,
    costUsd: event.costUsd,
    detail: event.detail,
  });
}

export function getRunTimeline(
  runId: string,
  tenantId: string = getActiveTenantId()
): RunEvent[] {
  return runsRepo.listRunEvents(getDriver(), tenantId, runId);
}

/** Resume a checkpointed / interrupted run — bumps attempt, clears cancel. */
export function resumeDurableRun(
  runId: string,
  tenantId: string = getActiveTenantId()
): RunRecord | null {
  const cur = runsRepo.getRun(getDriver(), tenantId, runId);
  if (!cur) return null;
  if (cur.status === "completed") {
    throw new Error(`Run ${runId} already completed`);
  }
  const updated = runsRepo.updateRun(getDriver(), tenantId, runId, {
    status: "running",
    phase: cur.checkpointStep || "resume",
    attempt: cur.attempt + 1,
    cancelRequested: false,
    endedAt: null,
  });
  appendTimeline(runId, {
    kind: "run",
    name: "resume",
    status: "start",
    detail: { attempt: (cur.attempt || 0) + 1, from: cur.checkpointStep },
    tenantId,
  });
  return updated;
}

/** Retry helper wrapping withRetry + cancel checks. */
export async function runStepWithRetry<T>(
  runId: string,
  step: string,
  fn: () => Promise<T>,
  opts?: { attempts?: number; tenantId?: string }
): Promise<T> {
  const tenantId = opts?.tenantId || getActiveTenantId();
  const started = Date.now();
  appendTimeline(runId, { kind: "step", name: step, status: "start", tenantId });
  try {
    const result = await withRetry(() => fn(), {
      attempts: opts?.attempts ?? 3,
      isCancelled: () => isRunCancelRequested(runId, tenantId),
      onRetry: (err, attempt, delayMs) => {
        appendTimeline(runId, {
          kind: "retry",
          name: step,
          status: "info",
          detail: { attempt, delayMs, error: String((err as Error)?.message || err) },
          tenantId,
        });
      },
    });
    checkpointRun(runId, step, undefined, tenantId);
    appendTimeline(runId, {
      kind: "step",
      name: step,
      status: "ok",
      durationMs: Date.now() - started,
      tenantId,
    });
    return result;
  } catch (e) {
    appendTimeline(runId, {
      kind: "step",
      name: step,
      status: "error",
      durationMs: Date.now() - started,
      detail: { error: String((e as Error)?.message || e) },
      tenantId,
    });
    throw e;
  }
}
