import "../lib/loadEnv.js";
import { ChatOllama } from "@langchain/ollama";
import {
  assertWithinCostCap,
  chargeCloudCall,
  CostCapExceededError,
  getCostBudget,
  getCostCapUsd,
  recordUsage,
} from "../lib/costLedger.js";
import { loadHybridProfile } from "../controlplane/hybridProfile.js";
import {
  compactContext,
  getCachedResponse,
  lightNormalize,
  loadCostOptConfig,
  resolveModelRoute,
  setCachedResponse,
  shouldDegradeToLocal,
  type ModelRoute,
  type RouteInput,
} from "../lib/cost/index.js";
import {
  getRoleConfig,
  resolveRoleModels,
  rolePrefersCloud,
  loadTeamConfig,
} from "../agency/teamConfig.js";
import { AGENCY_ROLES } from "../agency/roles.js";
import {
  LONG_FORM_ROLES,
  isTinyModel,
  resolveLongFormModel,
} from "../agency/modelPolicy.js";
import { LONG_FORM_REPEAT_PENALTY } from "../agency/repetitionGuard.js";

export { CostCapExceededError };
export type { ModelRoute };

/** Read at call-time so .env is never missed due to ESM import order. */
function ollamaApiKey(): string {
  return String(process.env.OLLAMA_API_KEY || "").trim();
}

function hybridForcesLocal(): boolean {
  if (String(process.env.FORCE_LOCAL_SPECIALISTS || "").trim() === "1") return true;
  const mode = String(process.env.HYBRID_MODE || "").trim().toLowerCase();
  if (mode === "local") return true;
  try {
    if (loadHybridProfile(process.cwd()).mode === "local") return true;
  } catch {
    /* ignore */
  }
  return false;
}

function hybridMode(): "local" | "cloud" | "auto" {
  const env = String(process.env.HYBRID_MODE || "").trim().toLowerCase();
  if (env === "local" || env === "cloud" || env === "auto") return env;
  try {
    return loadHybridProfile(process.cwd()).mode;
  } catch {
    return "auto";
  }
}

/** True when daily spend has reached the configured cost cap. */
export function isCostCapExhausted(cwd: string = process.cwd()): boolean {
  const budget = getCostBudget(cwd);
  return budget.blocked;
}

/**
 * Whether cloud specialists may be used right now.
 * Respects FORCE_LOCAL / hybrid local mode / missing key / exhausted cost cap /
 * Phase 5 near-cap degradation.
 */
export function useOllamaCloudNow(): boolean {
  if (hybridForcesLocal()) return false;
  if (!ollamaApiKey()) return false;
  if (isCostCapExhausted()) return false;
  if (shouldDegradeToLocal()) return false;
  return true;
}

/** @deprecated prefer useOllamaCloudNow() — kept for existing imports */
export const useOllamaCloud = useOllamaCloudNow();

/**
 * Phase 5 entry: resolve local / free / paid route for a task.
 * Never returns a paid route that would exceed the daily cost cap.
 */
export function routeForTask(input: RouteInput = {}): ModelRoute {
  return resolveModelRoute({
    cwd: input.cwd || process.cwd(),
    forceLocal: input.forceLocal || hybridForcesLocal(),
    ...input,
  });
}

function chatFromRoute(
  route: ModelRoute,
  opts: {
    temperature: number;
    numPredict?: number;
    numCtx?: number;
    repeatPenalty?: number;
  }
): ChatOllama {
  return new ChatOllama({
    baseUrl: route.baseUrl,
    ...(route.headers ? { headers: route.headers } : {}),
    model: route.model,
    temperature: opts.temperature,
    think: false,
    numPredict: opts.numPredict ?? 1200,
    numCtx: opts.numCtx ?? 8192,
    ...(opts.repeatPenalty != null
      ? { repeatPenalty: opts.repeatPenalty }
      : {}),
  });
}

/** Local/fast model for CEO routing & short drafts */
export function makeCeoModel() {
  const cfg = loadCostOptConfig();
  const models = resolveRoleModels("ceo_router");
  const route = routeForTask({
    role: "ceo_router",
    forceCheap: true,
    localModel: process.env.CEO_MODEL || models.local || cfg.localModel,
    cloudModel: models.cloud,
    freeModel: models.free || undefined,
    prefersCloud: false,
  });
  return chatFromRoute(route, {
    temperature: 0.1,
    numPredict: 900,
    numCtx: 4096,
  });
}

/**
 * Resolve local/cloud/free model names for a role from team.json + env,
 * falling back to caller-provided overrides (preserve call-site defaults).
 */
export function modelsForRole(
  role: string,
  overrides?: { cloudModel?: string; localModel?: string; freeModel?: string }
): { cloudModel: string; localModel: string; freeModel?: string } {
  const fromTeam = resolveRoleModels(role);
  return {
    cloudModel: overrides?.cloudModel || fromTeam.cloud,
    localModel: overrides?.localModel || fromTeam.local,
    freeModel: overrides?.freeModel || fromTeam.free || undefined,
  };
}

/**
 * Cloud (or local/free fallback) for heavy specialist agents.
 * Phase 5: difficulty routing + near-cap degradation to local/free.
 * Phase 8: per-role models from team.json / SAM_ROLE_*_MODEL + hybrid roles map.
 * When hybrid mode is `cloud` and the daily cost cap is exhausted, throws CostCapExceededError.
 * When mode is `auto`, falls back to local once the cap is hit.
 */
export function makeSpecialistModel(opts: {
  cloudModel?: string;
  localModel?: string;
  freeModel?: string;
  temperature: number;
  numPredict?: number;
  /** Force local even if API key present (TLS / offline recovery) */
  forceLocal?: boolean;
  /** Phase 5/8 routing hints */
  role?: string;
  prompt?: string;
  confidence?: number;
  verificationFailed?: boolean;
  explicitComplexity?: boolean;
  prefersCloud?: boolean;
}) {
  const cwd = process.cwd();
  const role = opts.role || "strategist";
  const resolved = modelsForRole(role, {
    cloudModel: opts.cloudModel,
    localModel: opts.localModel,
    freeModel: opts.freeModel,
  });
  const roleCfg = getRoleConfig(role, cwd);

  // Grounded-audit: long-form roles refuse tiny locals — escalate to cloud when allowed
  let forceLocal = opts.forceLocal;
  let cloudModel = resolved.cloudModel;
  let localModel = resolved.localModel;
  let prefersCloud =
    typeof opts.prefersCloud === "boolean"
      ? opts.prefersCloud
      : rolePrefersCloud(role, cwd);
  if (LONG_FORM_ROLES.has(role) && !forceLocal) {
    const policy = resolveLongFormModel(role, cwd);
    if (policy.warn) {
      try {
        // eslint-disable-next-line no-console
        console.warn(`[model-policy] ${policy.warn}`);
      } catch {
        /* ignore */
      }
    }
    if (policy.escalated && policy.useCloud) {
      prefersCloud = true;
      cloudModel = policy.model;
    } else if (isTinyModel(localModel) && policy.useCloud) {
      prefersCloud = true;
      cloudModel = policy.requestedCloud;
    }
  }

  const route = routeForTask({
    cwd,
    role,
    prompt: opts.prompt,
    confidence: opts.confidence,
    verificationFailed: opts.verificationFailed,
    explicitComplexity: opts.explicitComplexity,
    cloudModel,
    localModel,
    freeModel: resolved.freeModel,
    forceLocal,
    forcePremium: Boolean(opts.explicitComplexity) || LONG_FORM_ROLES.has(role),
    prefersCloud,
  });

  if (route.cloud) {
    assertWithinCostCap(cwd, route.estimatedUsd || 0);
  } else if (hybridMode() === "cloud" && route.degraded && !opts.forceLocal) {
    // Strict cloud profile: refuse rather than silently running unpaid when cap blocks paid.
    const budget = getCostBudget(cwd);
    if (budget.blocked || budget.capUsd <= 0) {
      throw new CostCapExceededError(
        budget.blockReason ||
          `Cost cap exceeded ($${budget.spentUsd} / $${budget.capUsd}). Cloud specialists are blocked.`,
        budget.spentUsd,
        budget.capUsd
      );
    }
  }

  return chatFromRoute(route, {
    temperature: opts.temperature ?? roleCfg?.temperature ?? 0.2,
    numPredict: opts.numPredict ?? roleCfg?.numPredict ?? 1200,
    numCtx: 8192,
    repeatPenalty: LONG_FORM_ROLES.has(role) ? LONG_FORM_REPEAT_PENALTY : undefined,
  });
}

export function isTlsOrFetchError(err: unknown): boolean {
  const msg = String((err as any)?.message || err || "");
  const cause = String((err as any)?.cause?.message || (err as any)?.cause || "");
  const code = String((err as any)?.cause?.code || (err as any)?.code || "");
  return /fetch failed|UNABLE_TO_VERIFY|CERT|TLS|ECONNREFUSED|ENOTFOUND|certificate/i.test(
    `${msg} ${cause} ${code}`
  );
}

export function specialistLabel(cloudName: string, localName: string) {
  return useOllamaCloudNow()
    ? `Cloud (${cloudName})`
    : `Local (${localName})`;
}

export type InvokeTrackedMeta = {
  modelName: string;
  cloud?: boolean;
  /** Skip exact cache read/write. */
  skipCache?: boolean;
  role?: string;
  confidence?: number;
  verificationFailed?: boolean;
};

/**
 * Invoke a model with Phase 5 caching + compaction, and charge the daily ledger
 * when the active specialist is cloud. Emits OTel span + latency/cost metrics.
 */
export async function invokeTracked(
  model: { invoke: (prompt: string) => Promise<{ content?: unknown }> },
  prompt: string,
  meta: InvokeTrackedMeta
): Promise<string> {
  const cwd = process.cwd();
  const cfg = loadCostOptConfig();
  const cloud = meta.cloud ?? useOllamaCloudNow();
  const { withSpan, recordLlmCall, recordError } = await import(
    "../lib/observability/index.js"
  );
  return withSpan(
    "llm.invoke",
    { "llm.model": meta.modelName, "llm.cloud": cloud },
    async (span) => {
      const started = Date.now();
      try {
        const normalized = lightNormalize(prompt);
        const compacted = compactContext(normalized, {
          maxChars: cfg.contextMaxChars,
          targetChars: cfg.contextTargetChars,
        });
        const finalPrompt = compacted.text;
        if (compacted.truncated) {
          span.setAttribute("llm.context_compacted", true);
          span.setAttribute("llm.context_removed_chars", compacted.removedChars);
        }

        if (!meta.skipCache) {
          const cached = getCachedResponse(meta.modelName, finalPrompt, { config: cfg });
          if (cached.hit && cached.response != null) {
            span.setAttribute("llm.cache_hit", true);
            recordLlmCall({ durationMs: Date.now() - started, costUsd: 0 });
            // Local accounting note: zero-cost cache hit (not cloud).
            recordUsage(cwd, {
              model: meta.modelName,
              inputTokens: 0,
              outputTokens: 0,
              costUsd: 0,
              cloud: false,
            });
            return cached.response;
          }
        }

        if (cloud) {
          // Near-cap / exhausted: never open a paid call
          if (shouldDegradeToLocal(cwd, cfg) || isCostCapExhausted(cwd)) {
            throw new CostCapExceededError(
              `Cost cap near/exceeded — refusing paid invoke for ${meta.modelName}`,
              getCostBudget(cwd).spentUsd,
              getCostCapUsd(cwd)
            );
          }
          const estChars = finalPrompt.length;
          const { estimateCloudCallUsd } = await import("../lib/costLedger.js");
          assertWithinCostCap(
            cwd,
            estimateCloudCallUsd(meta.modelName, estChars, 600)
          );
        }

        const res = await model.invoke(finalPrompt);
        const text = String(res.content || "");
        let costUsd = 0;
        if (cloud) {
          const entry = chargeCloudCall(cwd, {
            model: meta.modelName,
            prompt: finalPrompt,
            output: text,
          });
          costUsd = entry.costUsd;
        } else {
          // Accurate local/free token accounting at $0
          recordUsage(cwd, {
            model: meta.modelName,
            inputTokens: Math.max(1, Math.ceil(finalPrompt.length / 4)),
            outputTokens: Math.max(1, Math.ceil(text.length / 4)),
            costUsd: 0,
            cloud: false,
          });
        }

        if (!meta.skipCache) {
          setCachedResponse(meta.modelName, finalPrompt, text, {
            config: cfg,
            inputTokens: Math.ceil(finalPrompt.length / 4),
            outputTokens: Math.ceil(text.length / 4),
          });
        }

        const durationMs = Date.now() - started;
        recordLlmCall({ durationMs, costUsd });
        span.setAttribute("llm.duration_ms", durationMs);
        if (costUsd) span.setAttribute("llm.cost_usd", costUsd);
        return text;
      } catch (e) {
        recordError();
        throw e;
      }
    }
  );
}

/** Snapshot for UI / API */
export function costStatus(cwd: string = process.cwd()) {
  const budget = getCostBudget(cwd);
  const cfg = loadCostOptConfig();
  return {
    ...budget,
    capUsd: getCostCapUsd(cwd),
    nearCap: shouldDegradeToLocal(cwd, cfg),
    routingEnabled: cfg.routingEnabled,
    cacheEnabled: cfg.cacheEnabled,
  };
}

export type EffectiveRoleDecision = {
  role: string;
  title?: string;
  prefersCloud: boolean;
  models: { local: string; cloud: string; free?: string | null };
  route: ModelRoute;
};

/**
 * Effective routing decision per role — for Control Plane API + doctor.
 * Cap / near-cap / hybrid roles map / prefersCloud are all reflected.
 */
export function effectiveRoutingDecisions(
  cwd: string = process.cwd(),
  roleIds?: string[]
): EffectiveRoleDecision[] {
  let ids = roleIds;
  if (!ids) {
    try {
      ids = loadTeamConfig(cwd).roles.map((r) => r.id);
    } catch {
      ids = AGENCY_ROLES.map((r) => r.id);
    }
  }
  return ids.map((role) => {
    const models = resolveRoleModels(role, cwd);
    const cfg = getRoleConfig(role, cwd);
    const route = routeForTask({
      cwd,
      role,
      cloudModel: models.cloud,
      localModel: models.local,
      freeModel: models.free || undefined,
      prefersCloud: rolePrefersCloud(role, cwd),
      forceCheap: role === "ceo_router" || role === "operator" || role === "evidence",
    });
    return {
      role,
      title: cfg?.title,
      prefersCloud: rolePrefersCloud(role, cwd),
      models,
      route,
    };
  });
}
