/**
 * Resolve and invoke the configurable 'quick' local Ollama role.
 */
import { ChatOllama } from "@langchain/ollama";
import {
  getRoleConfig,
  resolveRoleModels,
} from "../../agency/teamConfig.js";
import {
  recordUsage,
  assertWithinCostCap,
} from "../costLedger.js";
import { resolveModelRoute } from "../cost/index.js";
import { appendAudit } from "../trust/auditLog.js";
import { languageReplyDirective, detectUserLanguage } from "./language.js";

export const DEFAULT_QUICK_LOCAL_MODEL = "qwen2.5:1.5b";
export const QUICK_ROLE_ID = "quick";

export type QuickModelCall = {
  text: string;
  model: string;
  cloud: boolean;
  costUsd: number;
  baseUrl: string;
};

function cheapestLocalFallback(cwd: string): string {
  try {
    const ceo = resolveRoleModels("ceo_router", cwd);
    if (ceo.local) return ceo.local;
  } catch {
    /* ignore */
  }
  return (
    String(process.env.CEO_MODEL || "").trim() ||
    String(process.env.SAM_LOCAL_MODEL || "").trim() ||
    DEFAULT_QUICK_LOCAL_MODEL
  );
}

/** Resolve quick-role local model (team.json → env → cheapest fallback). */
export function resolveQuickModel(cwd: string = process.cwd()): {
  local: string;
  cloud: string;
  free: string | null;
  prefersCloud: boolean;
} {
  try {
    const role = getRoleConfig(QUICK_ROLE_ID, cwd);
    if (role) {
      const models = resolveRoleModels(QUICK_ROLE_ID, cwd);
      return {
        local: models.local || DEFAULT_QUICK_LOCAL_MODEL,
        cloud: models.cloud || "gemma4:cloud",
        free: models.free || null,
        prefersCloud: role.prefersCloud === true,
      };
    }
  } catch {
    /* fall through */
  }
  return {
    local: cheapestLocalFallback(cwd),
    cloud: "gemma4:cloud",
    free: null,
    prefersCloud: false,
  };
}

/**
 * One short local (or configured) Ollama call for quick/web summarization.
 * Falls back to cheapest local when Ollama cloud is unavailable / cap blocks.
 */
export async function invokeQuickModel(input: {
  prompt: string;
  system?: string;
  cwd?: string;
  numPredict?: number;
  temperature?: number;
  runId?: string;
  /** Prefer cloud when configured and allowed. */
  allowCloud?: boolean;
}): Promise<QuickModelCall> {
  const cwd = input.cwd || process.cwd();
  const cfg = resolveQuickModel(cwd);
  const route = resolveModelRoute({
    cwd,
    role: QUICK_ROLE_ID,
    forceCheap: true,
    forceLocal: input.allowCloud === true ? false : true,
    localModel: cfg.local,
    cloudModel: cfg.cloud,
    freeModel: cfg.free || undefined,
    prefersCloud: input.allowCloud === true ? cfg.prefersCloud : false,
  });

  // Cap: never start a paid call that would exceed
  if (route.cloud && route.estimatedUsd > 0) {
    assertWithinCostCap(cwd, route.estimatedUsd);
  }

  const model = new ChatOllama({
    baseUrl: route.baseUrl,
    ...(route.headers ? { headers: route.headers } : {}),
    model: route.model,
    temperature: input.temperature ?? 0.4,
    think: false,
    numPredict: input.numPredict ?? 256,
    numCtx: 4096,
  });

  const lang = detectUserLanguage(input.prompt);
  const system =
    input.system ||
    [
      "You are a helpful assistant for Sam-Harness.",
      languageReplyDirective(lang),
    ].join("\n");

  const fullPrompt = `${system}\n\nUser:\n${input.prompt}`;
  let text = "";
  try {
    const res = await model.invoke(fullPrompt);
    text = typeof res.content === "string" ? res.content : String(res.content ?? "");
  } catch (e: any) {
    // Fallback: cheapest local if primary failed (e.g. model missing)
    if (route.model !== cfg.local || route.cloud) {
      const localRoute = resolveModelRoute({
        cwd,
        role: QUICK_ROLE_ID,
        forceCheap: true,
        forceLocal: true,
        localModel: cheapestLocalFallback(cwd),
      });
      const fallback = new ChatOllama({
        baseUrl: localRoute.baseUrl,
        model: localRoute.model,
        temperature: input.temperature ?? 0.4,
        think: false,
        numPredict: input.numPredict ?? 256,
        numCtx: 4096,
      });
      const res = await fallback.invoke(fullPrompt);
      text =
        typeof res.content === "string" ? res.content : String(res.content ?? "");
      const usage = recordUsage(cwd, {
        model: localRoute.model,
        inputTokens: Math.ceil(fullPrompt.length / 4),
        outputTokens: Math.ceil(text.length / 4),
        costUsd: 0,
        cloud: false,
        runId: input.runId,
      });
      try {
        appendAudit({
          category: "cost",
          action: "quick_path.model",
          runId: input.runId,
          detail: {
            model: localRoute.model,
            fallback: true,
            primaryError: e?.message || String(e),
          },
        });
      } catch {
        /* ignore */
      }
      return {
        text: text.trim(),
        model: localRoute.model,
        cloud: false,
        costUsd: usage.costUsd || 0,
        baseUrl: localRoute.baseUrl,
      };
    }
    throw e;
  }

  const usage = recordUsage(cwd, {
    model: route.model,
    inputTokens: Math.ceil(fullPrompt.length / 4),
    outputTokens: Math.ceil(text.length / 4),
    costUsd: route.cloud ? route.estimatedUsd : 0,
    cloud: route.cloud,
    runId: input.runId,
  });

  try {
    appendAudit({
      category: "cost",
      action: "quick_path.model",
      runId: input.runId,
      detail: {
        model: route.model,
        cloud: route.cloud,
        tier: route.tier,
        costUsd: usage.costUsd,
      },
    });
  } catch {
    /* ignore */
  }

  return {
    text: text.trim(),
    model: route.model,
    cloud: route.cloud,
    costUsd: usage.costUsd || 0,
    baseUrl: route.baseUrl,
  };
}

/** Tiny classifier prompt for ambiguous intents. */
export async function modelClassifyIntent(
  prompt: string,
  cwd: string = process.cwd()
): Promise<"smalltalk" | "simple_question" | "web_research" | "task" | null> {
  try {
    const call = await invokeQuickModel({
      cwd,
      numPredict: 16,
      temperature: 0,
      prompt: [
        "Classify the user message into EXACTLY one label:",
        "smalltalk | simple_question | web_research | task",
        "Rules:",
        "- smalltalk: greetings, thanks, bye",
        "- simple_question: short factual/definition question, no tools",
        "- web_research: needs current web info / search",
        "- task: code, files, desktop, multi-step agency work",
        "Reply with only the label.",
        "",
        `Message: ${prompt.slice(0, 500)}`,
      ].join("\n"),
      system: "You are a strict intent classifier. Reply with one label only.",
    });
    const label = call.text.trim().toLowerCase().replace(/[^a-z_]/g, "");
    if (
      label === "smalltalk" ||
      label === "simple_question" ||
      label === "web_research" ||
      label === "task"
    ) {
      return label;
    }
    // fuzzy
    if (label.includes("small")) return "smalltalk";
    if (label.includes("web")) return "web_research";
    if (label.includes("simple") || label.includes("question")) return "simple_question";
    if (label.includes("task")) return "task";
    return null;
  } catch {
    return null;
  }
}
