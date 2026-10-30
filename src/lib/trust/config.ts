/**
 * Phase 6 — trust / gates policy (env + optional trust-policy.json).
 */
import * as fs from "fs";
import * as path from "path";

export type TrustPolicy = {
  /** Require HITL for delete/move outside SAM_OUTPUT_HOME / cwd workspace. */
  requireApprovalDestructiveOutsideHome: boolean;
  /** Require HITL for SMTP/Resend send (in addition to APPROVE_COMMS). */
  requireApprovalEmailSend: boolean;
  /**
   * Single cloud charge (USD) that triggers a spend approval before recording.
   * Cap enforcement remains separate (Phase 1). Default 0.25.
   */
  spendApprovalThresholdUsd: number;
  /** App title / process regexes treated as sensitive desktop targets. */
  sensitiveDesktopApps: string[];
  /** Max gate retries before escalate (never silent success). Default 2. */
  gateRetryAttempts: number;
  /** When all gate retries fail, mark step escalated (not done). */
  escalateOnGateFail: boolean;
  /** Enable quality gates before marking plan steps done. */
  gatesEnabled: boolean;
  /** Enable hash-chained audit log writes. */
  auditEnabled: boolean;
  /** Write evidence bundles under runs/ + reports/. */
  evidenceEnabled: boolean;
};

const DEFAULT_SENSITIVE = [
  "outlook",
  "mail",
  "thunderbird",
  "paypal",
  "stripe",
  "bank",
  "1password",
  "lastpass",
  "bitwarden",
  "keychain",
  "wallet",
  "broker",
  "trading",
];

export const DEFAULT_TRUST_POLICY: TrustPolicy = {
  requireApprovalDestructiveOutsideHome: true,
  requireApprovalEmailSend: true,
  spendApprovalThresholdUsd: 0.25,
  sensitiveDesktopApps: [...DEFAULT_SENSITIVE],
  gateRetryAttempts: 2,
  escalateOnGateFail: true,
  gatesEnabled: true,
  auditEnabled: true,
  evidenceEnabled: true,
};

function envBool(name: string, fallback: boolean): boolean {
  const v = String(process.env[name] ?? "").trim().toLowerCase();
  if (!v) return fallback;
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  if (v === "1" || v === "true" || v === "on" || v === "yes") return true;
  return fallback;
}

function envNum(name: string, fallback: number): number {
  const v = String(process.env[name] ?? "").trim();
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function loadFilePolicy(cwd: string = process.cwd()): Partial<TrustPolicy> {
  const candidates = [
    path.join(cwd, "trust-policy.json"),
    path.join(cwd, ".trust-policy.json"),
  ];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
      const out: Partial<TrustPolicy> = {};
      if (typeof raw.requireApprovalDestructiveOutsideHome === "boolean") {
        out.requireApprovalDestructiveOutsideHome =
          raw.requireApprovalDestructiveOutsideHome;
      }
      if (typeof raw.requireApprovalEmailSend === "boolean") {
        out.requireApprovalEmailSend = raw.requireApprovalEmailSend;
      }
      if (typeof raw.spendApprovalThresholdUsd === "number") {
        out.spendApprovalThresholdUsd = raw.spendApprovalThresholdUsd;
      }
      if (Array.isArray(raw.sensitiveDesktopApps)) {
        out.sensitiveDesktopApps = raw.sensitiveDesktopApps
          .map((s) => String(s).trim())
          .filter(Boolean);
      }
      if (typeof raw.gateRetryAttempts === "number") {
        out.gateRetryAttempts = Math.max(0, Math.floor(raw.gateRetryAttempts));
      }
      if (typeof raw.escalateOnGateFail === "boolean") {
        out.escalateOnGateFail = raw.escalateOnGateFail;
      }
      if (typeof raw.gatesEnabled === "boolean") out.gatesEnabled = raw.gatesEnabled;
      if (typeof raw.auditEnabled === "boolean") out.auditEnabled = raw.auditEnabled;
      if (typeof raw.evidenceEnabled === "boolean") {
        out.evidenceEnabled = raw.evidenceEnabled;
      }
      return out;
    } catch {
      /* ignore bad file */
    }
  }
  return {};
}

/** Effective policy: defaults ← trust-policy.json ← env. */
export function loadTrustPolicy(cwd: string = process.cwd()): TrustPolicy {
  const file = loadFilePolicy(cwd);
  const base: TrustPolicy = { ...DEFAULT_TRUST_POLICY, ...file };
  const sensitiveRaw = String(process.env.SAM_TRUST_SENSITIVE_APPS || "").trim();
  return {
    requireApprovalDestructiveOutsideHome: envBool(
      "SAM_TRUST_REQUIRE_DESTRUCTIVE_APPROVAL",
      base.requireApprovalDestructiveOutsideHome
    ),
    requireApprovalEmailSend: envBool(
      "SAM_TRUST_REQUIRE_EMAIL_APPROVAL",
      base.requireApprovalEmailSend
    ),
    spendApprovalThresholdUsd: envNum(
      "SAM_TRUST_SPEND_APPROVAL_USD",
      base.spendApprovalThresholdUsd
    ),
    sensitiveDesktopApps: sensitiveRaw
      ? sensitiveRaw
          .split(/[;,]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : base.sensitiveDesktopApps,
    gateRetryAttempts: Math.max(
      0,
      Math.floor(envNum("SAM_TRUST_GATE_RETRIES", base.gateRetryAttempts))
    ),
    escalateOnGateFail: envBool("SAM_TRUST_ESCALATE_ON_GATE_FAIL", base.escalateOnGateFail),
    gatesEnabled: envBool("SAM_TRUST_GATES", base.gatesEnabled),
    auditEnabled: envBool("SAM_TRUST_AUDIT", base.auditEnabled),
    evidenceEnabled: envBool("SAM_TRUST_EVIDENCE", base.evidenceEnabled),
  };
}

let cached: TrustPolicy | null = null;

export function getEffectiveTrustPolicy(cwd: string = process.cwd()): TrustPolicy {
  if (!cached) cached = loadTrustPolicy(cwd);
  return cached;
}

export function __resetTrustPolicyForTests(): void {
  cached = null;
}
