/**
 * Lexical similarity for memory dedup bands.
 * Uses token Jaccard and character-shingle Jaccard; returns the max of both.
 */
import { fingerprintText, tokenizeNormalized } from "./normalize.js";

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) {
    if (b.has(x)) inter += 1;
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Character n-gram shingles over the normalized string (no spaces). */
export function shingles(normalized: string, n = 3): Set<string> {
  const s = String(normalized || "").replace(/\s+/g, "");
  const out = new Set<string>();
  if (s.length < n) {
    if (s) out.add(s);
    return out;
  }
  for (let i = 0; i + n <= s.length; i++) {
    out.add(s.slice(i, i + n));
  }
  return out;
}

export function tokenJaccard(a: string, b: string): number {
  const na = fingerprintText(a);
  const nb = fingerprintText(b);
  if (na === nb) return 1;
  const ta = new Set(tokenizeNormalized(na));
  const tb = new Set(tokenizeNormalized(nb));
  return jaccard(ta, tb);
}

export function shingleJaccard(a: string, b: string, n = 3): number {
  const na = fingerprintText(a);
  const nb = fingerprintText(b);
  if (na === nb) return 1;
  return jaccard(shingles(na, n), shingles(nb, n));
}

/**
 * Combined similarity in [0,1]: max(token Jaccard, shingle Jaccard).
 * Exact normalized match → 1.
 */
export function memorySimilarity(a: string, b: string): number {
  const na = fingerprintText(a);
  const nb = fingerprintText(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const tj = tokenJaccard(a, b);
  const sj = shingleJaccard(a, b, 3);
  return Math.max(tj, sj);
}
