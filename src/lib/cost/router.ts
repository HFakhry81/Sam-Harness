/**
 * Phase 5 — model routing: cheap/local → free → paid, with cost-cap awareness.
 */
import { getCostBudget } from "../costLedger.js";
import { loadHybridProfile } from "../../controlplane/hybridProfile.js";
import {
  classifyDifficulty,
  escalateTier,
  type DifficultyInput,
  type DifficultyTier,
} from "./difficulty.js";
import { loadCostOptConfig, type CostOptConfig } from "./config.js";

export type ModelTier = "local" | "free" | "paid";

export type ModelRoute = {
  tier: ModelTier;
  difficulty: DifficultyTier;
  model: string;
  baseUrl: string;
  /** True when this call would bill against the daily cloud cap. */
  cloud: boolean;
  /** Estimated USD for a typical call (0 for local/free). */
  estimatedUsd: number;
  /** Why this route was chosen (for logs / UI). */
  reason: string;
  /** Headers for the HTTP client (e.g. Authorization). */
  headers?: Record<string, string>;
  /** Hint to attach provider prompt-cache markers when supported. */
  useProviderPromptCache: boolean;
  /** Cap / budget forced local degradation. */
  degraded: boolean;
};

export type RouteInput = DifficultyInput & {
  cwd?: string;
  /** Preferred cloud model name when paid tier is selected. */
  cloudModel?: string;
  /** Preferred local model name. */
  localModel?: string;
  /** Skip paid even if difficulty is premium (e.g. FORCE_LOCAL). */
  forceLocal?: boolean;
  /** Override config (tests). */
  config?: CostOptConfig;
};

function hybridForcesLocal(cwd: string): boolean {
  if (String(process.env.FORCE_LOCAL_SPECIALISTS || "").trim() === "1") return true;
  const mode = String(process.env.HYBRID_MODE || "").trim().toLowerCase();
  if (mode === "local") return true;
  try {
    if (loadHybridProfile(cwd).mode === "local") return true;
  } catch {
    /* ignore */
  }
  return false;
}

function hybridMode(cwd: string): "local" | "cloud" | "auto" {
  const env = String(process.env.HYBRID_MODE || "").trim().toLowerCase();
  if (env === "local" || env === "cloud" || env === "auto") return env;
  try {
    return loadHybridProfile(cwd).mode;
  } catch {
    return "auto";
  }
}

function ollamaApiKey(): string {
  return String(process.env.OLLAMA_API_KEY || "").trim();
}

function freeTierConfigured(cfg: CostOptConfig): boolean {
  return Boolean(cfg.freeBaseUrl && cfg.freeModel);
}

/**
 * True when remaining budget is at/below the near-cap ratio (or cap is $0).
 * Callers should stay on local/free and never open a paid client.
 */
export function shouldDegradeToLocal(
  cwd: string = process.cwd(),
  config?: CostOptConfig
): boolean {
  const cfg = config || loadCostOptConfig();
  const budget = getCostBudget(cwd);
  if (budget.capUsd <= 0) return true;
  if (budget.blocked) return true;
  const remainingRatio = budget.remainingUsd / budget.capUsd;
  return remainingRatio <= cfg.nearCapRemainingRatio;
}

/**
 * Whether a proposed paid charge fits under the daily cap (never exceed).
 */
export function canAffordPaid(
  cwd: string,
  estimatedUsd: number,
  config?: CostOptConfig
): boolean {
  if (shouldDegradeToLocal(cwd, config)) return false;
  const budget = getCostBudget(cwd);
  const add = Math.max(0, estimatedUsd);
  return budget.spentUsd + add <= budget.capUsd + 1e-9;
}

function estimatePaidUsd(model: string, promptChars: number): number {
  // Keep in sync with costLedger rough rates; avoid circular import of estimateCloudCallUsd shape.
  const inputTokens = Math.max(200, Math.ceil(promptChars / 4));
  const outputTokens = 600;
  const rate =
    /claude/i.test(model) ? 3.0 : /gpt-oss|120b/i.test(model) ? 0.8 : 0.4;
  return Math.max(0.0001, ((inputTokens + outputTokens) / 1_000_000) * rate);
}

function localRoute(
  cfg: CostOptConfig,
  difficulty: DifficultyTier,
  model: string,
  reason: string,
  degraded: boolean
): ModelRoute {
  return {
    tier: "local",
    difficulty,
    model,
    baseUrl: cfg.localBaseUrl,
    cloud: false,
    estimatedUsd: 0,
    reason,
    useProviderPromptCache: false,
    degraded,
  };
}

function freeRoute(
  cfg: CostOptConfig,
  difficulty: DifficultyTier,
  reason: string
): ModelRoute {
  const headers: Record<string, string> = {};
  if (cfg.freeApiKey) {
    headers.Authorization = `Bearer ${cfg.freeApiKey}`;
  }
  return {
    tier: "free",
    difficulty,
    model: cfg.freeModel,
    baseUrl: cfg.freeBaseUrl,
    cloud: false,
    estimatedUsd: 0,
    reason,
    headers: Object.keys(headers).length ? headers : undefined,
    useProviderPromptCache: cfg.providerPromptCache,
    degraded: false,
  };
}

function paidRoute(
  cfg: CostOptConfig,
  difficulty: DifficultyTier,
  model: string,
  estimatedUsd: number,
  reason: string
): ModelRoute {
  const key = ollamaApiKey();
  return {
    tier: "paid",
    difficulty,
    model,
    baseUrl: cfg.paidBaseUrl,
    cloud: true,
    estimatedUsd,
    reason,
    headers: key ? { Authorization: `Bearer ${key}` } : undefined,
    useProviderPromptCache: cfg.providerPromptCache,
    degraded: false,
  };
}

/**
 * Resolve which model endpoint to use for this call.
 * Never selects paid when it would exceed the daily cap.
 */
export function resolveModelRoute(input: RouteInput = {}): ModelRoute {
  const cwd = input.cwd || process.cwd();
  const cfg = input.config || loadCostOptConfig();
  const localModel = input.localModel || cfg.localModel;
  const paidModel = input.cloudModel || cfg.paidModel;

  let difficulty = classifyDifficulty(input);
  difficulty = escalateTier(difficulty, {
    verificationFailed: input.verificationFailed,
    confidence: input.confidence,
    threshold: cfg.escalateConfidenceBelow,
  });

  if (!cfg.routingEnabled) {
    // Legacy behavior: cloud when key + budget allow, else local.
    if (
      !input.forceLocal &&
      !hybridForcesLocal(cwd) &&
      ollamaApiKey() &&
      canAffordPaid(cwd, estimatePaidUsd(paidModel, String(input.prompt || "").length), cfg)
    ) {
      return paidRoute(
        cfg,
        difficulty,
        paidModel,
        estimatePaidUsd(paidModel, String(input.prompt || "").length),
        "routing disabled — cloud key + budget"
      );
    }
    return localRoute(cfg, difficulty, localModel, "routing disabled — local", false);
  }

  if (input.forceLocal || hybridForcesLocal(cwd)) {
    return localRoute(cfg, difficulty, localModel, "forced local (env/profile)", false);
  }

  const degraded = shouldDegradeToLocal(cwd, cfg);
  const mode = hybridMode(cwd);
  const promptChars = String(input.prompt || "").length;
  const est = estimatePaidUsd(paidModel, promptChars);

  // Near / at cap: never paid. Prefer free endpoint if configured, else local.
  if (degraded) {
    if (freeTierConfigured(cfg) && difficulty !== "cheap") {
      return {
        ...freeRoute(cfg, difficulty, "near/at cost cap — free tier"),
        degraded: true,
      };
    }
    return localRoute(
      cfg,
      difficulty,
      localModel,
      mode === "cloud"
        ? "cost cap exhausted — local degradation (cloud mode blocked for paid)"
        : "near/at cost cap — local tier",
      true
    );
  }

  // Cheap tasks always stay local.
  if (difficulty === "cheap") {
    return localRoute(cfg, difficulty, localModel, "cheap task → local", false);
  }

  const paidOk =
    mode !== "local" &&
    Boolean(ollamaApiKey()) &&
    canAffordPaid(cwd, est, cfg);

  // Hybrid mode `cloud`: prefer paid for non-cheap work when the key + budget allow.
  if (mode === "cloud" && paidOk) {
    return paidRoute(
      cfg,
      difficulty,
      paidModel,
      est,
      `${difficulty} → paid (hybrid cloud mode)`
    );
  }

  // Standard (auto): local first; optional free-tier preference via env.
  if (difficulty === "standard") {
    if (
      freeTierConfigured(cfg) &&
      String(process.env.SAM_PREFER_FREE_FOR_STANDARD || "").trim() === "1"
    ) {
      return freeRoute(
        cfg,
        difficulty,
        "standard → free tier (SAM_PREFER_FREE_FOR_STANDARD)"
      );
    }
    return localRoute(cfg, difficulty, localModel, "standard → local", false);
  }

  // Premium (auto): escalate to paid only when affordable + key present; else free → local.
  if (paidOk) {
    return paidRoute(cfg, difficulty, paidModel, est, "premium → paid (budget ok)");
  }
  if (freeTierConfigured(cfg)) {
    return freeRoute(
      cfg,
      difficulty,
      ollamaApiKey()
        ? "premium — paid unaffordable/blocked → free"
        : "premium — no cloud key → free"
    );
  }
  return localRoute(
    cfg,
    difficulty,
    localModel,
    "premium — no paid/free available → local",
    false
  );
}

/**
 * Map a route into ChatOllama-compatible constructor options (no network).
 */
export function routeToChatOptions(route: ModelRoute): {
  baseUrl: string;
  model: string;
  headers?: Record<string, string>;
  cloud: boolean;
} {
  return {
    baseUrl: route.baseUrl,
    model: route.model,
    headers: route.headers,
    cloud: route.cloud,
  };
}
