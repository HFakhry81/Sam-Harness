/**
 * Phase 5 — near-zero cost configuration (env + sensible defaults).
 * Phase 9 — smart multi-key rotation for free-tier APIs.
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

/** Priority order for API key rotation (comma-separated tokens). */
function apiKeyPriority(): string[] {
  const raw = String(process.env.SAM_API_KEY_PRIORITY || "local,groq,gemini,openrouter").trim();
  return raw ? raw.split(","").map(s => s.trim()).filter(s => s) : ["local", "groq", "gemini", "openrouter"];
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
  /** API key rotation order: local,groq,gemini,openrouter */
  apiKeyPriority: string[];
};

/** Map a provider name to its base URL and default free model. */
type ProviderConfig = {
  name: string;
  baseUrl: string;
  defaultModel: string;
  /** Check if this provider returned a rate-limit error. */
  isRateLimitError(err: any): boolean;
};

/** Pre-configured free-tier providers in rotation order. */
const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  local: {
    name: "local",
    baseUrl: "",
    defaultModel: "",
    isRateLimitError: () => false, // local never gives rate limits
  },
  groq: {
    name: "groq",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    isRateLimitError: (err: any) =>
      /rate limit|too many requests|429/.test(
        String(err?.message || err?.error?.message || "")
      ),
  },
  gemini: {
    name: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-1.5-flash",
    isRateLimitError: (err: any) =>
      /rate limit|too many requests|429/.test(
        String(err?.message || err?.error?.message || "")
      ),
  },
  openrouter: {
    name: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "google/nvidia-nemotron-3-ultra:free",
    isRateLimitError: (err: any) =>
      /rate limit|too many requests|429/.test(
        String(err?.message || err?.error?.message || "")
      ),
  },
};

/**
 * Try each API key in the rotation order until success or exhaustion.
 * On rate-limit errors, automatically forward to the next provider.
 * Returns the successful route or the last error encountered.
 */
export async function tryRotateProviders<
  T,
>(
  cwd: string,
  fn: (provider: keyof typeof PROVIDER_CONFIGS, apiKey: string, model: string) => Promise<T>,
  input: string,
  fallback: T
): Promise<{ success: true; result: T } | { success: false; error: any }> {
  const priority = apiKeyPriority();
  let lastError: any = null;

  for (const provider of priority) {
    const cfg = PROVIDER_CONFIGS[provider];
    if (!cfg) continue;

    // Get the API key for this provider
    let apiKey = "";
    switch (provider) {
      case "local":
        apiKey = ""; // local doesn't need a key
        break;
      case "groq":
        apiKey = String(process.env.SAM_GROQ_API_KEY || "").trim();
        break;
      case "gemini":
        apiKey = String(process.env.SAM_GEMINI_API_KEY || "").trim();
        break;
      case "openrouter":
        apiKey = String(process.env.SAM_OPENROUTER_API_KEY || "").trim();
        break;
    }

    if (provider !== "local" && !apiKey) {
      // Skip this provider if no key is configured
      continue;
    }

    // Use the default model or fallback to a role-specific free model
    const model = cfg.defaultModel;

    try {
      const result = await fn(provider, apiKey, model);
      return { success: true, result };
    } catch (err: any) {
      lastError = err;

      // Check if this is a rate-limit error and we have more providers to try
      if (cfg.isRateLimitError(err) && provider !== priority[priority.length - 1]) {
        // Log and continue to next provider
        // In a real implementation, we'd log this
        continue;
      }

      // Not a rate limit error, or no more providers - stop trying
      return { success: false, error: err };
    }
  }

  return { success: false, error: lastError };
}

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
    apiKeyPriority: apiKeyPriority(),
  };
}

/** Test helper — reload is always live from process.env. */
export function __costOptConfigSnapshot(): CostOptConfig {
  return loadCostOptConfig();
}
