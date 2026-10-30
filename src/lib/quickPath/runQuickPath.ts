/**
 * Orchestrate quick / web reply paths (before agency pipeline).
 */
import * as fs from "fs";
import * as path from "path";
import { appendAudit } from "../trust/auditLog.js";
import { classifyIntent, type ClassifyOptions } from "./classify.js";
import { detectUserLanguage, languageReplyDirective } from "./language.js";
import { invokeQuickModel, modelClassifyIntent } from "./quickModel.js";
import {
  runWebSearch,
  sourcesFromSearch,
  filterUsablePages,
  type WebSearchEvent,
  type WebSearchResult,
} from "./webSearch.js";
import type {
  DetectedLanguage,
  IntentClassification,
  IntentClass,
  QuickPathResult,
  ReplyPath,
} from "./types.js";

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
  webSearch?: typeof runWebSearch;
  /** Injected model invoke for tests. */
  invokeModel?: typeof invokeQuickModel;
  /** Injected classifier. */
  classify?: (prompt: string, opts?: ClassifyOptions) => Promise<IntentClassification>;
  networkApproved?: boolean | string;
  /** Progress / failure events (Control Plane run log). */
  onEvent?: (ev: QuickPathEvent) => void;
};

function writeQuickArtifacts(
  cwd: string,
  result: QuickPathResult,
  classification: IntentClassification
): void {
  try {
    const md = [
      `# Quick path reply (${result.replyPath})`,
      "",
      `Intent: ${result.intent} · confidence ${classification.confidence}`,
      `Language: ${result.language} · model: ${result.model || "n/a"}`,
      `Duration: ${result.durationMs}ms`,
      ...(result.searchFailureReason
        ? [`Search failure: ${result.searchFailureReason}`]
        : []),
      ...(result.skippedModel ? ["Model: skipped (no usable web evidence)"] : []),
      "",
      "## Reply",
      "",
      result.reply,
      "",
      ...(result.sources?.length
        ? [
            "## Sources",
            "",
            ...result.sources.map((s, i) => `${i + 1}. [${s.title}](${s.url})`),
            "",
          ]
        : []),
    ].join("\n");
    fs.writeFileSync(path.join(cwd, "execution-result.md"), md, "utf-8");
    fs.writeFileSync(
      path.join(cwd, "final-report.md"),
      JSON.stringify(
        {
          summary: result.reply.slice(0, 800),
          replyPath: result.replyPath,
          intent: result.intent,
          sources: result.sources || [],
          model: result.model,
          durationMs: result.durationMs,
          searchFailureReason: result.searchFailureReason || null,
          skippedModel: Boolean(result.skippedModel),
        },
        null,
        2
      ),
      "utf-8"
    );
  } catch {
    /* best-effort */
  }
}

function formatReplyWithSources(
  reply: string,
  sources: QuickPathResult["sources"],
  language: DetectedLanguage
): string {
  if (!sources?.length) return reply;
  const header = language === "ar" ? "\n\nالمصادر:" : "\n\nSources:";
  const lines = sources.map((s, i) => `${i + 1}. ${s.title} — ${s.url}`);
  return `${reply.trim()}${header}\n${lines.join("\n")}`;
}

/** Honest empty-search message; never invent facts. */
export function emptyWebSearchReply(
  language: DetectedLanguage,
  reason: string
): string {
  const r = reason.trim() || "unknown error";
  // Arabic-first: treat mixed (Arabic + Latin product names) as Arabic.
  if (language === "ar" || language === "mixed") {
    return [
      "تعذّر إكمال بحث الويب: لم أجد صفحات قابلة للاستخدام، لذلك لم ألخّص ولن أخترع معلومات.",
      `السبب: ${r}`,
      "يمكنك تفعيل «تشغيل كوكالة كاملة» لإعادة المحاولة عبر مسار الوكالة، أو أعد الصياغة / جرّب لاحقاً.",
    ].join("\n");
  }
  return [
    "Web search found nothing usable, so I did not invent an answer.",
    `Reason: ${r}`,
    "You can check «Run as full agency task» to retry via the agency path, or rephrase / try again later.",
  ].join("\n");
}

async function runSmalltalkOrQuestion(input: {
  prompt: string;
  intent: IntentClass;
  cwd: string;
  runId?: string;
  invokeModel: typeof invokeQuickModel;
}): Promise<Omit<QuickPathResult, "durationMs" | "ok">> {
  const lang = detectUserLanguage(input.prompt);
  const kind =
    input.intent === "smalltalk"
      ? "Respond as a brief friendly greeting/acknowledgment."
      : "Answer the simple question briefly and accurately. No tools.";
  const call = await input.invokeModel({
    cwd: input.cwd,
    runId: input.runId,
    numPredict: 220,
    prompt: input.prompt,
    system: [
      "You are Sam-Harness quick assistant.",
      kind,
      languageReplyDirective(lang),
    ].join("\n"),
  });
  return {
    replyPath: "quick",
    intent: input.intent,
    language: lang,
    reply: call.text,
    model: call.model,
    costUsd: call.costUsd,
    cloud: call.cloud,
  };
}

async function runWebResearchPath(input: {
  prompt: string;
  cwd: string;
  runId?: string;
  invokeModel: typeof invokeQuickModel;
  webSearch: typeof runWebSearch;
  networkApproved?: boolean | string;
  onEvent?: (ev: QuickPathEvent) => void;
}): Promise<Omit<QuickPathResult, "durationMs" | "ok">> {
  const lang = detectUserLanguage(input.prompt);
  const emit = (ev: QuickPathEvent) => {
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
        type: `web.${ev.type}`,
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
      type: "web.empty_skip_model",
      message: `skipping model — ${reason}`,
      detail: {
        hitCount: search.hits.length,
        pageCount: search.pages.length,
        attempts: search.attempts,
      },
    });
    try {
      appendAudit({
        category: "system",
        action: "quick_path.web_empty",
        runId: input.runId,
        detail: {
          reason,
          attempts: search.attempts,
          hitCount: search.hits.length,
        },
      });
    } catch {
      /* ignore */
    }
    return {
      replyPath: "web",
      intent: "web_research",
      language: lang,
      reply: emptyWebSearchReply(lang, reason),
      sources: [],
      searchFailureReason: reason,
      skippedModel: true,
      costUsd: 0,
      cloud: false,
    };
  }

  const sources = sourcesFromSearch({ ...search, pages: usablePages, usable: true });
  const evidence = usablePages
    .map(
      (p, i) =>
        `[${i + 1}] ${p.title}\nURL: ${p.url}\n${p.text.slice(0, 1500)}`
    )
    .join("\n\n");

  const call = await input.invokeModel({
    cwd: input.cwd,
    runId: input.runId,
    allowCloud: false,
    numPredict: 400,
    prompt: [
      `User request: ${input.prompt}`,
      "",
      "Evidence from fetched pages ONLY (cite by number). Every claim must come from this text:",
      evidence,
      "",
      "Rules:",
      "- Summarize ONLY what appears in the evidence above.",
      "- If evidence is insufficient for a detail, say you do not know from these sources.",
      "- Cite sources as [1], [2], … matching the evidence numbers.",
      "- Do NOT invent dates, usernames, versions, or URLs.",
      "- Do not dump system status.",
    ].join("\n"),
    system: [
      "You are a grounded web-research summarizer.",
      "Never hallucinate. Use only the provided page excerpts.",
      languageReplyDirective(lang),
    ].join("\n"),
  });

  return {
    replyPath: "web",
    intent: "web_research",
    language: lang,
    reply: formatReplyWithSources(call.text, sources, lang),
    model: call.model,
    sources,
    costUsd: call.costUsd,
    cloud: call.cloud,
    skippedModel: false,
  };
}

/**
 * Run the lightweight path when classification is not `task`.
 * Returns null when the caller should continue to the agency pipeline.
 */
export async function tryRunQuickPath(
  input: RunQuickPathInput
): Promise<{ classification: IntentClassification; result: QuickPathResult } | null> {
  const cwd = input.cwd || process.cwd();
  const started = Date.now();
  const classify = input.classify || classifyIntent;
  const classification = await classify(input.prompt, {
    forceAgency: input.forceAgency,
    modelClassify: input.heuristicOnly
      ? undefined
      : (p) => modelClassifyIntent(p, cwd),
  });

  if (classification.replyPath === "agency" || classification.intent === "task") {
    return null;
  }

  const invokeModel = input.invokeModel || invokeQuickModel;
  const webSearch = input.webSearch || runWebSearch;
  const emit = (ev: QuickPathEvent) => {
    try {
      input.onEvent?.(ev);
    } catch {
      /* ignore */
    }
  };

  try {
    appendAudit({
      category: "system",
      action: "quick_path.start",
      runId: input.runId,
      detail: {
        intent: classification.intent,
        replyPath: classification.replyPath,
        confidence: classification.confidence,
        reason: classification.reason,
        source: classification.source,
      },
    });
  } catch {
    /* ignore */
  }

  try {
    let partial: Omit<QuickPathResult, "durationMs" | "ok">;
    if (classification.replyPath === "web") {
      partial = await runWebResearchPath({
        prompt: input.prompt,
        cwd,
        runId: input.runId,
        invokeModel,
        webSearch,
        networkApproved: input.networkApproved,
        onEvent: emit,
      });
    } else {
      partial = await runSmalltalkOrQuestion({
        prompt: input.prompt,
        intent: classification.intent,
        cwd,
        runId: input.runId,
        invokeModel,
      });
    }

    // Empty web search is still a successful "honest" reply (ok=true, skippedModel).
    const result: QuickPathResult = {
      ok: true,
      ...partial,
      durationMs: Date.now() - started,
    };
    writeQuickArtifacts(cwd, result, classification);

    try {
      appendAudit({
        category: "system",
        action: "quick_path.done",
        runId: input.runId,
        detail: {
          replyPath: result.replyPath,
          model: result.model || null,
          durationMs: result.durationMs,
          sourceCount: result.sources?.length || 0,
          skippedModel: Boolean(result.skippedModel),
          searchFailureReason: result.searchFailureReason || null,
        },
      });
    } catch {
      /* ignore */
    }

    return { classification, result };
  } catch (e: any) {
    const result: QuickPathResult = {
      ok: false,
      replyPath: classification.replyPath,
      intent: classification.intent,
      language: detectUserLanguage(input.prompt),
      reply: "",
      durationMs: Date.now() - started,
      error: e?.message || String(e),
    };
    emit({ type: "fail", message: result.error || "quick path failed" });
    try {
      appendAudit({
        category: "system",
        action: "quick_path.fail",
        runId: input.runId,
        detail: { error: result.error, replyPath: result.replyPath },
      });
    } catch {
      /* ignore */
    }
    return { classification, result };
  }
}

export function replyPathLabel(path: ReplyPath, locale: "ar" | "en" = "en"): string {
  if (locale === "ar") {
    if (path === "quick") return "سريع";
    if (path === "web") return "ويب";
    return "وكالة";
  }
  if (path === "quick") return "Quick";
  if (path === "web") return "Web";
  return "Agency";
}
