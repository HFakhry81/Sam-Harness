/**
 * Phase 6 — verifiable gates and trust.
 */
export {
  DEFAULT_TRUST_POLICY,
  loadTrustPolicy,
  getEffectiveTrustPolicy,
  __resetTrustPolicyForTests,
  type TrustPolicy,
} from "./config.js";

export {
  GENESIS_HASH,
  appendAudit,
  listAudit,
  verifyAuditChain,
  computeEntryHash,
  canonicalJson,
  type AuditCategory,
  type AuditEntry,
  type AuditVerifyResult,
} from "./auditLog.js";

export {
  evaluateGate,
  runStepGates,
  assertStepDone,
  listGateResults,
  type GateKind,
  type GateSpec,
  type GateOutcome,
  type StepGateResult,
} from "./gates.js";

export {
  requireDestructiveFsApproval,
  requireEmailSendApproval,
  requireSpendApproval,
  requireDesktopSensitiveApproval,
  isOutsideAgentHome,
  isSensitiveDesktopTarget,
  listPendingApprovals,
  listAllApprovals,
  decideApproval,
  type TrustApprovalKind,
  type ApprovalDecision,
} from "./approvals.js";

export {
  writeEvidenceBundle,
  readEvidenceBundle,
  type EvidenceBundle,
} from "./evidence.js";
