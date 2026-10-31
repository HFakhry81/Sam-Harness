/**
 * Detect degenerate repeated lines / n-grams in long-form artifacts.
 * Ollama repeat_penalty helper + regenerate-once policy.
 */
export type RepetitionReport = {
  ok: boolean;
  score: number; // 0 = clean, 1 = fully degenerate
  reason: string;
  repeatedLine?: string;
};

/** Fraction of lines that are duplicates of another line (len>=20). */
export function detectRepetition(text: string): RepetitionReport {
  const lines = String(text || "")
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
  const words = String(text || "").toLowerCase().split(/\s+/).filter(Boolean);
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
