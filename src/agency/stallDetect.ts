/**
 * Detect stalled remediation loops: identical or near-identical strategy drafts.
 * Two consecutive no-progress loops → structured failure / early stop.
 */
import * as crypto from "crypto";

export const STALL_SIMILARITY_THRESHOLD = 0.95;

export type StallReport = {
  stalled: boolean;
  identical: boolean;
  similarity: number;
  hashA: string;
  hashB: string;
  reason: string;
};

export function draftHash(text: string): string {
  return crypto
    .createHash("sha256")
    .update(normalizeForCompare(text))
    .digest("hex")
    .slice(0, 16);
}

/** Strip volatile HTML comments / whitespace for stable comparison. */
export function normalizeForCompare(text: string): string {
  return String(text || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .toLowerCase();
}

/**
 * Jaccard similarity over word bigrams (fast, good for near-copy detection).
 */
export function draftSimilarity(a: string, b: string): number {
  const na = normalizeForCompare(a);
  const nb = normalizeForCompare(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const grams = (s: string): Set<string> => {
    const words = s.split(/\s+/).filter(Boolean);
    const out = new Set<string>();
    if (words.length < 2) {
      for (const w of words) out.add(w);
      return out;
    }
    for (let i = 0; i + 1 < words.length; i++) {
      out.add(`${words[i]} ${words[i + 1]}`);
    }
    return out;
  };
  const A = grams(na);
  const B = grams(nb);
  let inter = 0;
  for (const g of A) if (B.has(g)) inter += 1;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

export function detectStall(
  previous: string | null | undefined,
  next: string,
  threshold = STALL_SIMILARITY_THRESHOLD
): StallReport {
  const hashB = draftHash(next);
  if (!previous) {
    return {
      stalled: false,
      identical: false,
      similarity: 0,
      hashA: "",
      hashB,
      reason: "no prior draft",
    };
  }
  const hashA = draftHash(previous);
  const identical = hashA === hashB;
  const similarity = identical ? 1 : draftSimilarity(previous, next);
  const stalled = identical || similarity >= threshold;
  return {
    stalled,
    identical,
    similarity,
    hashA,
    hashB,
    reason: stalled
      ? identical
        ? `identical draft hash=${hashB}`
        : `near-identical similarity=${similarity.toFixed(3)} >= ${threshold}`
      : `progress similarity=${similarity.toFixed(3)}`,
  };
}

export type StallTrackerState = {
  consecutiveStalls: number;
  lastHash: string;
};

export function createStallTracker(): StallTrackerState {
  return { consecutiveStalls: 0, lastHash: "" };
}

export function recordStallResult(
  tracker: StallTrackerState,
  report: StallReport
): StallTrackerState {
  if (report.stalled) {
    return {
      consecutiveStalls: tracker.consecutiveStalls + 1,
      lastHash: report.hashB,
    };
  }
  return { consecutiveStalls: 0, lastHash: report.hashB };
}

/** Stop early after this many consecutive no-progress loops. */
export const MAX_CONSECUTIVE_STALLS = 2;
