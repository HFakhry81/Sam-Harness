/**
 * Long-form roles must not use tiny 1–1.5B models.
 * Auto-escalate to cloud (within cost cap) or a >=7B local model.
 *
 * Self-learning policy: local models <=3B may only be used for simple
 * triage / classification / extraction — never planning, review,
 * translation, or research. Prefer deterministic logic; no extra paid calls.
 */
import { getRoleConfig, resolveRoleModels } from "./teamConfig.js";
import { useOllamaCloudNow } from "../agent/models.js";

export const LONG_FORM_ROLES = new Set([
  "strategist",
  "auditor",
  "architect",
  "verifier",
  "marketer",
  "help",
]);

export const SMALL_OK_ROLES = new Set([
  "ceo_router",
  "quick",
  "intake",
  "evidence",
  "operator",
]);

/** Parse approximate parameter billions from model name (qwen2.5:1.5b → 1.5). */
export function parseModelSizeB(model: string): number | null {
  const m = String(model || "").toLowerCase().match(/(\d+(?:\.\d+)?)\s*b\b/);
  if (!m) {
    // cloud tags often omit size — treat as large enough
    if (/cloud|:70b|:32b|:14b|:7b/i.test(model)) return 70;
    return null;
  }
  return Number(m[1]);
}

export function isTinyModel(model: string): boolean {
  const b = parseModelSizeB(model);
  if (b == null) return false;
  return b > 0 && b < 7;
}

/** True when model is <=3B (self-learning / simple-task gate). */
export function isSmallModel(model: string): boolean {
  const b = parseModelSizeB(model);
  if (b == null) return false;
  return b > 0 && b <= 3;
}

export type ModelPolicyDecision = {
  role: string;
  requestedLocal: string;
  requestedCloud: string;
  useCloud: boolean;
  model: string;
  escalated: boolean;
  warn?: string;
};

/**
 * Resolve model for a role under grounded-audit policy.
 */
export function resolveLongFormModel(
  roleId: string,
  cwd: string = process.cwd()
): ModelPolicyDecision {
  const models = resolveRoleModels(roleId, cwd);
  const role = getRoleConfig(roleId, cwd);
  const requestedLocal = models.local;
  const requestedCloud = models.cloud;
  const longForm = LONG_FORM_ROLES.has(roleId);

  if (!longForm) {
    return {
      role: roleId,
      requestedLocal,
      requestedCloud,
      useCloud: false,
      model: requestedLocal,
      escalated: false,
    };
  }

  const cloudOk = useOllamaCloudNow();
  const localTiny = isTinyModel(requestedLocal);
  const prefersCloud = role?.prefersCloud !== false;

  if (localTiny) {
    if (cloudOk || prefersCloud) {
      return {
        role: roleId,
        requestedLocal,
        requestedCloud,
        useCloud: cloudOk,
        model: cloudOk ? requestedCloud : requestedLocal,
        escalated: cloudOk,
        warn: cloudOk
          ? `long-form role '${roleId}' refused tiny local '${requestedLocal}' → escalated to cloud '${requestedCloud}'`
          : `long-form role '${roleId}' has tiny local '${requestedLocal}' and cloud unavailable — quality risk`,
      };
    }
  }

  // Prefer cloud for long-form when available
  if (cloudOk && prefersCloud) {
    return {
      role: roleId,
      requestedLocal,
      requestedCloud,
      useCloud: true,
      model: requestedCloud,
      escalated: isTinyModel(requestedLocal),
      warn: isTinyModel(requestedLocal)
        ? `escalated '${roleId}' from tiny local to cloud`
        : undefined,
    };
  }

  return {
    role: roleId,
    requestedLocal,
    requestedCloud,
    useCloud: false,
    model: requestedLocal,
    escalated: false,
    warn: localTiny
      ? `long-form role '${roleId}' still on tiny model '${requestedLocal}' (set OLLAMA_API_KEY or a >=7B local)`
      : undefined,
  };
}

export type TeamModelPolicyIssue = {
  roleId: string;
  model: string;
  message: string;
};

/** Validate team.json: warn when long-form roles pin tiny locals. */
export function validateTeamModelPolicy(
  cwd: string = process.cwd()
): TeamModelPolicyIssue[] {
  const issues: TeamModelPolicyIssue[] = [];
  for (const roleId of LONG_FORM_ROLES) {
    try {
      const models = resolveRoleModels(roleId, cwd);
      if (isTinyModel(models.local)) {
        issues.push({
          roleId,
          model: models.local,
          message: `long-form role should not use <7B local model '${models.local}' (prefer cloud or >=7B)`,
        });
      }
    } catch {
      /* role missing */
    }
  }
  return issues;
}
