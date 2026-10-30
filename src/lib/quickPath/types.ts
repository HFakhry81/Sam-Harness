/** Lightweight reply path before the full agency pipeline. */

export type IntentClass =
  | "smalltalk"
  | "simple_question"
  | "web_research"
  | "task";

/** UI / session path badge. */
export type ReplyPath = "quick" | "web" | "agency";

export type IntentClassification = {
  intent: IntentClass;
  replyPath: ReplyPath;
  confidence: number;
  reason: string;
  /** Heuristic-only vs model-assisted. */
  source: "heuristic" | "model" | "forced";
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
};
