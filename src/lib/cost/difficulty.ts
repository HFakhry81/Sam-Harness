/**
 * Phase 5 — classify LLM task difficulty for model routing.
 *
 * Tiers:
 *   cheap    — routing, short drafts, ops confirmations
 *   standard — most specialist work that can stay local/free
 *   premium  — heavy architecture/audit, low confidence, verification failure
 */
export type DifficultyTier = "cheap" | "standard" | "premium";

export type DifficultyInput = {
  /** Role hint: ceo_router, strategist, auditor, architect, … */
  role?: string;
  /** Prompt / brief text (used for length + complexity keywords). */
  prompt?: string;
  /** Prior confidence score 0..1 (task-spec or verifier). */
  confidence?: number;
  /** True when a previous verify/audit failed and we are retrying. */
  verificationFailed?: boolean;
  /** Caller explicitly asked for heavy/complex analysis. */
  explicitComplexity?: boolean;
  /** Force premium regardless of heuristics. */
  forcePremium?: boolean;
  /** Force cheap/local (e.g. CEO router). */
  forceCheap?: boolean;
};

const PREMIUM_ROLES = new Set([
  "auditor",
  "architect",
  "strategist",
  "coder",
  "reviewer",
]);

const CHEAP_ROLES = new Set([
  "ceo_router",
  "ceo",
  "operator",
  "evidence",
  "router",
]);

const COMPLEX_RE =
  /\b(architect|architecture|security\s*review|deep\s*analy|compare\s+and\s+contrast|multi[- ]?file\s+refactor|system\s+design|threat\s*model|performance\s*audit|level[- ]?3|implement\s+plan)\b|تحليل\s*عميق|مراجعة\s*أمني|تصميم\s*نظام/i;

const SIMPLE_RE =
  /\b(summarize|classify|yes\s*or\s*no|list\s+files|route|short\s+draft|confirm|ping)\b|لخّص|صنف|نعم\s*أو\s*لا/i;

/**
 * Score 0..1 then map to tier. Pure function — no I/O.
 */
export function scoreDifficulty(input: DifficultyInput): number {
  if (input.forcePremium) return 1;
  if (input.forceCheap) return 0;

  let score = 0.35;
  const role = String(input.role || "")
    .trim()
    .toLowerCase();
  if (CHEAP_ROLES.has(role)) score = 0.15;
  // Specialist roles that historically used cloud start at premium so auto-mode
  // can escalate when budget allows; near-cap still forces local via the router.
  if (PREMIUM_ROLES.has(role)) score = Math.max(score, 0.72);

  const prompt = String(input.prompt || "");
  const chars = prompt.length;
  if (chars > 12_000) score += 0.25;
  else if (chars > 4_000) score += 0.12;
  else if (chars > 0 && chars < 400) score -= 0.1;

  if (COMPLEX_RE.test(prompt)) score += 0.25;
  if (SIMPLE_RE.test(prompt)) score -= 0.15;

  if (input.explicitComplexity) score += 0.3;
  if (input.verificationFailed) score += 0.35;

  if (typeof input.confidence === "number" && Number.isFinite(input.confidence)) {
    if (input.confidence < 0.4) score += 0.3;
    else if (input.confidence < 0.55) score += 0.15;
    else if (input.confidence >= 0.85) score -= 0.08;
  }

  // Keep specialist roles at premium floor after soft penalties.
  if (PREMIUM_ROLES.has(role)) score = Math.max(score, 0.72);

  return Math.max(0, Math.min(1, score));
}

export function classifyDifficulty(input: DifficultyInput): DifficultyTier {
  if (input.forcePremium) return "premium";
  if (input.forceCheap) return "cheap";
  const score = scoreDifficulty(input);
  if (score >= 0.7) return "premium";
  if (score <= 0.28) return "cheap";
  return "standard";
}

/** Whether a failed verify/low confidence should escalate one tier. */
export function escalateTier(
  current: DifficultyTier,
  opts: { verificationFailed?: boolean; confidence?: number; threshold?: number }
): DifficultyTier {
  const threshold = opts.threshold ?? 0.55;
  const should =
    Boolean(opts.verificationFailed) ||
    (typeof opts.confidence === "number" && opts.confidence < threshold);
  if (!should) return current;
  if (current === "cheap") return "standard";
  if (current === "standard") return "premium";
  return "premium";
}
