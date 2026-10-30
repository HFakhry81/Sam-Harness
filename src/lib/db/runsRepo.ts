import * as crypto from "crypto";
import type { ApprovalRecord, RunEvent, RunRecord, RunStatus, SqlDriver } from "./types.js";

function mapRun(row: Record<string, unknown>): RunRecord {
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(String(row.meta || "{}"));
  } catch {
    meta = {};
  }
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    threadId: String(row.thread_id),
    mode: String(row.mode),
    status: String(row.status) as RunStatus,
    phase: String(row.phase || "idle"),
    checkpointStep: row.checkpoint_step != null ? String(row.checkpoint_step) : null,
    attempt: Number(row.attempt || 0),
    cancelRequested: Boolean(Number(row.cancel_requested || 0)),
    startedAt: String(row.started_at),
    endedAt: row.ended_at != null ? String(row.ended_at) : null,
    exitCode: row.exit_code == null ? null : Number(row.exit_code),
    idempotencyKey: row.idempotency_key != null ? String(row.idempotency_key) : null,
    meta,
  };
}

export function createRun(
  driver: SqlDriver,
  input: {
    tenantId: string;
    mode: string;
    threadId?: string;
    idempotencyKey?: string | null;
    meta?: Record<string, unknown>;
  }
): RunRecord {
  if (input.idempotencyKey) {
    const existing = driver
      .prepare(
        "SELECT * FROM runs WHERE tenant_id = ? AND idempotency_key = ? LIMIT 1"
      )
      .get(input.tenantId, input.idempotencyKey);
    if (existing) return mapRun(existing);
  }

  const id = `run-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
  const threadId = input.threadId || id;
  const startedAt = new Date().toISOString();
  driver
    .prepare(
      `INSERT INTO runs (
        id, tenant_id, thread_id, mode, status, phase, checkpoint_step,
        attempt, cancel_requested, started_at, ended_at, exit_code,
        idempotency_key, meta
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.tenantId,
      threadId,
      input.mode,
      "running",
      "start",
      null,
      0,
      0,
      startedAt,
      null,
      null,
      input.idempotencyKey || null,
      JSON.stringify(input.meta || {})
    );
  return getRun(driver, input.tenantId, id)!;
}

export function getRun(
  driver: SqlDriver,
  tenantId: string,
  runId: string
): RunRecord | null {
  const row = driver
    .prepare("SELECT * FROM runs WHERE tenant_id = ? AND id = ?")
    .get(tenantId, runId);
  return row ? mapRun(row) : null;
}

export function getRunByThread(
  driver: SqlDriver,
  tenantId: string,
  threadId: string
): RunRecord | null {
  const row = driver
    .prepare(
      "SELECT * FROM runs WHERE tenant_id = ? AND thread_id = ? ORDER BY started_at DESC LIMIT 1"
    )
    .get(tenantId, threadId);
  return row ? mapRun(row) : null;
}

export function updateRun(
  driver: SqlDriver,
  tenantId: string,
  runId: string,
  patch: Partial<{
    status: RunStatus;
    phase: string;
    checkpointStep: string | null;
    attempt: number;
    cancelRequested: boolean;
    endedAt: string | null;
    exitCode: number | null;
    meta: Record<string, unknown>;
  }>
): RunRecord | null {
  const cur = getRun(driver, tenantId, runId);
  if (!cur) return null;
  const next: RunRecord = {
    ...cur,
    status: patch.status ?? cur.status,
    phase: patch.phase ?? cur.phase,
    checkpointStep:
      patch.checkpointStep !== undefined ? patch.checkpointStep : cur.checkpointStep,
    attempt: patch.attempt ?? cur.attempt,
    cancelRequested:
      patch.cancelRequested !== undefined ? patch.cancelRequested : cur.cancelRequested,
    endedAt: patch.endedAt !== undefined ? patch.endedAt : cur.endedAt,
    exitCode: patch.exitCode !== undefined ? patch.exitCode : cur.exitCode,
    meta: patch.meta ?? cur.meta,
  };
  driver
    .prepare(
      `UPDATE runs SET
        status = ?, phase = ?, checkpoint_step = ?, attempt = ?,
        cancel_requested = ?, ended_at = ?, exit_code = ?, meta = ?
       WHERE tenant_id = ? AND id = ?`
    )
    .run(
      next.status,
      next.phase,
      next.checkpointStep,
      next.attempt,
      next.cancelRequested ? 1 : 0,
      next.endedAt,
      next.exitCode,
      JSON.stringify(next.meta),
      tenantId,
      runId
    );
  return next;
}

export function requestCancel(
  driver: SqlDriver,
  tenantId: string,
  runId: string
): RunRecord | null {
  return updateRun(driver, tenantId, runId, {
    cancelRequested: true,
    status: "cancelled",
    phase: "cancelled",
    endedAt: new Date().toISOString(),
  });
}

export function listRuns(
  driver: SqlDriver,
  tenantId: string,
  opts: { limit?: number; status?: RunStatus } = {}
): RunRecord[] {
  const limit = Math.min(200, Math.max(1, opts.limit || 50));
  if (opts.status) {
    return driver
      .prepare(
        "SELECT * FROM runs WHERE tenant_id = ? AND status = ? ORDER BY started_at DESC LIMIT ?"
      )
      .all(tenantId, opts.status, limit)
      .map(mapRun);
  }
  return driver
    .prepare("SELECT * FROM runs WHERE tenant_id = ? ORDER BY started_at DESC LIMIT ?")
    .all(tenantId, limit)
    .map(mapRun);
}

export function appendRunEvent(
  driver: SqlDriver,
  event: Omit<RunEvent, "id"> & { id?: string }
): RunEvent {
  const id = event.id || `evt-${Date.now().toString(36)}-${crypto.randomBytes(2).toString("hex")}`;
  const row: RunEvent = {
    id,
    runId: event.runId,
    tenantId: event.tenantId,
    at: event.at || new Date().toISOString(),
    kind: event.kind,
    name: event.name,
    status: event.status,
    durationMs: event.durationMs,
    costUsd: event.costUsd,
    detail: event.detail || {},
  };
  driver
    .prepare(
      `INSERT INTO run_events (
        id, run_id, tenant_id, at, kind, name, status, duration_ms, cost_usd, detail
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.id,
      row.runId,
      row.tenantId,
      row.at,
      row.kind,
      row.name,
      row.status,
      row.durationMs ?? null,
      row.costUsd ?? null,
      JSON.stringify(row.detail || {})
    );
  return row;
}

export function listRunEvents(
  driver: SqlDriver,
  tenantId: string,
  runId: string
): RunEvent[] {
  return driver
    .prepare(
      "SELECT * FROM run_events WHERE tenant_id = ? AND run_id = ? ORDER BY at ASC"
    )
    .all(tenantId, runId)
    .map((r) => {
      let detail: Record<string, unknown> = {};
      try {
        detail = JSON.parse(String(r.detail || "{}"));
      } catch {
        detail = {};
      }
      return {
        id: String(r.id),
        runId: String(r.run_id),
        tenantId: String(r.tenant_id),
        at: String(r.at),
        kind: String(r.kind),
        name: String(r.name),
        status: String(r.status) as RunEvent["status"],
        durationMs: r.duration_ms != null ? Number(r.duration_ms) : undefined,
        costUsd: r.cost_usd != null ? Number(r.cost_usd) : undefined,
        detail,
      };
    });
}

export function upsertApproval(
  driver: SqlDriver,
  input: ApprovalRecord
): ApprovalRecord {
  driver
    .prepare(
      `INSERT INTO approvals (id, tenant_id, kind, subject, status, created_at, decided_at, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         decided_at = excluded.decided_at,
         meta = excluded.meta`
    )
    .run(
      input.id,
      input.tenantId,
      input.kind,
      input.subject,
      input.status,
      input.createdAt,
      input.decidedAt || null,
      JSON.stringify(input.meta || {})
    );
  return input;
}

export function listApprovals(
  driver: SqlDriver,
  tenantId: string,
  status?: ApprovalRecord["status"]
): ApprovalRecord[] {
  const rows = status
    ? driver
        .prepare(
          "SELECT * FROM approvals WHERE tenant_id = ? AND status = ? ORDER BY created_at DESC"
        )
        .all(tenantId, status)
    : driver
        .prepare("SELECT * FROM approvals WHERE tenant_id = ? ORDER BY created_at DESC")
        .all(tenantId);
  return rows.map((r) => {
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(String(r.meta || "{}"));
    } catch {
      meta = {};
    }
    return {
      id: String(r.id),
      tenantId: String(r.tenant_id),
      kind: String(r.kind),
      subject: String(r.subject),
      status: String(r.status) as ApprovalRecord["status"],
      createdAt: String(r.created_at),
      decidedAt: r.decided_at != null ? String(r.decided_at) : undefined,
      meta,
    };
  });
}
