/**
 * Phase 6 — unified human-in-the-loop approval policy + audit trail.
 * Covers: destructive FS outside output home, email send, spend thresholds,
 * desktop actions on sensitive apps (extends Phase 4 desktop approvals).
 */
import { randomUUID } from "crypto";
import * as path from "path";
import { getDriver, getPersistence, runsRepo } from "../db/index.js";
import type { ApprovalRecord } from "../db/types.js";
import { getActiveTenantId } from "../tenant/context.js";
import { isAgentWorkspace } from "../paths.js";
import { getOutputHome } from "../outputHome.js";
import { getEffectiveTrustPolicy } from "./config.js";
import { appendAudit } from "./auditLog.js";

export type TrustApprovalKind =
  | "destructive_fs"
  | "email_send"
  | "spend"
  | "network_egress"
  | "desktop_sensitive"
  | "desktop:destructive"
  | "desktop:financial"
  | "desktop:sending"
  | string;

export type ApprovalDecision = {
  ok: boolean;
  approvalId?: string;
  message?: string;
  record?: ApprovalRecord;
  required: boolean;
};

function envAutoApprove(flag: string): boolean {
  return String(process.env[flag] || "").trim() === "1";
}

function findApproval(id: string): ApprovalRecord | undefined {
  try {
    getPersistence();
    return runsRepo
      .listApprovals(getDriver(), getActiveTenantId())
      .find((r) => r.id === id);
  } catch {
    return undefined;
  }
}

function upsert(
  input: Omit<ApprovalRecord, "tenantId" | "createdAt"> & {
    tenantId?: string;
    createdAt?: string;
  }
): ApprovalRecord {
  getPersistence();
  const record: ApprovalRecord = {
    id: input.id,
    tenantId: input.tenantId || getActiveTenantId(),
    kind: input.kind,
    subject: input.subject,
    status: input.status,
    createdAt: input.createdAt || new Date().toISOString(),
    decidedAt: input.decidedAt,
    meta: input.meta || {},
  };
  const saved = runsRepo.upsertApproval(getDriver(), record);
  appendAudit({
    category: "approval",
    action:
      record.status === "pending"
        ? "approval_requested"
        : record.status === "approved"
          ? "approval_granted"
          : "approval_denied",
    runId:
      typeof record.meta?.runId === "string" ? (record.meta.runId as string) : null,
    actor: "owner",
    detail: {
      approvalId: record.id,
      kind: record.kind,
      subject: record.subject,
      status: record.status,
    },
    tenantId: record.tenantId,
  });
  return saved;
}

function resolveWithFlags(input: {
  kind: TrustApprovalKind;
  subject: string;
  approved?: boolean | string;
  autoEnvFlags: string[];
  runId?: string;
  meta?: Record<string, unknown>;
}): ApprovalDecision {
  // Already approved via boolean / prior id
  if (input.approved === true) {
    const record = upsert({
      id: randomUUID(),
      kind: input.kind,
      subject: input.subject,
      status: "approved",
      decidedAt: new Date().toISOString(),
      meta: { ...(input.meta || {}), runId: input.runId, via: "inline" },
    });
    return { ok: true, required: true, approvalId: record.id, record };
  }

  if (typeof input.approved === "string" && input.approved.trim()) {
    const existing = findApproval(input.approved.trim());
    if (existing?.status === "approved") {
      return { ok: true, required: true, approvalId: existing.id, record: existing };
    }
    if (existing?.status === "rejected") {
      return {
        ok: false,
        required: true,
        approvalId: existing.id,
        record: existing,
        message: `Rejected by owner (approval ${existing.id})`,
      };
    }
  }

  for (const flag of input.autoEnvFlags) {
    if (envAutoApprove(flag)) {
      const record = upsert({
        id: randomUUID(),
        kind: input.kind,
        subject: input.subject,
        status: "approved",
        decidedAt: new Date().toISOString(),
        meta: { ...(input.meta || {}), runId: input.runId, via: flag },
      });
      return { ok: true, required: true, approvalId: record.id, record };
    }
  }

  const pending = upsert({
    id:
      typeof input.approved === "string" && input.approved.trim()
        ? input.approved.trim()
        : randomUUID(),
    kind: input.kind,
    subject: input.subject,
    status: "pending",
    meta: { ...(input.meta || {}), runId: input.runId },
  });
  return {
    ok: false,
    required: true,
    approvalId: pending.id,
    record: pending,
    message: `Approval required for ${input.kind}: ${input.subject}. Approve via Control Plane / CLI or set ${input.autoEnvFlags[0] || "APPROVE_*"}=1.`,
  };
}

/** True when abs path is outside agent workspace (cwd + SAM_OUTPUT_HOME). */
export function isOutsideAgentHome(
  absPath: string,
  cwd: string = process.cwd()
): boolean {
  return !isAgentWorkspace(absPath, cwd);
}

/**
 * Destructive file ops (delete / move unlink) outside output home require approval.
 */
export function requireDestructiveFsApproval(input: {
  tool: string;
  path: string;
  approved?: boolean | string;
  runId?: string;
  cwd?: string;
}): ApprovalDecision {
  const policy = getEffectiveTrustPolicy(input.cwd);
  const abs = path.normalize(input.path);
  const outside = isOutsideAgentHome(abs, input.cwd || process.cwd());

  if (!policy.requireApprovalDestructiveOutsideHome || !outside) {
    return { ok: true, required: false };
  }

  return resolveWithFlags({
    kind: "destructive_fs",
    subject: `${input.tool}:${abs}`,
    approved: input.approved,
    autoEnvFlags: ["APPROVE_DESTRUCTIVE", "APPROVE_TRUST"],
    runId: input.runId,
    meta: { tool: input.tool, path: abs, outputHome: getOutputHome() },
  });
}

/** Email send via SMTP/Resend — always HITL when policy says so. */
export function requireEmailSendApproval(input: {
  draftId: string;
  to?: string;
  subject: string;
  approved?: boolean | string;
  runId?: string;
}): ApprovalDecision {
  const policy = getEffectiveTrustPolicy();
  if (!policy.requireApprovalEmailSend) {
    return { ok: true, required: false };
  }
  return resolveWithFlags({
    kind: "email_send",
    subject: `email:${input.draftId}:${input.to || ""}:${input.subject.slice(0, 80)}`,
    approved: input.approved,
    autoEnvFlags: ["APPROVE_COMMS", "APPROVE_TRUST"],
    runId: input.runId,
    meta: { draftId: input.draftId, to: input.to, subject: input.subject },
  });
}

/**
 * Outbound HTTP for quick-path web research.
 * Blocked entirely when allowNetworkEgress=false; optional HITL when
 * requireApprovalNetworkEgress=true.
 */
export function requireNetworkEgressApproval(input: {
  purpose: string;
  approved?: boolean | string;
  runId?: string;
}): ApprovalDecision {
  const policy = getEffectiveTrustPolicy();
  if (policy.allowNetworkEgress === false) {
    return {
      ok: false,
      required: true,
      message: "Network egress disabled by trust policy (SAM_ALLOW_NETWORK_EGRESS=0)",
    };
  }
  if (!policy.requireApprovalNetworkEgress) {
    return { ok: true, required: false };
  }
  return resolveWithFlags({
    kind: "network_egress",
    subject: `network:${input.purpose.slice(0, 120)}`,
    approved: input.approved,
    autoEnvFlags: ["APPROVE_NETWORK", "APPROVE_TRUST"],
    runId: input.runId,
    meta: { purpose: input.purpose },
  });
}

/**
 * Cloud spend above threshold needs approval (in addition to hard cost cap).
 * Call before recording a charge that exceeds spendApprovalThresholdUsd.
 */
export function requireSpendApproval(input: {
  amountUsd: number;
  model?: string;
  approved?: boolean | string;
  runId?: string;
}): ApprovalDecision {
  const policy = getEffectiveTrustPolicy();
  const amount = Math.max(0, input.amountUsd);
  if (amount <= policy.spendApprovalThresholdUsd + 1e-9) {
    return { ok: true, required: false };
  }
  return resolveWithFlags({
    kind: "spend",
    subject: `spend:$${amount.toFixed(4)}:${input.model || "model"}`,
    approved: input.approved,
    autoEnvFlags: ["APPROVE_SPEND", "APPROVE_TRUST"],
    runId: input.runId,
    meta: {
      amountUsd: amount,
      thresholdUsd: policy.spendApprovalThresholdUsd,
      model: input.model,
    },
  });
}

/** Desktop action targeting a sensitive app (from policy list). */
export function isSensitiveDesktopTarget(
  blob: string,
  apps: string[] = getEffectiveTrustPolicy().sensitiveDesktopApps
): boolean {
  const lower = blob.toLowerCase();
  return apps.some((a) => a && lower.includes(a.toLowerCase()));
}

export function requireDesktopSensitiveApproval(input: {
  action: string;
  params: Record<string, unknown>;
  approved?: boolean | string;
  runId?: string;
}): ApprovalDecision {
  const blob = `${input.action} ${JSON.stringify(input.params || {})}`;
  if (!isSensitiveDesktopTarget(blob)) {
    return { ok: true, required: false };
  }
  return resolveWithFlags({
    kind: "desktop_sensitive",
    subject: `${input.action}:${blob.slice(0, 160)}`,
    approved: input.approved,
    autoEnvFlags: ["APPROVE_DESKTOP", "APPROVE_TRUST"],
    runId: input.runId,
    meta: { action: input.action, params: input.params },
  });
}

export function listPendingApprovals(
  tenantId: string = getActiveTenantId()
): ApprovalRecord[] {
  getPersistence();
  return runsRepo.listApprovals(getDriver(), tenantId, "pending");
}

export function listAllApprovals(
  tenantId: string = getActiveTenantId(),
  status?: ApprovalRecord["status"]
): ApprovalRecord[] {
  getPersistence();
  return runsRepo.listApprovals(getDriver(), tenantId, status);
}

export function decideApproval(
  approvalId: string,
  approve: boolean,
  actor: string = "owner"
): ApprovalRecord | null {
  getPersistence();
  const existing = findApproval(approvalId);
  if (!existing) return null;
  const updated: ApprovalRecord = {
    ...existing,
    status: approve ? "approved" : "rejected",
    decidedAt: new Date().toISOString(),
    meta: { ...(existing.meta || {}), decidedBy: actor },
  };
  const saved = runsRepo.upsertApproval(getDriver(), updated);
  appendAudit({
    category: "approval",
    action: approve ? "approval_granted" : "approval_denied",
    runId:
      typeof updated.meta?.runId === "string" ? (updated.meta.runId as string) : null,
    actor,
    detail: {
      approvalId: saved.id,
      kind: saved.kind,
      subject: saved.subject,
      status: saved.status,
    },
    tenantId: saved.tenantId,
  });
  return saved;
}
