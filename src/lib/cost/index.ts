/**
 * Phase 5 — near-zero model cost: routing, caching, compaction, accounting hooks.
 */
export {
  loadCostOptConfig,
  __costOptConfigSnapshot,
  type CostOptConfig,
} from "./config.js";

export {
  classifyDifficulty,
  scoreDifficulty,
  escalateTier,
  type DifficultyTier,
  type DifficultyInput,
} from "./difficulty.js";

export {
  resolveModelRoute,
  routeToChatOptions,
  shouldDegradeToLocal,
  canAffordPaid,
  type ModelRoute,
  type ModelTier,
  type RouteInput,
} from "./router.js";

export {
  compactContext,
  lightNormalize,
  estimateTokensFromChars,
  type CompactOptions,
  type CompactResult,
} from "./compact.js";

export {
  buildCacheKey,
  buildProviderCacheHints,
  getCachedResponse,
  setCachedResponse,
  clearPromptCache,
  promptCacheStats,
  type CacheLookup,
  type ProviderCacheHints,
} from "./promptCache.js";
