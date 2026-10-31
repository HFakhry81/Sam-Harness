/**
 * Execute chat / research / clarify routes BEFORE any agency pipeline.
 * Chat: short reply, no files, no reports, no task.ts.
 * Research: search + concise answer; optional single note file.
 * Clarify: one-line question; no pipeline.
 * task / complex: return null so caller continues to ops/agency.
 */
import * as fs from "fs";
import * as path from "path";
import { appendAudit } from "../trust/auditLog.js";
import { getOutputHome, ensureOutputHome } from "../outputHome.js";
import {
  classifyIntent,
  type ClassifyOptions,
} from "./classify.js";
import type { IntentDecision, IntentRoute } from "./types.js";
import { detectUserLanguage, languageReplyDirective } from "../quickPath/language.js";
import { invokeQuickModel, modelClassifyIntentRoute } from "./model.js";
import {
  runWebSearch,
  sourcesFromSearch,
  filterUsablePages,
  type WebSearchEvent,
  type WebSearchResult,
} from "../quickPath/webSearch.js";
import type { DetectedLanguage, QuickPathSource } from "../quickPath/types.js";

export type IntentRouterEvent = {
  type: string;
  message: string;
  detail?: Record<string, unknown>;
};

export type IntentRouterResult = {
  ok: boolean;
  route: IntentRoute;
  decision: IntentDecision;
  language: DetectedLanguage;
  reply: string;
  model?: string;
  sources?: QuickPathSource[];
  durationMs: number;
  error?: string;
  costUsd?: number;
  cloud?: boolean;
  /** Research only: optional note path under output home (never a report pack). */
  notePath?: string;
  searchFailureReason?: string;
  skippedModel?: boolean;
  /** True when no report folder / task.ts / pack artifacts were written. */
  noArtifacts: boolean;
};

export type RunIntentRouterInput = {
  prompt: string;
  cwd?: string;
  runId?: string;
  forceAgency?: boolean;
  heuristicOnly?: boolean;
  webSearch?: typeof runWebSearch;
  invokeModel?: typeof invokeQuickModel;
  classify?: (
    prompt: string,
    opts?: ClassifyOptions
  ) => Promise<IntentDecision>;
  networkApproved?: boolean | string;
  onEvent?: (ev: IntentRouterEvent) => void;
  /** When true, research may write one note markdown under documents/. */
  writeResearchNote?: boolean;
};

/** Deterministic chat reply when local model is unavailable — never escalate to agency. */
export function fallbackChatReply(
  prompt: string,
  language: DetectedLanguage
): string {
  const p = String(prompt || "").trim();
  const ar = language === "ar" || language === "mixed";
  if (
    /^(?:hi+|hello|hey+|أهلاً?|اهلاً?|مرحباً?|مرحبه|هلا+|سلام)/iu.test(p)
  ) {
    if (ar) {
      if (/اسمي|انا|أنا/u.test(p)) {
        return "أهلاً بك! سعيد بالتعارف. أنا Sam-Harness — كيف أقدر أساعدك؟";
      }
      return "مرحباً! أنا Sam-Harness. كيف أقدر أساعدك؟";
    }
    if (/my\s+name\s+is|i(?:'m| am)\b/i.test(p)) {
      return "Nice to meet you! I'm Sam-Harness — how can I help?";
    }
    return "Hello! I'm Sam-Harness. How can I help?";
  }
  if (ar) return "أهلاً! كيف أقدر أساعدك؟";
  return "Hi! How can I help?";
}

function formatReplyWithSources(
  reply: string,
  sources: QuickPathSource[] | undefined,
  language: DetectedLanguage
): string {
  if (!sources?.length) return reply;
  const header = language === "ar" || language === "mixed" ? "\n\nالمصادر:" : "\n\nSources:";
  const lines = sources.map((s, i) => `${i + 1}. ${s.title} — ${s.url}`);
  return `${reply.trim()}${header}\n${lines.join("\n")}`;
}

export function emptyResearchReply(
  language: DetectedLanguage,
  reason: string
): string {
  const r = reason.trim() || "unknown error";
  if (language === "ar" || language === "mixed") {
    return [
      "تعذّر إكمال البحث: لم أجد مصادر قابلة للاستخدام، لذلك لم ألخّص ولن أخترع معلومات.",
      `السبب: ${r}`,
      "أعد الصياغة أو أضف --force-agency إن أردت مسار الوكالة الكامل.",
    ].join("\n");
  }
  return [
    "Research found nothing usable, so I did not invent an answer.",
    `Reason: ${r}`,
    "Rephrase, or pass --force-agency for the full agency pipeline.",
  ].join("\n");
}

async function runChatReply(input: {
  prompt: string;
  intent: IntentDecision["intent"];
  invokeModel: typeof invokeQuickModel;
  cwd: string;
  runId?: string;
}): Promise<{
  reply: string;
  model?: string;
  costUsd?: number;
  cloud?: boolean;
  language: DetectedLanguage;
}> {
  const lang = detectUserLanguage(input.prompt);
  const kind =
    input.intent === "smalltalk"
      ? "Respond as a brief friendly greeting/acknowledgment."
      : "Answer the simple question briefly and accurately. No tools. No files.";
  try {
    const call = await input.invokeModel({
      cwd: input.cwd,
      runId: input.runId,
      numPredict: 220,
      prompt: input.prompt,
      system: [
        "You are Sam-Harness chat assistant.",
        kind,
        languageReplyDirective(lang),
      ].join("\n"),
    });
    return {
      reply: call.text || fallbackChatReply(input.prompt, lang),
      model: call.model,
      costUsd: call.costUsd,
      cloud: call.cloud,
      language: lang,
    };
  } catch {
    return {
      reply: fallbackChatReply(input.prompt, lang),
      language: lang,
      costUsd: 0,
      cloud: false,
    };
  }
}

async function runResearch(input: {
  prompt: string;
  cwd: string;
  runId?: string;
  invokeModel: typeof invokeQuickModel;
  webSearch: typeof runWebSearch;
  networkApproved?: boolean | string;
  onEvent?: (ev: IntentRouterEvent) => void;
  writeResearchNote?: boolean;
}): Promise<{
  reply: string;
  model?: string;
  sources?: QuickPathSource[];
  costUsd?: number;
  cloud?: boolean;
  language: DetectedLanguage;
  notePath?: string;
  searchFailureReason?: string;
  skippedModel?: boolean;
}> {
  const lang = detectUserLanguage(input.prompt);
  const emit = (ev: IntentRouterEvent) => {
    try {
      input.onEvent?.(ev);
    } catch {
      /* ignore */
    }
  };

  const search: WebSearchResult = await input.webSearch({
    query: input.prompt,
    runId: input.runId,
    approved: input.networkApproved,
    fetchPages: true,
    maxPages: 3,
    onEvent: (ev: WebSearchEvent) => {
      emit({
        type: `research.${ev.type}`,
        message: ev.message,
        detail: ev.detail,
      });
    },
  });

  const usablePages = filterUsablePages(search.pages);
  if (!search.usable || usablePages.length === 0) {
    const reason =
      search.failureReason ||
      (search.hits.length
        ? `found ${search.hits.length} link(s) but no usable page text`
        : "search returned no results");
    emit({
      type: "research.empty_skip_model",
      message: `skipping model — ${reason}`,
      detail: {
        hitCount: search.hits.length,
        pageCount: search.pages.length,
        attempts: search.attempts,
      },
    });
    return {
      language: lang,
      reply: emptyResearchReply(lang, reason),
      sources: [],
      searchFailureReason: reason,
      skippedModel: true,
      costUsd: 0,
      cloud: false,
    };
  }

  const sources = sourcesFromSearch({
    ...search,
    pages: usablePages,
    usable: true,
  });
  const evidence = usablePages
    .map(
      (p, i) =>
        `[${i + 1}] ${p.title}\nURL: ${p.url}\n${p.text.slice(0, 1500)}`
    )
    .join("\n\n");

  let text = "";
  let model: string | undefined;
  let costUsd = 0;
  let cloud = false;
  try {
    const call = await input.invokeModel({
      cwd: input.cwd,
      runId: input.runId,
      allowCloud: false,
      numPredict: 400,
      prompt: [
        `User request: ${input.prompt}`,
        "",
        "Evidence from fetched pages ONLY (cite by number):",
        evidence,
        "",
        "Rules: summarize ONLY evidence; cite [1],[2]; do not invent facts.",
      ].join("\n"),
      system: [
        "You are a grounded research summarizer.",
        languageReplyDirective(lang),
      ].join("\n"),
    });
    text = call.text;
    model = call.model;
    costUsd = call.costUsd;
    cloud = call.cloud;
  } catch (e: any) {
    text = emptyResearchReply(lang, e?.message || String(e));
  }

  const reply = formatReplyWithSources(text, sources, lang);
  let notePath: string | undefined;
  if (input.writeResearchNote !== false) {
    try {
      const layout = ensureOutputHome(getOutputHome());
      const notesDir = path.join(layout.documents, "research-notes");
      fs.mkdirSync(notesDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      notePath = path.join(notesDir, `note-${stamp}.md`);
      const md = [
        `# Research note`,
        "",
        `Query: ${input.prompt}`,
        "",
        reply,
        "",
      ].join("\n");
      fs.writeFileSync(notePath, md, "utf-8");
    } catch {
      notePath = undefined;
    }
  }

  return {
    language: lang,
    reply,
    model,
    sources,
    costUsd,
    cloud,
    notePath,
    skippedModel: false,
  };
}

/**
 * Run chat / research / clarify. Returns null when caller should continue to task/complex pipeline.
 */
export async function runIntentRouter(
  input: RunIntentRouterInput
): Promise<IntentRouterResult | null> {
  const cwd = input.cwd || process.cwd();
  const started = Date.now();
  const classify = input.classify || classifyIntent;
  const decision = await classify(input.prompt, {
    forceAgency: input.forceAgency,
    modelClassify: input.heuristicOnly
      ? undefined
      : (p) => modelClassifyIntentRoute(p, cwd),
  });

  if (decision.route === "task" || decision.route === "complex") {
    return null;
  }

  const invokeModel = input.invokeModel || invokeQuickModel;
  const webSearch = input.webSearch || runWebSearch;
  const emit = (ev: IntentRouterEvent) => {
    try {
      input.onEvent?.(ev);
    } catch {
      /* ignore */
    }
  };

  try {
    appendAudit({
      category: "system",
      action: "intent_router.start",
      runId: input.runId,
      detail: {
        route: decision.route,
        intent: decision.intent,
        confidence: decision.confidence,
        reason: decision.reason,
        source: decision.source,
      },
    });
  } catch {
    /* ignore */
  }

  emit({
    type: "route",
    message: `route=${decision.route} intent=${decision.intent}`,
    detail: { ...decision },
  });

  try {
    if (decision.route === "clarify") {
      const lang = detectUserLanguage(input.prompt);
      const reply =
        decision.clarifyQuestion ||
        (lang === "ar" || lang === "mixed"
          ? "هل تريد رداً سريعاً في المحادثة، أم تشغيل مهمة؟"
          : "Quick chat reply, or run this as a task?");
      const result: IntentRouterResult = {
        ok: true,
        route: "clarify",
        decision,
        language: lang,
        reply,
        durationMs: Date.now() - started,
        noArtifacts: true,
        costUsd: 0,
        cloud: false,
      };
      return result;
    }

    if (decision.route === "research") {
      const partial = await runResearch({
        prompt: input.prompt,
        cwd,
        runId: input.runId,
        invokeModel,
        webSearch,
        networkApproved: input.networkApproved,
        onEvent: emit,
        writeResearchNote: input.writeResearchNote,
      });
      return {
        ok: true,
        route: "research",
        decision,
        durationMs: Date.now() - started,
        noArtifacts: !partial.notePath,
        ...partial,
      };
    }

    // chat
    const partial = await runChatReply({
      prompt: input.prompt,
      intent: decision.intent,
      invokeModel,
      cwd,
      runId: input.runId,
    });
    return {
      ok: true,
      route: "chat",
      decision,
      durationMs: Date.now() - started,
      noArtifacts: true,
      ...partial,
    };
  } catch (e: any) {
    // Chat-route failures must never escalate — return a safe reply.
    const lang = detectUserLanguage(input.prompt);
    const result: IntentRouterResult = {
      ok: true,
      route: decision.route === "research" ? "research" : "chat",
      decision,
      language: lang,
      reply:
        decision.route === "research"
          ? emptyResearchReply(lang, e?.message || String(e))
          : fallbackChatReply(input.prompt, lang),
      durationMs: Date.now() - started,
      error: e?.message || String(e),
      noArtifacts: true,
    };
    emit({ type: "fallback", message: result.error || "intent router fallback" });
    return result;
  }
}
