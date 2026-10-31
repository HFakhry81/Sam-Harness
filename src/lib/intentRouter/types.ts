/**
 * Top-level intent routes — decided before any agency / ops pipeline.
 *
 * chat     — greetings, small talk, simple Q&A (no files / reports / task.ts)
 * research — needs lookup; concise answer + sources; at most one optional note
 * task     — simple single command / desktop action
 * complex  — full agency / architecture pipeline with report packs
 * clarify  — ask one clarifying question instead of launching a pipeline
 */

export type IntentRoute = "chat" | "research" | "task" | "complex" | "clarify";

/** Fine-grained intent labels (classifier output). */
export type IntentClass =
  | "smalltalk"
  | "simple_question"
  | "web_research"
  | "simple_task"
  | "complex_task"
  | "clarify";

export type IntentDecision = {
  route: IntentRoute;
  intent: IntentClass;
  confidence: number;
  reason: string;
  source: "heuristic" | "model" | "forced";
  /** Present when route === "clarify". */
  clarifyQuestion?: string;
};

/** Legacy reply-path badges used by older session entries. */
export type LegacyReplyPath = "quick" | "web" | "agency";

export function routeToLegacyReplyPath(route: IntentRoute): LegacyReplyPath {
  if (route === "chat" || route === "clarify") return "quick";
  if (route === "research") return "web";
  return "agency";
}

export function legacyReplyPathToRoute(
  path: LegacyReplyPath | IntentRoute | string | undefined
): IntentRoute {
  if (path === "quick" || path === "chat") return "chat";
  if (path === "web" || path === "research") return "research";
  if (path === "task") return "task";
  if (path === "clarify") return "clarify";
  if (path === "complex" || path === "agency") return "complex";
  return "complex";
}
