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
  numPredict: number;
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
    numCtx: envInt("SAM_LOCAL_NUM_CTX", 8192),
    numThread: envInt("SAM_LOCAL_NUM_THREAD", defaultThreads),
    numBatch: envInt("SAM_LOCAL_NUM_BATCH", 2048),
    // CPU-only reasoning models spend most tokens on hidden thinking. Cap the
    // total so a slow local call cannot run for 5-10 minutes per role.
    numPredict: envInt("SAM_LOCAL_NUM_PREDICT", 768),
    keepAlive: keepAliveValue(),
  };
}
