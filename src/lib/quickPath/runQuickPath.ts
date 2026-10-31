/**
 * Orchestrate lightweight reply paths (before agency pipeline).
 * Delegates to intentRouter — chat/research/clarify never spawn agency.
 */
import {
  classifyIntent,
  type ClassifyOptions,
} from "./classify.js";
import {
  runIntentRouter,
  emptyResearchReply,
  type RunIntentRouterInput,
} from "../intentRouter/run.js";
import { routeLabel as intentRouteLabel } from "../intentRouter/classify.js";
import type {
  IntentClassification,
  QuickPathResult,
  ReplyPath,
} from "./types.js";
import type { IntentRoute } from "../intentRouter/types.js";

export type QuickPathEvent = {
  type: string;
  message: string;
  detail?: Record<string, unknown>;
};

export type RunQuickPathInput = {
  prompt: string;
  cwd?: string;
  runId?: string;
  forceAgency?: boolean;
  /** Skip model classifier (tests / offline). */
  heuristicOnly?: boolean;
  /** Injected web search for tests. */
  webSearch?: RunIntentRouterInput["webSearch"];
  /** Injected model invoke for tests. */
  invokeModel?: RunIntentRouterInput["invokeModel"];
  /** Injected classifier. */
  classify?: (
    prompt: string,
    opts?: ClassifyOptions
  ) => Promise<IntentClassification>;
  networkApproved?: boolean | string;
  /** Progress / failure events (Control Plane run log). */
  onEvent?: (ev: QuickPathEvent) => void;
  writeResearchNote?: boolean;
};

/** Honest empty-search message; never invent facts. */
export function emptyWebSearchReply(
  language: Parameters<typeof emptyResearchReply>[0],
  reason: string
): string {
  return emptyResearchReply(language, reason);
}

/**
 * Run the lightweight path when classification is not task/complex.
 * Returns null when the caller should continue to the agency/ops pipeline.
 * Chat failures never escalate — always returns ok chat reply (or null for pipeline).
 */
export async function tryRunQuickPath(
  input: RunQuickPathInput
): Promise<{ classification: IntentClassification; result: QuickPathResult } | null> {
  const classify =
    input.classify ||
    ((prompt: string, opts?: ClassifyOptions) => classifyIntent(prompt, opts));

  const out = await runIntentRouter({
    prompt: input.prompt,
    cwd: input.cwd,
    runId: input.runId,
    forceAgency: input.forceAgency,
    heuristicOnly: input.heuristicOnly,
    webSearch: input.webSearch,
    invokeModel: input.invokeModel,
    networkApproved: input.networkApproved,
    writeResearchNote: input.writeResearchNote,
    onEvent: input.onEvent,
    classify: async (prompt, opts) => {
      const c = await classify(prompt, {
        forceAgency: opts?.forceAgency,
      });
      return {
        route: (c.route ||
          (c.replyPath === "chat" || c.replyPath === "quick"
            ? "chat"
            : c.replyPath === "research" || c.replyPath === "web"
              ? "research"
              : c.replyPath === "task"
                ? "task"
                : c.replyPath === "clarify"
                  ? "clarify"
                  : "complex")) as IntentRoute,
        intent:
          c.intent === "smalltalk"
            ? "smalltalk"
            : c.intent === "simple_question"
              ? "simple_question"
              : c.intent === "web_research"
                ? "web_research"
                : "complex_task",
        confidence: c.confidence,
        reason: c.reason,
        source: c.source,
        clarifyQuestion: c.clarifyQuestion,
      };
    },
  });

  if (!out) {
    // Still surface classification for callers that want the agency reason
    const classification = await classify(input.prompt, {
      forceAgency: input.forceAgency,
    });
    if (
      classification.route === "task" ||
      classification.route === "complex" ||
      classification.replyPath === "agency" ||
      classification.replyPath === "task" ||
      classification.replyPath === "complex" ||
      classification.intent === "task"
    ) {
      return null;
    }
    return null;
  }

  const classification: IntentClassification = {
    intent:
      out.decision.intent === "smalltalk"
        ? "smalltalk"
        : out.decision.intent === "web_research"
          ? "web_research"
          : out.decision.intent === "simple_question" ||
              out.decision.intent === "clarify"
            ? "simple_question"
            : "task",
    replyPath: out.route as ReplyPath,
    confidence: out.decision.confidence,
    reason: out.decision.reason,
    source: out.decision.source,
    route: out.route,
    clarifyQuestion: out.decision.clarifyQuestion,
  };

  const result: QuickPathResult = {
    ok: out.ok,
    replyPath: out.route,
    intent: classification.intent,
    language: out.language,
    reply: out.reply,
    model: out.model,
    sources: out.sources,
    durationMs: out.durationMs,
    error: out.error,
    costUsd: out.costUsd,
    cloud: out.cloud,
    searchFailureReason: out.searchFailureReason,
    skippedModel: out.skippedModel,
    noArtifacts: out.noArtifacts,
    notePath: out.notePath,
    route: out.route,
  };

  return { classification, result };
}

export function replyPathLabel(
  path: ReplyPath | IntentRoute,
  locale: "ar" | "en" = "en"
): string {
  const route: IntentRoute =
    path === "quick" || path === "chat"
      ? "chat"
      : path === "web" || path === "research"
        ? "research"
        : path === "task"
          ? "task"
          : path === "clarify"
            ? "clarify"
            : "complex";
  return intentRouteLabel(route, locale);
}
