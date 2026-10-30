/**
 * Phase 6 — tamper-evident hash-chained audit log (SQLite).
 * Each entry.hash = SHA-256(seq|at|category|action|runId|actor|canonicalDetail|prevHash).
 */
import * as crypto from "crypto";
import { getDriver, getPersistence } from "../db/index.js";
import type { SqlDriver } from "../db/types.js";
import { getActiveTenantId } from "../tenant/context.js";
import { getEffectiveTrustPolicy } from "./config.js";

export type AuditCategory =
  | "action"
  | "gate"
  | "approval"
  | "cost"
  | "system"
  | "evidence";

export type AuditEntry = {
  id: string;
  tenantId: string;
  seq: number;
  at: string;
  category: AuditCategory;
  action: string;
  runId: string | null;
  actor: string;
  detail: Record<string, unknown>;
  prevHash: string;
  entryHash: string;
};

export const GENESIS_HASH = "0".repeat(64);

/** Stable JSON for hashing (sorted keys, no whitespace variance). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) {
    out[k] = sortKeys(obj[k]);
  }
  return out;
}

export function computeEntryHash(input: {
  seq: number;
  at: string;
  category: string;
  action: string;
  runId: string | null;
  actor: string;
  detail: Record<string, unknown>;
  prevHash: string;
}): string {
  const payload = [
    String(input.seq),
    input.at,
    input.category,
    input.action,
    input.runId ?? "",
    input.actor,
    canonicalJson(input.detail || {}),
    input.prevHash,
  ].join("|");
  return crypto.createHash("sha256").update(payload, "utf8").digest("hex");
}

function mapRow(row: Record<string, unknown>): AuditEntry {
  let detail: Record<string, unknown> = {};
  try {
    detail = JSON.parse(String(row.detail || "{}"));
  } catch {
    detail = {};
  }
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    seq: Number(row.seq),
    at: String(row.at),
    category: String(row.category) as AuditCategory,
    action: String(row.action),
    runId: row.run_id != null ? String(row.run_id) : null,
    actor: String(row.actor || "system"),
    detail,
    prevHash: String(row.prev_hash),
    entryHash: String(row.entry_hash),
  };
}

function lastEntry(
  driver: SqlDriver,
  tenantId: string
): AuditEntry | null {
  const row = driver
    .prepare(
      "SELECT * FROM audit_log WHERE tenant_id = ? ORDER BY seq DESC LIMIT 1"
    )
    .get(tenantId);
  return row ? mapRow(row) : null;
}

export function appendAudit(
  input: {
    category: AuditCategory;
    action: string;
    runId?: string | null;
    actor?: string;
    detail?: Record<string, unknown>;
    tenantId?: string;
    at?: string;
  },
  driver: SqlDriver = getDriver()
): AuditEntry | null {
  const policy = getEffectiveTrustPolicy();
  if (!policy.auditEnabled) return null;

  getPersistence();
  const tenantId = input.tenantId || getActiveTenantId();
  const at = input.at || new Date().toISOString();
  const detail = input.detail || {};
  const actor = input.actor || "system";
  const runId = input.runId ?? null;

  return driver.transaction(() => {
    const prev = lastEntry(driver, tenantId);
    const seq = prev ? prev.seq + 1 : 1;
    const prevHash = prev ? prev.entryHash : GENESIS_HASH;
    const entryHash = computeEntryHash({
      seq,
      at,
      category: input.category,
      action: input.action,
      runId,
      actor,
      detail,
      prevHash,
    });
    const id = `aud-${seq.toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
    driver
      .prepare(
        `INSERT INTO audit_log (
          id, tenant_id, seq, at, category, action, run_id, actor, detail, prev_hash, entry_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        tenantId,
        seq,
        at,
        input.category,
        input.action,
        runId,
        actor,
        JSON.stringify(detail),
        prevHash,
        entryHash
      );
    return {
      id,
      tenantId,
      seq,
      at,
      category: input.category,
      action: input.action,
      runId,
      actor,
      detail,
      prevHash,
      entryHash,
    };
  });
}

export function listAudit(
  opts: {
    tenantId?: string;
    runId?: string;
    category?: AuditCategory;
    limit?: number;
  } = {},
  driver: SqlDriver = getDriver()
): AuditEntry[] {
  getPersistence();
  const tenantId = opts.tenantId || getActiveTenantId();
  const limit = Math.min(500, Math.max(1, opts.limit || 100));
  let rows: Record<string, unknown>[];
  if (opts.runId && opts.category) {
    rows = driver
      .prepare(
        `SELECT * FROM audit_log WHERE tenant_id = ? AND run_id = ? AND category = ?
         ORDER BY seq ASC LIMIT ?`
      )
      .all(tenantId, opts.runId, opts.category, limit);
  } else if (opts.runId) {
    rows = driver
      .prepare(
        `SELECT * FROM audit_log WHERE tenant_id = ? AND run_id = ?
         ORDER BY seq ASC LIMIT ?`
      )
      .all(tenantId, opts.runId, limit);
  } else if (opts.category) {
    rows = driver
      .prepare(
        `SELECT * FROM audit_log WHERE tenant_id = ? AND category = ?
         ORDER BY seq DESC LIMIT ?`
      )
      .all(tenantId, opts.category, limit);
  } else {
    rows = driver
      .prepare(
        `SELECT * FROM audit_log WHERE tenant_id = ? ORDER BY seq DESC LIMIT ?`
      )
      .all(tenantId, limit);
  }
  return rows.map(mapRow);
}

export type AuditVerifyResult = {
  ok: boolean;
  checked: number;
  brokenAtSeq: number | null;
  reason: string | null;
  headHash: string | null;
  tenantId: string;
};

/** Verify hash chain integrity for a tenant. */
export function verifyAuditChain(
  opts: { tenantId?: string; limit?: number } = {},
  driver: SqlDriver = getDriver()
): AuditVerifyResult {
  getPersistence();
  const tenantId = opts.tenantId || getActiveTenantId();
  const limit = opts.limit && opts.limit > 0 ? opts.limit : 100_000;
  const rows = driver
    .prepare(
      `SELECT * FROM audit_log WHERE tenant_id = ? ORDER BY seq ASC LIMIT ?`
    )
    .all(tenantId, limit)
    .map(mapRow);

  if (!rows.length) {
    return {
      ok: true,
      checked: 0,
      brokenAtSeq: null,
      reason: null,
      headHash: null,
      tenantId,
    };
  }

  let expectedPrev = GENESIS_HASH;
  let expectedSeq = 1;
  for (const row of rows) {
    if (row.seq !== expectedSeq) {
      return {
        ok: false,
        checked: expectedSeq - 1,
        brokenAtSeq: row.seq,
        reason: `Sequence gap: expected ${expectedSeq}, got ${row.seq}`,
        headHash: rows[expectedSeq - 2]?.entryHash ?? null,
        tenantId,
      };
    }
    if (row.prevHash !== expectedPrev) {
      return {
        ok: false,
        checked: expectedSeq - 1,
        brokenAtSeq: row.seq,
        reason: `prev_hash mismatch at seq ${row.seq}`,
        headHash: expectedPrev,
        tenantId,
      };
    }
    const recomputed = computeEntryHash({
      seq: row.seq,
      at: row.at,
      category: row.category,
      action: row.action,
      runId: row.runId,
      actor: row.actor,
      detail: row.detail,
      prevHash: row.prevHash,
    });
    if (recomputed !== row.entryHash) {
      return {
        ok: false,
        checked: expectedSeq - 1,
        brokenAtSeq: row.seq,
        reason: `entry_hash mismatch at seq ${row.seq}`,
        headHash: expectedPrev,
        tenantId,
      };
    }
    expectedPrev = row.entryHash;
    expectedSeq += 1;
  }

  return {
    ok: true,
    checked: rows.length,
    brokenAtSeq: null,
    reason: null,
    headHash: rows[rows.length - 1].entryHash,
    tenantId,
  };
}
