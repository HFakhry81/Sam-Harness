/**
 * Cheap local model helpers for intent triage + chat/research replies.
 * Models for triage must stay <=3B (default qwen2.5:1.5b).
 */
import {
  invokeQuickModel,
  resolveQuickModel,
  DEFAULT_QUICK_LOCAL_MODEL,
  QUICK_ROLE_ID,
} from "../quickPath/quickModel.js";
import type { IntentRoute } from "./types.js";

export {
  invokeQuickModel,
  resolveQuickModel,
  DEFAULT_QUICK_LOCAL_MODEL,
  QUICK_ROLE_ID,
};

const ALLOWED: IntentRoute[] = ["chat", "research", "task", "complex", "clarify"];

/**
 * Tiny classifier for ambiguous prompts. Returns one IntentRoute or null.
 * Uses the quick role local model only (forceLocal).
 */
export async function modelClassifyIntentRoute(
  prompt: string,
  cwd: string = process.cwd()
): Promise<IntentRoute | null> {
  try {
    const call = await invokeQuickModel({
      cwd,
      numPredict: 12,
      temperature: 0,
      allowCloud: false,
      prompt: [
        "Classify the user message into EXACTLY one label:",
        "chat | research | task | complex | clarify",
        "Rules:",
        "- chat: greetings, thanks, name intros, simple questions, small talk",
        "- research: needs web/current info / search",
        "- task: one simple file/desktop/command action",
        "- complex: multi-step, architecture, audit a path, build/fix systems",
        "- clarify: too ambiguous to choose chat vs task safely",
        "Reply with only the label.",
        "",
        `Message: ${prompt.slice(0, 500)}`,
      ].join("\n"),
      system: "You are a strict intent classifier. Reply with one label only.",
    });
    const label = call.text
      .trim()
      .toLowerCase()
      .replace(/[^a-z_]/g, "");
    if ((ALLOWED as string[]).includes(label)) {
      return label as IntentRoute;
    }
    if (label.includes("chat") || label.includes("small") || label.includes("simple")) {
      return "chat";
    }
    if (label.includes("web") || label.includes("research")) return "research";
    if (label.includes("clar")) return "clarify";
    if (label.includes("complex") || label.includes("agency") || label.includes("audit")) {
      return "complex";
    }
    if (label.includes("task")) return "task";
    return null;
  } catch {
    return null;
  }
}
