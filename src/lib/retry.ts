/**
 * Unified retry with exponential backoff + jitter for idempotent steps.
 */
export type RetryOptions = {
  attempts?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  label?: string;
  /** Return true to retry this error. Default: network/5xx-ish / timeout. */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
  /** Abort signal / cancel predicate */
  isCancelled?: () => boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function defaultShouldRetry(err: unknown): boolean {
  const msg = String((err as Error)?.message || err || "").toLowerCase();
  const code = String((err as { code?: string })?.code || "").toLowerCase();
  if (code === "cost_cap_exceeded") return false;
  if (code === "ecancelled" || msg.includes("cancelled")) return false;
  if (
    code.includes("econn") ||
    code.includes("etimedout") ||
    code.includes("eai_again") ||
    code.includes("enotfound") ||
    msg.includes("timeout") ||
    msg.includes("fetch failed") ||
    msg.includes("socket") ||
    msg.includes("429") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504")
  ) {
    return true;
  }
  return false;
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const minDelay = opts.minDelayMs ?? 200;
  const maxDelay = opts.maxDelayMs ?? 8_000;
  const factor = opts.factor ?? 2;
  const shouldRetry = opts.shouldRetry ?? ((e) => defaultShouldRetry(e));

  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (opts.isCancelled?.()) {
      const err = new Error("Operation cancelled");
      (err as { code?: string }).code = "ECANCELLED";
      throw err;
    }
    try {
      return await fn(attempt);
    } catch (e) {
      lastErr = e;
      if (attempt >= attempts || !shouldRetry(e, attempt)) throw e;
      const expo = minDelay * Math.pow(factor, attempt - 1);
      const jitter = Math.random() * minDelay;
      const delay = Math.min(maxDelay, Math.round(expo + jitter));
      opts.onRetry?.(e, attempt, delay);
      await sleep(delay);
    }
  }
  throw lastErr;
}

/** Mark a step idempotent by key — skips re-exec when already completed in meta set. */
export function rememberIdempotentStep(
  done: Set<string>,
  key: string
): { skip: boolean; mark: () => void } {
  if (done.has(key)) return { skip: true, mark: () => undefined };
  return {
    skip: false,
    mark: () => {
      done.add(key);
    },
  };
}
