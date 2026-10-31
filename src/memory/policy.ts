/**
 * Small-model policy for self-learning helpers.
 * Models <=3B may ONLY be used for simple triage/classification/extraction.
 * Planning, review, translation, and research must never use them.
 * Default: deterministic logic — no extra paid calls; respect $0.50 cost cap.
 */
import { parseModelSizeB } from "../agency/modelPolicy.js";

/** Tasks that may use a <=3B local model. */
export const SMALL_MODEL_OK_TASKS = new Set([
  "triage",
  "classification",
  "extraction",
]);

/** Tasks that must never use a <=3B model. */
export const SMALL_MODEL_FORBIDDEN_TASKS = new Set([
  "planning",
  "review",
  "translation",
  "research",
  "strategist",
  "auditor",
  "architect",
]);

export function isSmallLocalModel(model: string): boolean {
  const b = parseModelSizeB(model);
  if (b == null) return false;
  return b > 0 && b <= 3;
}

export type SmallModelGate = {
  allowed: boolean;
  reason: string;
};

/**
 * Gate: refuse small models for non-simple tasks.
 * Prefer deterministic path (allowed=false for LLM) unless task is simple.
 */
export function allowSmallModelForTask(
  task: string,
  model: string
): SmallModelGate {
  const t = String(task || "")
    .trim()
    .toLowerCase();
  if (!isSmallLocalModel(model)) {
    return { allowed: true, reason: "model is not <=3B" };
  }
  if (SMALL_MODEL_FORBIDDEN_TASKS.has(t)) {
    return {
      allowed: false,
      reason: `model <=3B forbidden for task '${t}' (use deterministic logic or larger/cloud model within cost cap)`,
    };
  }
  if (SMALL_MODEL_OK_TASKS.has(t)) {
    return { allowed: true, reason: `simple task '${t}' may use <=3B` };
  }
  return {
    allowed: false,
    reason: `task '${t}' is not in the simple allow-list; default to deterministic logic (no paid call)`,
  };
}

/**
 * Memory pipeline always prefers deterministic ingest/retrieve/promote.
 * This helper documents that LLM triage is optional and capped.
 */
export function memoryUsesDeterministicDefault(): boolean {
  return String(process.env.SAM_MEMORY_ALLOW_SMALL_LLM || "").trim() !== "1";
}
