/**
 * Shared tuning for local Ollama calls.
 *
 * CPU-only hosts (VMs, servers without a GPU) are memory-bandwidth bound:
 * keeping the model resident, pinning one context size, and using all
 * logical cores avoids repeated 10–15s reloads and cache loss.
 *
 * Override with:
 *   SAM_LOCAL_NUM_CTX, SAM_LOCAL_NUM_THREAD, SAM_LOCAL_NUM_BATCH,
 *   SAM_LOCAL_KEEP_ALIVE, SAM_LOCAL_NUM_PREDICT
 */
import os from "node:os";

export type LocalOllamaOptions = {
  numCtx: number;
  numThread: number;
  numBatch: number;
  /** Cap for short calls (routing, chat, extraction). */
  numPredict: number;
  /** Cap for long-form roles (strategy, audit, architecture, help). */
  numPredictLongForm: number;
  keepAlive: string | number;
};

function envInt(name: string, fallback: number): number {
  const raw = Number(String(process.env[name] || "").trim());
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

function keepAliveValue(): string | number {
  const raw = String(process.env.SAM_LOCAL_KEEP_ALIVE ?? "-1").trim();
  if (!raw) return -1;
  const n = Number(raw);
  return Number.isFinite(n) ? n : raw;
}

export function localOllamaOptions(): LocalOllamaOptions {
  const logical = os.cpus()?.length || 8;
  // Cap at 24 so large servers do not oversubscribe a single local model.
  const defaultThreads = Math.max(1, Math.min(24, logical));
  return {
    // 16k keeps medium threads + evidence packs intact for 27B local roles.
    // Lower it (4096-8192) when RAM is tight; the chat history budget adapts.
    numCtx: envInt("SAM_LOCAL_NUM_CTX", 16_384),
    numThread: envInt("SAM_LOCAL_NUM_THREAD", defaultThreads),
    numBatch: envInt("SAM_LOCAL_NUM_BATCH", 2048),
    // CPU-only reasoning models spend most tokens on hidden thinking. Cap the
    // total so a slow local call cannot run for 5-10 minutes per role.
    numPredict: envInt("SAM_LOCAL_NUM_PREDICT", 768),
    // Long-form roles need room for a full strategy/audit document. Keep a
    // separate ceiling so quick replies stay fast without truncating reviews.
    numPredictLongForm: envInt("SAM_LOCAL_LONG_PREDICT", 2_048),
    keepAlive: keepAliveValue(),
  };
}

/**
 * Clamp a requested output budget to the local model ceiling.
 * Short calls keep the low cap; long-form roles get a larger one.
 */
export function capLocalNumPredict(
  requested: number,
  longForm = false
): number {
  const opts = localOllamaOptions();
  const cap = longForm ? opts.numPredictLongForm : opts.numPredict;
  const wanted = Number.isFinite(requested) ? Math.floor(requested) : 1;
  return Math.max(1, Math.min(wanted, cap));
}
