/**
 * Phase 8 — team & workflow customization via config/team.json + env overrides.
 * Validated against config/team.schema.json (lightweight runtime checks).
 */
import * as fs from "fs";
import * as path from "path";
import { AGENCY_ROLES, type RoleContract } from "./roles.js";
import type { RoleId } from "./types.js";
import { appendAudit } from "../lib/trust/auditLog.js";

export type TeamRoleModels = {
  local: string;
  cloud: string;
  free?: string | null;
};

export type TeamRoleStage =
  | "intake"
  | "evidence"
  | "review"
  | "downstream"
  | "implement"
  | "operator"
  | "none";

export type TeamRoleConfig = {
  id: string;
  title: string;
  mission?: string;
  enabled: boolean;
  builtin: boolean;
  prefersCloud: boolean;
  models: TeamRoleModels;
  prompt?: string;
  tools?: string[];
  temperature?: number;
  numPredict?: number;
  order?: number;
  stage: TeamRoleStage;
  outputs?: string[];
};

export type TeamPipelineConfig = {
  /** Ordered specialist steps after APPROVED (excluding fixed review loop). */
  downstreamOrder: string[];
  keepReviewLoop: true;
  keepGoGate: true;
};

export type TeamConfig = {
  version: 1;
  roles: TeamRoleConfig[];
  pipeline: TeamPipelineConfig;
  updatedAt?: string;
};

export type TeamValidationIssue = {
  path: string;
  message: string;
};

export type TeamValidationResult = {
  ok: boolean;
  issues: TeamValidationIssue[];
};

const ROLE_ID_RE = /^[a-z][a-z0-9_]{0,47}$/;
const REVIEW_INVARIANT = new Set(["strategist", "auditor"]);
const PROTECTED_DISABLE = new Set(["ceo_router", "strategist", "auditor", "implementer"]);

/** Hard-coded defaults that preserve pre-Phase-8 behaviour. */
export const DEFAULT_ROLE_MODELS: Record<string, TeamRoleModels> = {
  ceo_router: { local: "qwen2.5-coder:1.5b", cloud: "gemma4:cloud", free: null },
  intake: { local: "qwen2.5-coder:1.5b", cloud: "gemma4:cloud", free: null },
  evidence: { local: "qwen2.5-coder:1.5b", cloud: "gemma4:cloud", free: null },
  strategist: { local: "qwen2.5-coder:1.5b", cloud: "gemma4:cloud", free: null },
  auditor: { local: "gemma3:1b", cloud: "gemma4:cloud", free: null },
  architect: { local: "qwen2.5:1.5b", cloud: "gemma4:cloud", free: null },
  help: { local: "qwen2.5:1.5b", cloud: "gemma4:cloud", free: null },
  marketer: { local: "qwen2.5:1.5b", cloud: "gemma4:cloud", free: null },
  verifier: { local: "qwen2.5-coder:1.5b", cloud: "gemma4:cloud", free: null },
  implementer: { local: "qwen2.5-coder:1.5b", cloud: "gemma4:cloud", free: null },
  operator: { local: "qwen2.5-coder:1.5b", cloud: "gemma4:cloud", free: null },
  coder: { local: "qwen2.5-coder:1.5b", cloud: "gemma4:cloud", free: null },
};

function envKeyForRole(roleId: string, suffix: string): string {
  const upper = roleId.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return `SAM_ROLE_${upper}_${suffix}`;
}

function applyEnvModelOverrides(role: TeamRoleConfig): TeamRoleConfig {
  const local = String(process.env[envKeyForRole(role.id, "MODEL")] || "").trim();
  const cloud = String(process.env[envKeyForRole(role.id, "CLOUD_MODEL")] || "").trim();
  const free = String(process.env[envKeyForRole(role.id, "FREE_MODEL")] || "").trim();
  if (!local && !cloud && !free) return role;
  return {
    ...role,
    models: {
      local: local || role.models.local,
      cloud: cloud || role.models.cloud,
      free: free || role.models.free || null,
    },
  };
}

function builtinFromAgencyRoles(): TeamRoleConfig[] {
  const stageById: Record<string, TeamRoleStage> = {
    ceo_router: "none",
    intake: "intake",
    evidence: "evidence",
    strategist: "review",
    auditor: "review",
    architect: "downstream",
    help: "downstream",
    marketer: "downstream",
    verifier: "downstream",
    implementer: "implement",
    operator: "operator",
  };
  const orderById: Record<string, number> = {
    ceo_router: 0,
    intake: 10,
    evidence: 20,
    strategist: 30,
    auditor: 40,
    architect: 50,
    help: 60,
    marketer: 70,
    verifier: 80,
    implementer: 90,
    operator: 100,
  };
  const roles: TeamRoleConfig[] = AGENCY_ROLES.map((r: RoleContract) => ({
    id: r.id,
    title: r.title,
    mission: r.mission,
    enabled: true,
    builtin: true,
    prefersCloud: r.prefersCloud,
    models: { ...(DEFAULT_ROLE_MODELS[r.id] || DEFAULT_ROLE_MODELS.strategist) },
    stage: stageById[r.id] || "none",
    order: orderById[r.id] ?? 500,
    outputs: [...r.outputs],
  }));
  roles.push({
    id: "coder",
    title: "L3 Coder",
    mission: "Propose bounded writes during Level-3 implement.",
    enabled: true,
    builtin: true,
    prefersCloud: true,
    models: { ...DEFAULT_ROLE_MODELS.coder },
    stage: "implement",
    order: 95,
    outputs: ["level3 writes"],
  });
  return roles;
}

export function defaultTeamConfig(): TeamConfig {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    roles: builtinFromAgencyRoles(),
    pipeline: {
      downstreamOrder: ["architect", "help", "marketer", "verifier"],
      keepReviewLoop: true,
      keepGoGate: true,
    },
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

export function validateTeamConfig(raw: unknown): TeamValidationResult {
  const issues: TeamValidationIssue[] = [];
  if (!isPlainObject(raw)) {
    return { ok: false, issues: [{ path: "", message: "team config must be an object" }] };
  }
  if (raw.version !== 1) {
    issues.push({ path: "version", message: "version must be 1" });
  }
  if (!Array.isArray(raw.roles) || raw.roles.length < 1) {
    issues.push({ path: "roles", message: "roles must be a non-empty array" });
  }
  if (!isPlainObject(raw.pipeline)) {
    issues.push({ path: "pipeline", message: "pipeline object required" });
  } else {
    if (raw.pipeline.keepReviewLoop !== true) {
      issues.push({
        path: "pipeline.keepReviewLoop",
        message: "keepReviewLoop must remain true (review-loop invariant)",
      });
    }
    if (raw.pipeline.keepGoGate !== true) {
      issues.push({
        path: "pipeline.keepGoGate",
        message: "keepGoGate must remain true (GO-gate invariant)",
      });
    }
    if (!Array.isArray(raw.pipeline.downstreamOrder)) {
      issues.push({
        path: "pipeline.downstreamOrder",
        message: "downstreamOrder must be an array of role ids",
      });
    }
  }

  const seen = new Set<string>();
  const roles = Array.isArray(raw.roles) ? raw.roles : [];
  for (let i = 0; i < roles.length; i++) {
    const r = roles[i];
    const p = `roles[${i}]`;
    if (!isPlainObject(r)) {
      issues.push({ path: p, message: "role must be an object" });
      continue;
    }
    const id = String(r.id || "");
    if (!ROLE_ID_RE.test(id)) {
      issues.push({ path: `${p}.id`, message: `invalid role id "${id}"` });
    }
    if (seen.has(id)) {
      issues.push({ path: `${p}.id`, message: `duplicate role id "${id}"` });
    }
    seen.add(id);
    if (!r.title || typeof r.title !== "string") {
      issues.push({ path: `${p}.title`, message: "title required" });
    }
    if (typeof r.enabled !== "boolean") {
      issues.push({ path: `${p}.enabled`, message: "enabled must be boolean" });
    }
    if (typeof r.builtin !== "boolean") {
      issues.push({ path: `${p}.builtin`, message: "builtin must be boolean" });
    }
    if (typeof r.prefersCloud !== "boolean") {
      issues.push({ path: `${p}.prefersCloud`, message: "prefersCloud must be boolean" });
    }
    if (!isPlainObject(r.models) || typeof r.models.local !== "string" || typeof r.models.cloud !== "string") {
      issues.push({ path: `${p}.models`, message: "models.local and models.cloud required" });
    }
    const stages = new Set([
      "intake",
      "evidence",
      "review",
      "downstream",
      "implement",
      "operator",
      "none",
    ]);
    if (!stages.has(String(r.stage))) {
      issues.push({ path: `${p}.stage`, message: `invalid stage "${r.stage}"` });
    }
    if (r.builtin === false && !String(r.prompt || "").trim() && r.stage === "downstream") {
      issues.push({
        path: `${p}.prompt`,
        message: "custom downstream roles require a prompt",
      });
    }
    if (PROTECTED_DISABLE.has(id) && r.enabled === false) {
      issues.push({
        path: `${p}.enabled`,
        message: `role "${id}" cannot be disabled (pipeline invariant)`,
      });
    }
  }

  // Review-loop roles must exist and stay in review stage
  for (const id of REVIEW_INVARIANT) {
    if (!seen.has(id)) {
      issues.push({ path: "roles", message: `missing invariant role "${id}"` });
    } else {
      const hit = roles.find((x) => isPlainObject(x) && x.id === id) as Record<string, unknown> | undefined;
      if (hit && hit.stage !== "review") {
        issues.push({
          path: `roles.${id}.stage`,
          message: `"${id}" must remain stage=review`,
        });
      }
    }
  }

  if (isPlainObject(raw.pipeline) && Array.isArray(raw.pipeline.downstreamOrder)) {
    for (const id of raw.pipeline.downstreamOrder as unknown[]) {
      const rid = String(id);
      if (!seen.has(rid)) {
        issues.push({
          path: "pipeline.downstreamOrder",
          message: `unknown role id "${rid}" in downstreamOrder`,
        });
      } else if (REVIEW_INVARIANT.has(rid)) {
        issues.push({
          path: "pipeline.downstreamOrder",
          message: `review-loop role "${rid}" cannot appear in downstreamOrder`,
        });
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

function normalizeConfig(raw: TeamConfig): TeamConfig {
  const roles = raw.roles.map((r) => applyEnvModelOverrides({ ...r, models: { ...r.models } }));
  // Apply CEO_MODEL as default local for roles that still use the coder default when CEO_MODEL set
  const ceo = String(process.env.CEO_MODEL || "").trim();
  if (ceo) {
    for (const r of roles) {
      if (
        (r.id === "ceo_router" || r.id === "strategist" || r.id === "verifier") &&
        !String(process.env[envKeyForRole(r.id, "MODEL")] || "").trim()
      ) {
        // Preserve historical CEO_MODEL override for router/strategist local
        if (r.models.local === "qwen2.5-coder:1.5b" || r.id === "ceo_router") {
          r.models.local = ceo;
        }
      }
    }
  }
  return {
    version: 1,
    updatedAt: raw.updatedAt,
    roles,
    pipeline: {
      downstreamOrder: [...raw.pipeline.downstreamOrder],
      keepReviewLoop: true,
      keepGoGate: true,
    },
  };
}

let cache: { cwd: string; mtimeMs: number; config: TeamConfig } | null = null;

export function teamConfigPath(cwd: string = process.cwd()): string {
  return path.join(cwd, "config", "team.json");
}

export function teamSchemaPath(cwd: string = process.cwd()): string {
  return path.join(cwd, "config", "team.schema.json");
}

/**
 * Load team config from config/team.json (or defaults), apply env overrides.
 * Invalid files throw with validation issues.
 */
export function loadTeamConfig(cwd: string = process.cwd()): TeamConfig {
  const file = teamConfigPath(cwd);
  let mtimeMs = 0;
  let raw: unknown;
  if (fs.existsSync(file)) {
    const st = fs.statSync(file);
    mtimeMs = st.mtimeMs;
    if (cache && cache.cwd === cwd && cache.mtimeMs === mtimeMs) {
      // Re-apply env each call (env may change in tests)
      return normalizeConfig(structuredClone(cache.config));
    }
    raw = JSON.parse(fs.readFileSync(file, "utf-8"));
  } else {
    raw = defaultTeamConfig();
  }
  const result = validateTeamConfig(raw);
  if (!result.ok) {
    throw new Error(
      `Invalid team config: ${result.issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`
    );
  }
  const cfg = normalizeConfig(raw as TeamConfig);
  cache = { cwd, mtimeMs, config: structuredClone(cfg) };
  return cfg;
}

export function __resetTeamConfigCacheForTests(): void {
  cache = null;
}

export function saveTeamConfig(
  cwd: string,
  next: TeamConfig,
  opts: { actor?: string; audit?: boolean } = {}
): TeamConfig {
  const result = validateTeamConfig(next);
  if (!result.ok) {
    throw new Error(
      `Invalid team config: ${result.issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`
    );
  }
  const dir = path.join(cwd, "config");
  fs.mkdirSync(dir, { recursive: true });
  const toWrite: TeamConfig = {
    ...next,
    version: 1,
    updatedAt: new Date().toISOString(),
    pipeline: {
      downstreamOrder: [...next.pipeline.downstreamOrder],
      keepReviewLoop: true,
      keepGoGate: true,
    },
  };
  const file = teamConfigPath(cwd);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(toWrite, null, 2) + "\n", "utf-8");
  fs.renameSync(tmp, file);
  cache = null;
  if (opts.audit !== false) {
    try {
      appendAudit({
        category: "system",
        action: "team_config.save",
        actor: opts.actor || "owner",
        detail: {
          roleCount: toWrite.roles.length,
          downstreamOrder: toWrite.pipeline.downstreamOrder,
          updatedAt: toWrite.updatedAt,
        },
      });
    } catch {
      /* audit optional during early boot / unit tests without DB */
    }
  }
  return loadTeamConfig(cwd);
}

export function getRoleConfig(
  roleId: string,
  cwd: string = process.cwd()
): TeamRoleConfig | undefined {
  return loadTeamConfig(cwd).roles.find((r) => r.id === roleId);
}

export function listEnabledRoles(cwd: string = process.cwd()): TeamRoleConfig[] {
  return loadTeamConfig(cwd).roles.filter((r) => r.enabled);
}

/** Models for makeSpecialistModel — env + team.json. */
export function resolveRoleModels(
  roleId: string,
  cwd: string = process.cwd()
): TeamRoleModels {
  const role = getRoleConfig(roleId, cwd);
  if (role) return { ...role.models };
  const fallback = DEFAULT_ROLE_MODELS[roleId] || DEFAULT_ROLE_MODELS.strategist;
  return applyEnvModelOverrides({
    id: roleId,
    title: roleId,
    enabled: true,
    builtin: false,
    prefersCloud: false,
    models: { ...fallback },
    stage: "none",
  }).models;
}

export function rolePrefersCloud(roleId: string, cwd: string = process.cwd()): boolean {
  const role = getRoleConfig(roleId, cwd);
  if (role) return role.prefersCloud;
  try {
    return AGENCY_ROLES.find((r) => r.id === (roleId as RoleId))?.prefersCloud ?? false;
  } catch {
    return false;
  }
}

/**
 * Downstream specialist steps after APPROVED, in configured order.
 * Skips disabled roles. Review loop roles never appear here.
 */
export function resolveDownstreamPipeline(cwd: string = process.cwd()): TeamRoleConfig[] {
  const cfg = loadTeamConfig(cwd);
  const byId = new Map(cfg.roles.map((r) => [r.id, r]));
  const out: TeamRoleConfig[] = [];
  for (const id of cfg.pipeline.downstreamOrder) {
    const role = byId.get(id);
    if (!role || !role.enabled) continue;
    if (role.stage !== "downstream" && !role.builtin) {
      // custom roles in downstreamOrder are allowed
      out.push(role);
      continue;
    }
    if (role.stage === "downstream") out.push(role);
  }
  return out;
}

export function upsertTeamRole(
  cwd: string,
  patch: Partial<TeamRoleConfig> & { id: string },
  opts: { actor?: string } = {}
): TeamConfig {
  const cfg = loadTeamConfig(cwd);
  const idx = cfg.roles.findIndex((r) => r.id === patch.id);
  if (idx >= 0) {
    const prev = cfg.roles[idx];
    if (prev.builtin && patch.builtin === false) {
      throw new Error(`Cannot convert builtin role "${patch.id}" to custom`);
    }
    const nextRole: TeamRoleConfig = {
      ...prev,
      ...patch,
      id: prev.id,
      builtin: prev.builtin,
      models: {
        ...prev.models,
        ...(patch.models || {}),
      },
    };
    cfg.roles[idx] = nextRole;
  } else {
    if (!patch.title) throw new Error("title required for new role");
    if (!patch.models?.local || !patch.models?.cloud) {
      throw new Error("models.local and models.cloud required for new role");
    }
    const role: TeamRoleConfig = {
      id: patch.id,
      title: patch.title,
      mission: patch.mission || "",
      enabled: patch.enabled !== false,
      builtin: false,
      prefersCloud: Boolean(patch.prefersCloud),
      models: {
        local: patch.models.local,
        cloud: patch.models.cloud,
        free: patch.models.free ?? null,
      },
      prompt: patch.prompt || "",
      tools: patch.tools || ["write_report", "write_file", "read_file", "list_dir", "finish"],
      temperature: patch.temperature ?? 0.3,
      numPredict: patch.numPredict ?? 1000,
      order: patch.order ?? 500,
      stage: patch.stage || "downstream",
      outputs: patch.outputs || [`${patch.id}-output.md`],
    };
    cfg.roles.push(role);
    if (role.stage === "downstream" && !cfg.pipeline.downstreamOrder.includes(role.id)) {
      cfg.pipeline.downstreamOrder.push(role.id);
    }
  }
  const saved = saveTeamConfig(cwd, cfg, { actor: opts.actor });
  try {
    appendAudit({
      category: "system",
      action: "team_role.upsert",
      actor: opts.actor || "owner",
      detail: { roleId: patch.id },
    });
  } catch {
    /* ignore */
  }
  return saved;
}

export function deleteTeamRole(
  cwd: string,
  roleId: string,
  opts: { actor?: string } = {}
): TeamConfig {
  const cfg = loadTeamConfig(cwd);
  const role = cfg.roles.find((r) => r.id === roleId);
  if (!role) throw new Error(`Role not found: ${roleId}`);
  if (role.builtin) throw new Error(`Cannot delete builtin role "${roleId}" — disable or edit instead`);
  cfg.roles = cfg.roles.filter((r) => r.id !== roleId);
  cfg.pipeline.downstreamOrder = cfg.pipeline.downstreamOrder.filter((id) => id !== roleId);
  const saved = saveTeamConfig(cwd, cfg, { actor: opts.actor });
  try {
    appendAudit({
      category: "system",
      action: "team_role.delete",
      actor: opts.actor || "owner",
      detail: { roleId },
    });
  } catch {
    /* ignore */
  }
  return saved;
}

export function setDownstreamOrder(
  cwd: string,
  order: string[],
  opts: { actor?: string } = {}
): TeamConfig {
  const cfg = loadTeamConfig(cwd);
  cfg.pipeline.downstreamOrder = order;
  return saveTeamConfig(cwd, cfg, { actor: opts.actor });
}

/** Snapshot for doctor / API — models after env merge. */
export function teamConfigSummary(cwd: string = process.cwd()): {
  path: string;
  exists: boolean;
  roleCount: number;
  enabledCount: number;
  downstreamOrder: string[];
  roles: Array<{
    id: string;
    enabled: boolean;
    prefersCloud: boolean;
    models: TeamRoleModels;
    stage: TeamRoleStage;
  }>;
} {
  const file = teamConfigPath(cwd);
  const cfg = loadTeamConfig(cwd);
  return {
    path: file,
    exists: fs.existsSync(file),
    roleCount: cfg.roles.length,
    enabledCount: cfg.roles.filter((r) => r.enabled).length,
    downstreamOrder: [...cfg.pipeline.downstreamOrder],
    roles: cfg.roles.map((r) => ({
      id: r.id,
      enabled: r.enabled,
      prefersCloud: r.prefersCloud,
      models: { ...r.models },
      stage: r.stage,
    })),
  };
}
