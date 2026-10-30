/**
 * Per-action risk + approval matrix for desktop operator.
 * Destructive / financial / sending require human approval (approvals table or env).
 */
import { randomUUID } from "crypto";
import { getDriver, getPersistence } from "../../lib/db/index.js";
import { runsRepo } from "../../lib/db/index.js";
import type { ApprovalRecord } from "../../lib/db/types.js";
import { getActiveTenantId } from "../../lib/tenant/context.js";
import type {
  DesktopActionName,
  DesktopActionRisk,
  DesktopActionRequest,
} from "./types.js";

const READ_ACTIONS = new Set<DesktopActionName>([
  "list_windows",
  "uia_tree",
  "uia_find",
  "clipboard_get",
  "screenshot",
  "verify",
]);

const DESTRUCTIVE_ACTIONS = new Set<DesktopActionName>([
  "close_window",
  "ffmpeg", // can overwrite/delete media outputs
]);

/** Apps / phrases that imply financial or sending risk when launching or typing. */
const FINANCIAL_HINT =
  /paypal|stripe|bank|iban|swift|wire\s*transfer|bitcoin|crypto\s*wallet|stock\s*trade|broker/i;
const SENDING_HINT =
  /outlook|mail\.|smtp|whatsapp|telegram|slack|teams|send\s*email|compose/i;
const DESTRUCTIVE_HINT =
  /format\s|rm\s+-rf|del\s+\/[sq]|shutdown|taskkill|reg\s+delete|diskpart/i;

export function classifyDesktopRisk(
  action: DesktopActionName,
  params: Record<string, unknown> = {}
): DesktopActionRisk {
  if (READ_ACTIONS.has(action)) return "read";

  const blob = JSON.stringify(params);
  if (FINANCIAL_HINT.test(blob)) return "financial";
  if (SENDING_HINT.test(blob) || action === "file_dialog" && /upload|attach/i.test(blob)) {
    return "sending";
  }
  if (DESTRUCTIVE_ACTIONS.has(action) || DESTRUCTIVE_HINT.test(blob)) {
    return "destructive";
  }

  // Typing into unknown apps stays ops_safe unless hints fire
  if (action === "type_text" || action === "key" || action === "click" || action === "uia_invoke") {
    if (DESTRUCTIVE_HINT.test(blob)) return "destructive";
    return "ops_safe";
  }

  if (action === "clipboard_set") return "ops_safe";
  if (action === "launch_app" || action === "focus_window" || action === "open_media") {
    return "ops_safe";
  }
  if (action === "uia_set_value" || action === "move_mouse") return "ops_safe";

  return "ops_safe";
}

export function requiresApproval(risk: DesktopActionRisk): boolean {
  return risk === "destructive" || risk === "financial" || risk === "sending";
}

export function isDesktopAutoApproved(): boolean {
  return String(process.env.APPROVE_DESKTOP || "").trim() === "1";
}

export function resolveApproval(
  request: DesktopActionRequest,
  risk: DesktopActionRisk
): { ok: boolean; approvalId?: string; message?: string; record?: ApprovalRecord } {
  if (!requiresApproval(risk)) {
    return { ok: true };
  }

  if (request.approved === true || isDesktopAutoApproved()) {
    const id =
      typeof request.approved === "string" && request.approved.trim()
        ? request.approved.trim()
        : recordApprovalDecision(request, risk, "approved").id;
    return { ok: true, approvalId: id };
  }

  if (typeof request.approved === "string" && request.approved.trim()) {
    const existing = findApproval(request.approved.trim());
    if (existing?.status === "approved") {
      return { ok: true, approvalId: existing.id, record: existing };
    }
    if (existing?.status === "rejected") {
      return {
        ok: false,
        approvalId: existing.id,
        message: `Desktop action rejected by owner (approval ${existing.id})`,
        record: existing,
      };
    }
  }

  const pending = recordApprovalDecision(request, risk, "pending");
  return {
    ok: false,
    approvalId: pending.id,
    message: `Approval required for ${risk} desktop action "${request.action}". Approve via Control Plane or set approved:true / APPROVE_DESKTOP=1.`,
    record: pending,
  };
}

function findApproval(id: string): ApprovalRecord | undefined {
  try {
    getPersistence();
    const rows = runsRepo.listApprovals(getDriver(), getActiveTenantId());
    return rows.find((r) => r.id === id);
  } catch {
    return undefined;
  }
}

function recordApprovalDecision(
  request: DesktopActionRequest,
  risk: DesktopActionRisk,
  status: ApprovalRecord["status"]
): ApprovalRecord {
  getPersistence();
  const id =
    typeof request.approved === "string" && request.approved.trim()
      ? request.approved.trim()
      : randomUUID();
  const record: ApprovalRecord = {
    id,
    tenantId: getActiveTenantId(),
    kind: `desktop:${risk}`,
    subject: `${request.action}:${JSON.stringify(request.params || {}).slice(0, 200)}`,
    status,
    createdAt: new Date().toISOString(),
    decidedAt: status === "pending" ? undefined : new Date().toISOString(),
    meta: {
      action: request.action,
      risk,
      params: request.params || {},
      runId: request.runId,
    },
  };
  return runsRepo.upsertApproval(getDriver(), record);
}

export function approveDesktopAction(
  approvalId: string,
  approve: boolean
): ApprovalRecord | null {
  getPersistence();
  const existing = findApproval(approvalId);
  if (!existing) return null;
  const updated: ApprovalRecord = {
    ...existing,
    status: approve ? "approved" : "rejected",
    decidedAt: new Date().toISOString(),
  };
  return runsRepo.upsertApproval(getDriver(), updated);
}
