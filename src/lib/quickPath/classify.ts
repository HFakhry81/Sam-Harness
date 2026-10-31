/**
 * Intent classifier bridge — delegates to intentRouter (deterministic + optional tiny model).
 * Keeps legacy IntentClass / ReplyPath shapes for Control Plane / tests.
 */
import type { IntentClass, IntentClassification, ReplyPath } from "./types.js";
import {
  classifyIntent as routeClassifyIntent,
  classifyIntentHeuristic as routeClassifyHeuristic,
  AMBIGUOUS_BELOW,
  type ClassifyOptions as RouteClassifyOptions,
} from "../intentRouter/classify.js";
import type { IntentDecision, IntentRoute } from "../intentRouter/types.js";

function legacyIntent(d: IntentDecision): IntentClass {
  if (d.intent === "smalltalk") return "smalltalk";
  if (d.intent === "simple_question" || d.intent === "clarify") return "simple_question";
  if (d.intent === "web_research") return "web_research";
  return "task";
}

function legacyPath(route: IntentRoute): ReplyPath {
  if (route === "chat" || route === "clarify") return "chat";
  if (route === "research") return "research";
  if (route === "task") return "task";
  return "complex";
}

function fromDecision(d: IntentDecision): IntentClassification {
  return {
    intent: legacyIntent(d),
    replyPath: legacyPath(d.route),
    confidence: d.confidence,
    reason: d.reason,
    source: d.source,
    route: d.route,
    clarifyQuestion: d.clarifyQuestion,
  };
}

/**
 * Pure heuristic classifier (no I/O). Exported for unit tests.
 */
export function classifyIntentHeuristic(prompt: string): IntentClassification {
  return fromDecision(routeClassifyHeuristic(prompt));
}

export type ClassifyOptions = {
  /** Force agency path (UI checkbox / API). */
  forceAgency?: boolean;
  /**
   * Optional model classifier when heuristic confidence is low.
   * Accepts legacy IntentClass OR IntentRoute strings.
   */
  modelClassify?: (
    prompt: string
  ) => Promise<IntentClass | IntentRoute | null>;
};

function mapModelResult(
  label: IntentClass | IntentRoute | null
): IntentRoute | null {
  if (!label) return null;
  if (label === "smalltalk" || label === "simple_question") return "chat";
  if (label === "web_research") return "research";
  if (label === "task") return "task";
  if (
    label === "chat" ||
    label === "research" ||
    label === "complex" ||
    label === "clarify"
  ) {
    return label;
  }
  return "complex";
}

/**
 * Classify intent: heuristics first, then optional tiny model if ambiguous.
 */
export async function classifyIntent(
  prompt: string,
  opts: ClassifyOptions = {}
): Promise<IntentClassification> {
  const routeOpts: RouteClassifyOptions = {
    forceAgency: opts.forceAgency,
    modelClassify: opts.modelClassify
      ? async (p) => mapModelResult(await opts.modelClassify!(p))
      : undefined,
  };
  return fromDecision(await routeClassifyIntent(prompt, routeOpts));
}

export { AMBIGUOUS_BELOW };
