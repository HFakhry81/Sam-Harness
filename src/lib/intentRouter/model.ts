/**
 * Cheap local model helpers for intent triage + chat/research replies.
 * Models for triage must stay <=3B (default qwen2.5:1.5b).
 * Ambiguous triage only — short timeout; never used for deterministic greetings.
 */
import {
  invokeQuickModel,
  resolveQuickModel,
  DEFAULT_QUICK_LOCAL_MODEL,
  QUICK_ROLE_ID,
} from "../quickPath/quickModel.js";
import type { IntentModelOutput, IntentRoute } from "./types.js";
import { isHermeticIntentMode } from "./classify.js";

export {
  invokeQuickModel,
  resolveQuickModel,
  DEFAULT_QUICK_LOCAL_MODEL,
  QUICK_ROLE_ID,
};

/** Short wall-clock budget for ambiguous-intent model triage (ms). */
export const CLASSIFIER_TIMEOUT_MS = 1500;

/** Wall-clock budget for ordinary local chat model replies (ms). */
export const CHAT_MODEL_TIMEOUT_MS = 30_000;
export const CLOUD_MODEL_TIMEOUT_MS = 60_000;

const ALLOWED: IntentRoute[] = ["chat", "research", "task", "complex", "clarify"];

export function parseStructuredIntentOutput(text: string): IntentModelOutput | null {
  const raw = String(text || "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      action?: unknown;
      query?: unknown;
      question?: unknown;
      options?: unknown;
    };
    const actions: Record<string, IntentRoute> = {
      chat: "chat",
      search_web: "research",
      research: "research",
      run_task: "task",
      task: "task",
      run_agency: "complex",
      complex: "complex",
      ask_clarification: "clarify",
      clarify: "clarify",
    };
    const route = actions[String(parsed.action || "").toLowerCase()];
    if (!route) return null;
    return {
      route,
      ...(route === "research" && typeof parsed.query === "string"
        ? { searchQuery: parsed.query.trim().slice(0, 300) }
        : {}),
      ...(route === "clarify" && typeof parsed.question === "string"
        ? { clarifyQuestion: parsed.question.trim().slice(0, 500) }
        : {}),
      ...(route === "clarify" && Array.isArray(parsed.options)
        ? {
            clarifyOptions: parsed.options
              .filter((item): item is string => typeof item === "string")
              .map((item) => item.trim().slice(0, 120))
              .filter(Boolean)
              .slice(0, 4),
          }
        : {}),
    };
  } catch {
    return null;
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = "timeout"
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} after ${ms}ms`)),
          ms
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Tiny classifier for ambiguous prompts. Returns one IntentRoute or null.
 * Uses the quick role local model only (forceLocal). Skipped in hermetic mode.
 */
export async function modelClassifyIntentRoute(
  prompt: string,
  cwd: string = process.cwd()
): Promise<IntentModelOutput | null> {
  if (isHermeticIntentMode()) return null;
  try {
    const call = await withTimeout(
      invokeQuickModel({
        cwd,
        numPredict: 96,
        temperature: 0,
        allowCloud: false,
        prompt: [
          "Return one JSON object with this schema:",
          '{"action":"chat|search_web|run_task|run_agency|ask_clarification","query":"","question":"","options":[]}',
          "Rules:",
          "- chat: ordinary conversation and questions",
          "- search_web: needs current information; put a concise search query in query",
          "- run_task: one clearly requested Sam-Harness operation",
          "- run_agency: clearly requested multi-step implementation or analysis",
          "- ask_clarification: intent or required details are ambiguous; provide a question and up to 4 short options",
          "Return valid JSON only. Do not execute anything.",
          "",
          `Message: ${prompt.slice(0, 500)}`,
        ].join("\n"),
        system: "You are Sam-Harness's strict intent router. Return only the requested JSON object.",
      }),
      CLASSIFIER_TIMEOUT_MS,
      "intent classifier"
    );
    const raw = call.text.trim();
    const structured = parseStructuredIntentOutput(raw);
    if (structured) return structured;
    const label = raw.toLowerCase().replace(/[^a-z_]/g, "");
    if ((ALLOWED as string[]).includes(label)) return { route: label as IntentRoute };
    if (label.includes("chat") || label.includes("small") || label.includes("simple")) {
      return { route: "chat" };
    }
    if (label.includes("web") || label.includes("research")) return { route: "research" };
    if (label.includes("clar")) return { route: "clarify" };
    if (label.includes("complex") || label.includes("agency") || label.includes("audit")) {
      return { route: "complex" };
    }
    if (label.includes("task")) return { route: "task" };
    return null;
  } catch {
    return null;
  }
}
