/**
 * Resolve and invoke the configurable 'quick' local Ollama role.
 */
import { ChatOllama } from "@langchain/ollama";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
  type ToolCall,
} from "@langchain/core/messages";
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
import { quickOllamaOptions } from "../ollamaLocal.js";
import {
  historyBudgetForContext,
  trimChatTurns,
  type ChatTurn,
} from "../conversation/context.js";
import { languageReplyDirective, detectUserLanguage } from "./language.js";
import type { BindToolsInput } from "@langchain/core/language_models/chat_models";

export const DEFAULT_QUICK_LOCAL_MODEL = "qwen2.5:1.5b";
export const QUICK_ROLE_ID = "quick";
export type ChatModelPreference = "auto" | "local" | "cloud";

export type QuickModelCall = {
  text: string;
  model: string;
  cloud: boolean;
  costUsd: number;
  baseUrl: string;
  /** Number of replayed turns actually sent (0 = one-shot prompt). */
  historyTurns?: number;
  toolCalls?: ToolCall[];
};

function normalizeLocalOllamaUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    if (url.hostname.toLowerCase() === "localhost") {
      url.hostname = "127.0.0.1";
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return baseUrl;
  }
}

function isGpuMemoryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /out.of.memory|failed to allocate|Vulkan\d* buffer|GPU.*memory/i.test(message);
}

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

export type QuickPromptPayload = {
  prompt: string | BaseMessage[];
  chars: number;
  historyTurns: number;
};

/**
 * Build the invoke payload. With history we send structured chat messages so
 * the model sees real turn boundaries; without history we keep the legacy
 * single-string prompt (cheapest path for one-shot calls).
 */
export function buildQuickPromptPayload(input: {
  system: string;
  prompt: string;
  history?: ReadonlyArray<ChatTurn>;
}): QuickPromptPayload {
  const turns = (input.history || []).filter(
    (turn) =>
      turn &&
      (turn.role === "user" || turn.role === "assistant") &&
      String(turn.content ?? "").trim().length > 0
  );

  if (turns.length === 0) {
    const full = `${input.system}\n\nUser:\n${input.prompt}`;
    return { prompt: full, chars: full.length, historyTurns: 0 };
  }

  const messages: BaseMessage[] = [new SystemMessage(input.system)];
  let chars = input.system.length + input.prompt.length + 32;
  for (const turn of turns) {
    const content = String(turn.content).trim();
    messages.push(
      turn.role === "assistant" ? new AIMessage(content) : new HumanMessage(content)
    );
    chars += content.length + 16;
  }
  messages.push(new HumanMessage(input.prompt));
  return { prompt: messages, chars, historyTurns: turns.length };
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
  /** User-selected model route from the chat interface. */
  modelPreference?: ChatModelPreference;
  /** Chronological (oldest → newest) conversation turns, already bounded. */
  history?: ReadonlyArray<ChatTurn>;
  /** Existing LangChain messages for a tool-call round trip. */
  messages?: ReadonlyArray<BaseMessage>;
  /** Optional function schemas supplied to a model for this invocation. */
  tools?: BindToolsInput[];
}): Promise<QuickModelCall> {
  const cwd = input.cwd || process.cwd();
  const cfg = resolveQuickModel(cwd);
  const preference = input.modelPreference ||
    (input.allowCloud === true ? "auto" : "local");
  const route = resolveModelRoute({
    cwd,
    role: QUICK_ROLE_ID,
    forceCheap: preference === "local",
    forceLocal: preference === "local",
    forceCloud: preference === "cloud",
    localModel: cfg.local,
    cloudModel: cfg.cloud,
    freeModel: cfg.free || undefined,
    prefersCloud: preference === "local" ? false : cfg.prefersCloud,
  });
  if (preference === "cloud" && !route.cloud) {
    throw new Error(`Cloud model unavailable: ${route.reason}`);
  }

  // Cap: never start a paid call that would exceed
  if (route.cloud && route.estimatedUsd > 0) {
    assertWithinCostCap(cwd, route.estimatedUsd);
  }

  const local = route.cloud ? null : quickOllamaOptions();
  const baseUrl = route.cloud
    ? route.baseUrl
    : normalizeLocalOllamaUrl(route.baseUrl);
  const model = new ChatOllama({
    baseUrl,
    ...(route.headers ? { headers: route.headers } : {}),
    model: route.model,
    temperature: input.temperature ?? 0.4,
    think: false,
    numPredict: input.numPredict ?? 256,
    ...(local
      ? {
          numCtx: local.numCtx,
          numThread: local.numThread,
          numBatch: local.numBatch,
          keepAlive: local.keepAlive,
        }
      : { numCtx: 4096 }),
  });

  const lang = detectUserLanguage(input.prompt);
  const system =
    input.system ||
    [
      "You are a helpful assistant for Sam-Harness.",
      languageReplyDirective(lang),
    ].join("\n");

  // Final safety: ensure system + current turn + output still fit the local
  // context window even if the caller passed an unbounded history array.
  const historyBudget = local
    ? historyBudgetForContext({
        numCtx: local.numCtx,
        systemChars: system.length,
        promptChars: input.prompt.length,
        numPredict: input.numPredict ?? 256,
        desiredChars: 24_000,
      })
    : 24_000;
  const history = input.history?.length
    ? trimChatTurns(input.history, { maxChars: historyBudget }).turns
    : [];
  const payload = buildQuickPromptPayload({
    system,
    prompt: input.prompt,
    history,
  });
  const modelInput = input.messages?.length ? [...input.messages] : payload.prompt;
  const promptChars = input.messages?.length
    ? input.messages.reduce(
        (sum, message) => sum + String(message.content ?? "").length + 16,
        0
      )
    : payload.chars;

  let text = "";
  let toolCalls: ToolCall[] = [];
  try {
    const runner = input.tools?.length ? model.bindTools(input.tools) : model;
    const res = await runner.invoke(modelInput);
    text = typeof res.content === "string" ? res.content : String(res.content ?? "");
    toolCalls = res.tool_calls || [];
  } catch (e: any) {
    if (preference === "cloud") {
      throw new Error(`Cloud model request failed: ${e?.message || String(e)}`);
    }
    const gpuMemoryFailure = !route.cloud && isGpuMemoryError(e);
    let primaryError: unknown = e;
    if (gpuMemoryFailure && local) {
      let cpuText: string | undefined;
      let cpuToolCalls: ToolCall[] = [];
      try {
        const cpuModel = new ChatOllama({
          baseUrl,
          model: route.model,
          temperature: input.temperature ?? 0.4,
          think: false,
          numPredict: input.numPredict ?? 256,
          numCtx: Math.min(local.numCtx, 2048),
          numThread: local.numThread,
          numBatch: Math.min(local.numBatch, 128),
          numGpu: 0,
          keepAlive: local.keepAlive,
        });
        const runner = input.tools?.length
          ? cpuModel.bindTools(input.tools)
          : cpuModel;
        const res = await runner.invoke(modelInput);
        cpuText =
          typeof res.content === "string" ? res.content : String(res.content ?? "");
        cpuToolCalls = res.tool_calls || [];
      } catch (cpuError) {
        const primaryMessage = e?.message || String(e);
        const cpuMessage =
          cpuError instanceof Error ? cpuError.message : String(cpuError);
        primaryError = new Error(
          `Ollama GPU startup failed: ${primaryMessage}. CPU fallback also failed: ${cpuMessage}`
        );
      }
      if (cpuText !== undefined) {
        const usage = recordUsage(cwd, {
          model: route.model,
          inputTokens: Math.ceil(promptChars / 4),
          outputTokens: Math.ceil(cpuText.length / 4),
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
              model: route.model,
              fallback: "cpu_after_gpu_memory_error",
              historyTurns: payload.historyTurns,
              primaryError: e?.message || String(e),
            },
          });
        } catch {
          /* ignore */
        }
        return {
          text: cpuText.trim(),
          model: route.model,
          cloud: false,
          costUsd: usage.costUsd || 0,
          baseUrl,
          historyTurns: payload.historyTurns,
          ...(cpuToolCalls.length ? { toolCalls: cpuToolCalls } : {}),
        };
      }
    }

    // Fallback: cheapest local if primary failed (e.g. model missing)
    if (route.model !== cfg.local || route.cloud) {
      const localRoute = resolveModelRoute({
        cwd,
        role: QUICK_ROLE_ID,
        forceCheap: true,
        forceLocal: true,
        localModel: cheapestLocalFallback(cwd),
      });
      const fallbackLocal = quickOllamaOptions();
      const fallback = new ChatOllama({
        baseUrl: normalizeLocalOllamaUrl(localRoute.baseUrl),
        model: localRoute.model,
        temperature: input.temperature ?? 0.4,
        think: false,
        numPredict: input.numPredict ?? 256,
        numCtx: gpuMemoryFailure
          ? Math.min(fallbackLocal.numCtx, 2048)
          : fallbackLocal.numCtx,
        numThread: fallbackLocal.numThread,
        numBatch: gpuMemoryFailure
          ? Math.min(fallbackLocal.numBatch, 128)
          : fallbackLocal.numBatch,
        ...(gpuMemoryFailure ? { numGpu: 0 } : {}),
        keepAlive: fallbackLocal.keepAlive,
      });
      let res;
      try {
        const runner = input.tools?.length
          ? fallback.bindTools(input.tools)
          : fallback;
        res = await runner.invoke(modelInput);
      } catch (fallbackError) {
        const primaryMessage =
          primaryError instanceof Error
            ? primaryError.message
            : String(primaryError);
        const fallbackMessage =
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError);
        throw new Error(
          `Ollama request failed for ${route.model} at ${baseUrl}: ${primaryMessage}. ` +
            `Local fallback ${localRoute.model} at ${normalizeLocalOllamaUrl(localRoute.baseUrl)} also failed: ${fallbackMessage}`
        );
      }
      text =
        typeof res.content === "string" ? res.content : String(res.content ?? "");
      toolCalls = res.tool_calls || [];
      const usage = recordUsage(cwd, {
        model: localRoute.model,
        inputTokens: Math.ceil(promptChars / 4),
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
            historyTurns: payload.historyTurns,
            primaryError:
              primaryError instanceof Error
                ? primaryError.message
                : String(primaryError),
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
        baseUrl: normalizeLocalOllamaUrl(localRoute.baseUrl),
        historyTurns: payload.historyTurns,
        ...(toolCalls.length ? { toolCalls } : {}),
      };
    }
    throw primaryError;
  }

  const usage = recordUsage(cwd, {
    model: route.model,
    inputTokens: Math.ceil(promptChars / 4),
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
        historyTurns: payload.historyTurns,
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
    baseUrl,
    historyTurns: payload.historyTurns,
    ...(toolCalls.length ? { toolCalls } : {}),
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
