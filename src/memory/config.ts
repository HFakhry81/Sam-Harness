/**
 * Configurable thresholds for self-learning memory.
 * Defaults favor deterministic logic; no paid LLM calls.
 */

function envNum(key: string, fallback: number): number {
  const raw = String(process.env[key] ?? "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export type MemoryConfig = {
  /** Similarity >= this → exact/near-verbatim duplicate (increment hit only). */
  duplicateThreshold: number;
  /**
   * Similarity in [variantThreshold, duplicateThreshold) → store as variant
   * linked to parent. Below variantThreshold → new unlinked entry.
   */
  variantThreshold: number;
  /** Hits required before a lesson is promoted to a pre-check rule. */
  promoteHitThreshold: number;
  /** Max entries injected into strategist/auditor prompts. */
  retrieveLimit: number;
  /** Approximate token budget for the injected memory block. */
  retrieveTokenBudget: number;
  /** Soft cap on stored lessons / skills each. */
  maxEntriesPerKind: number;
};

export function loadMemoryConfig(overrides?: Partial<MemoryConfig>): MemoryConfig {
  const duplicateThreshold = Math.min(
    1,
    Math.max(0.5, envNum("SAM_MEMORY_DUP_THRESHOLD", 0.92))
  );
  let variantThreshold = Math.min(
    duplicateThreshold - 0.01,
    Math.max(0.3, envNum("SAM_MEMORY_VARIANT_THRESHOLD", 0.7))
  );
  if (variantThreshold >= duplicateThreshold) {
    variantThreshold = Math.max(0.3, duplicateThreshold - 0.1);
  }
  return {
    duplicateThreshold,
    variantThreshold,
    promoteHitThreshold: Math.max(
      2,
      Math.floor(envNum("SAM_MEMORY_PROMOTE_HITS", 3))
    ),
    retrieveLimit: Math.max(1, Math.floor(envNum("SAM_MEMORY_RETRIEVE_LIMIT", 8))),
    retrieveTokenBudget: Math.max(
      200,
      Math.floor(envNum("SAM_MEMORY_TOKEN_BUDGET", 900))
    ),
    maxEntriesPerKind: Math.max(
      20,
      Math.floor(envNum("SAM_MEMORY_MAX_ENTRIES", 500))
    ),
    ...overrides,
  };
}
