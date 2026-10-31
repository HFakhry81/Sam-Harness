/**
 * Detect degenerate repeated lines / n-grams in long-form artifacts.
 * Ollama repeat_penalty helper + regenerate-once policy.
 *
 * Deterministic RTM / Key Findings / REQ status index blocks are EXEMPT —
 * their repeated `| REQ-00N | status |` rows and `REQ-xxx:status` lines are
 * intentional and must never trip strategy degeneration.
 */
export type RepetitionReport = {
  ok: boolean;
  score: number; // 0 = clean, 1 = fully degenerate
  reason: string;
  repeatedLine?: string;
};

/** Strip harness-injected deterministic blocks before repetition scoring. */
export function stripDeterministicBlocksForRepetition(text: string): string {
  return String(text || "")
    .replace(
      /##\s*REQ status index \(deterministic[\s\S]*?(?=\n##\s|\n#\s|$)/gi,
      "\n"
    )
    .replace(
      /##\s*Requirements traceability(?:\s*\(deterministic\))?[\s\S]*?(?=\n##\s|\n#\s|$)/gi,
      "\n"
    )
    .replace(/##\s*Key Findings\b[\s\S]*?(?=\n##\s|\n#\s|$)/gi, "\n")
    .replace(
      /DETERMINISTIC RTM SUMMARY[\s\S]*?(?=\n##\s|\n#\s|$)/gi,
      "\n"
    )
    .replace(/<!--\s*PROMPT_ONLY_DETERMINISTIC_SUMMARY[\s\S]*?-->/gi, "")
    // Table rows and compact id:status tokens left outside headed blocks
    .replace(/^\s*\|\s*REQ[-_]?\d+\b.*$/gim, "")
    .replace(
      /\bREQ[-_]?\d+:(?:implemented|partial|missing|contradicts|unverified|n\/a)\b/gi,
      ""
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Fraction of lines that are duplicates of another line (len>=20). */
export function detectRepetition(text: string): RepetitionReport {
  const cleaned = stripDeterministicBlocksForRepetition(text);
  const lines = cleaned
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 20);
  if (lines.length < 6) {
    return { ok: true, score: 0, reason: "too short to judge" };
  }
  const counts = new Map<string, number>();
  for (const l of lines) {
    counts.set(l, (counts.get(l) || 0) + 1);
  }
  let dupLines = 0;
  let worst = "";
  let worstN = 1;
  for (const [l, n] of counts) {
    if (n >= 3) {
      dupLines += n;
      if (n > worstN) {
        worstN = n;
        worst = l;
      }
    }
  }
  const score = Math.min(1, dupLines / lines.length);

  // Also check long repeated n-gram (same 12-word window thrice)
  const words = cleaned.toLowerCase().split(/\s+/).filter(Boolean);
  let ngramHits = 0;
  if (words.length > 40) {
    const grams = new Map<string, number>();
    for (let i = 0; i + 12 <= words.length; i++) {
      const g = words.slice(i, i + 12).join(" ");
      grams.set(g, (grams.get(g) || 0) + 1);
    }
    for (const n of grams.values()) {
      if (n >= 3) ngramHits += 1;
    }
  }
  const ngramScore = Math.min(1, ngramHits / 5);
  const finalScore = Math.max(score, ngramScore);

  if (finalScore >= 0.35 || worstN >= 5) {
    return {
      ok: false,
      score: finalScore,
      reason: `degenerate repetition detected (line×${worstN}, score=${finalScore.toFixed(2)})`,
      repeatedLine: worst.slice(0, 120),
    };
  }
  return { ok: true, score: finalScore, reason: "ok" };
}

/** Default Ollama repeat_penalty for long-form roles. */
export const LONG_FORM_REPEAT_PENALTY = 1.25;

/**
 * If text is degenerate, caller should regenerate once with a stronger model.
 * Returns which draft to keep.
 */
export function chooseNonDegenerateDraft(
  primary: string,
  fallback: string | null | undefined
): { text: string; usedFallback: boolean; report: RepetitionReport } {
  const report = detectRepetition(primary);
  if (report.ok) return { text: primary, usedFallback: false, report };
  if (fallback && detectRepetition(fallback).ok) {
    return { text: fallback, usedFallback: true, report };
  }
  // Still return primary but flagged
  return { text: primary, usedFallback: false, report };
}
