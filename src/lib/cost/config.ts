/**
 * Phase 5 — near-zero cost configuration (env + sensible defaults).
 */
function envStr(key: string, fallback = ""): string {
  const v = String(process.env[key] ?? "").trim();
  return v || fallback;
}

function envBool(key: string, fallback: boolean): boolean {
  const raw = String(process.env[key] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  return fallback;
}

function envNum(key: string, fallback: number): number {
  const raw = String(process.env[key] ?? "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export type CostOptConfig = {
  /** Master switch for difficulty-based routing (default on). */
  routingEnabled: boolean;
  /** Exact prompt/response cache in SQLite (default on). */
  cacheEnabled: boolean;
  /** Ask providers that support it to reuse prompt prefixes (default on). */
  providerPromptCache: boolean;
  /** Cache entry TTL in ms (default 24h). */
  cacheTtlMs: number;
  /** Max cache rows retained per tenant (default 500). */
  cacheMaxEntries: number;
  /**
   * When remaining budget / cap falls at or below this ratio, force local tier.
   * Default 0.15 → degrade once ≥85% of the daily cap is spent.
   */
  nearCapRemainingRatio: number;
  /** Max prompt chars before compaction (default 24_000). */
  contextMaxChars: number;
  /** Soft target after compaction (default 16_000). */
  contextTargetChars: number;
  /** Local / Ollama OpenAI-compatible base URL. */
  localBaseUrl: string;
  localModel: string;
  /** Optional free-tier OpenAI-compatible endpoint (0 USD when used). */
  freeBaseUrl: string;
  freeApiKey: string;
  freeModel: string;
  /** Paid / cloud Ollama host. */
  paidBaseUrl: string;
  paidModel: string;
  /** Confidence below this triggers escalate-on-retry (default 0.55). */
  escalateConfidenceBelow: number;
};

export function loadCostOptConfig(): CostOptConfig {
  return {
    routingEnabled: envBool("SAM_ROUTING_ENABLED", true),
    cacheEnabled: envBool("SAM_CACHE_ENABLED", true),
    providerPromptCache: envBool("SAM_PROVIDER_PROMPT_CACHE", true),
    cacheTtlMs: Math.max(60_000, envNum("SAM_CACHE_TTL_MS", 86_400_000)),
    cacheMaxEntries: Math.max(10, Math.floor(envNum("SAM_CACHE_MAX_ENTRIES", 500))),
    nearCapRemainingRatio: Math.min(
      1,
      Math.max(0, envNum("SAM_COST_NEAR_CAP_RATIO", 0.15))
    ),
    contextMaxChars: Math.max(2000, Math.floor(envNum("SAM_CONTEXT_MAX_CHARS", 24_000))),
    contextTargetChars: Math.max(
      1000,
      Math.floor(envNum("SAM_CONTEXT_TARGET_CHARS", 16_000))
    ),
    localBaseUrl: envStr("SAM_LOCAL_BASE_URL", "http://localhost:11434"),
    localModel: envStr("SAM_LOCAL_MODEL", envStr("CEO_MODEL", "qwen2.5-coder:1.5b")),
    freeBaseUrl: envStr("SAM_FREE_BASE_URL", ""),
    freeApiKey: envStr("SAM_FREE_API_KEY", ""),
    freeModel: envStr("SAM_FREE_MODEL", ""),
    paidBaseUrl: envStr("SAM_PAID_BASE_URL", "https://ollama.com"),
    paidModel: envStr("SAM_PAID_MODEL", "gemma4:cloud"),
    escalateConfidenceBelow: Math.min(
      1,
      Math.max(0, envNum("SAM_ESCALATE_CONFIDENCE_BELOW", 0.55))
    ),
  };
}

/** Test helper — reload is always live from process.env. */
export function __costOptConfigSnapshot(): CostOptConfig {
  return loadCostOptConfig();
}
