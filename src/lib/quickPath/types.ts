/** Lightweight reply path before the full agency pipeline. */

import type { IntentRoute } from "../intentRouter/types.js";

/** @deprecated Prefer IntentRoute — kept for session badge compatibility. */
export type IntentClass =
  | "smalltalk"
  | "simple_question"
  | "web_research"
  | "task";

/** UI / session path badge (legacy + new routes). */
export type ReplyPath =
  | "quick"
  | "web"
  | "agency"
  | "chat"
  | "research"
  | "task"
  | "complex"
  | "clarify";

export type IntentClassification = {
  intent: IntentClass;
  replyPath: ReplyPath;
  confidence: number;
  reason: string;
  /** Heuristic-only vs model-assisted. */
  source: "heuristic" | "model" | "forced";
  /** New top-level route when available. */
  route?: IntentRoute;
  clarifyQuestion?: string;
};

export type DetectedLanguage = "ar" | "en" | "mixed" | "other";

export type QuickPathSource = {
  title: string;
  url: string;
  snippet?: string;
};

export type QuickPathResult = {
  ok: boolean;
  replyPath: ReplyPath;
  intent: IntentClass;
  language: DetectedLanguage;
  reply: string;
  model?: string;
  sources?: QuickPathSource[];
  durationMs: number;
  error?: string;
  costUsd?: number;
  cloud?: boolean;
  /** Web path: search/fetch failure detail (no model called when set for empty search). */
  searchFailureReason?: string;
  /** True when web path skipped the LLM because there was no usable evidence. */
  skippedModel?: boolean;
  /** True when chat/clarify wrote no report/task artifacts. */
  noArtifacts?: boolean;
  notePath?: string;
  route?: IntentRoute;
};
