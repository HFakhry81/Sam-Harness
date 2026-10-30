/**
 * Phase 5 — context compaction / trimming to cut tokens before LLM calls.
 */

export type CompactOptions = {
  /** Hard max input length; prompts above this are compacted. */
  maxChars: number;
  /** Soft target length after compaction. */
  targetChars: number;
  /** Preserve a head and tail window (system instructions + latest turns). */
  headChars?: number;
  tailChars?: number;
};

export type CompactResult = {
  text: string;
  originalChars: number;
  compactedChars: number;
  truncated: boolean;
  removedChars: number;
};

const DEFAULT_HEAD = 4_000;
const DEFAULT_TAIL = 8_000;

/**
 * Trim oversized prompts while keeping the opening instructions and the
 * most recent trailing context. Middle content is replaced with a marker.
 */
export function compactContext(
  prompt: string,
  opts: CompactOptions
): CompactResult {
  const text = String(prompt || "");
  const originalChars = text.length;
  if (originalChars <= opts.maxChars) {
    return {
      text,
      originalChars,
      compactedChars: originalChars,
      truncated: false,
      removedChars: 0,
    };
  }

  const headChars = Math.max(200, opts.headChars ?? DEFAULT_HEAD);
  const tailChars = Math.max(200, opts.tailChars ?? DEFAULT_TAIL);
  const target = Math.min(opts.targetChars, opts.maxChars);
  const budget = Math.max(500, target);
  const marker = "\n\n…[context compacted to cut tokens]…\n\n";

  let headBudget = Math.min(headChars, Math.floor(budget * 0.35));
  let tailBudget = Math.min(tailChars, budget - headBudget - marker.length);
  if (tailBudget < 200) {
    tailBudget = Math.min(tailChars, Math.floor(budget * 0.55));
    headBudget = Math.max(200, budget - tailBudget - marker.length);
  }

  const head = text.slice(0, headBudget);
  const tail = text.slice(-tailBudget);
  const compacted = head + marker + tail;

  // If still oversized (pathological opts), hard-slice to maxChars.
  const finalText =
    compacted.length <= opts.maxChars
      ? compacted
      : compacted.slice(0, opts.maxChars - 20) + "\n…[truncated]";

  return {
    text: finalText,
    originalChars,
    compactedChars: finalText.length,
    truncated: true,
    removedChars: Math.max(0, originalChars - finalText.length),
  };
}

/**
 * Rough token estimate (≈4 chars/token) for accounting preflight.
 */
export function estimateTokensFromChars(chars: number): number {
  return Math.max(0, Math.ceil(Math.max(0, chars) / 4));
}

/**
 * Drop repeated blank lines and collapse very long runs of whitespace.
 * Safe for code blocks (does not touch indentation of non-empty lines).
 */
export function lightNormalize(prompt: string): string {
  return String(prompt || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}
