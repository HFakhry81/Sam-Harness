/**
 * Orchestrate quick / web reply paths (before agency pipeline).
 */
import * as fs from "fs";
import * as path from "path";
import { appendAudit } from "../trust/auditLog.js";
import { classifyIntent, type ClassifyOptions } from "./classify.js";
import { detectUserLanguage, languageReplyDirective } from "./language.js";
import { invokeQuickModel, modelClassifyIntent } from "./quickModel.js";
import { runWebSearch, sourcesFromSearch } from "./webSearch.js";
import type {
  IntentClassification,
  IntentClass,
  QuickPathResult,
  ReplyPath,
} from "./types.js";

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
  language: QuickPathResult["language"]
): string {
  if (!sources?.length) return reply;
  const header = language === "ar" ? "\n\nالمصادر:" : "\n\nSources:";
  const lines = sources.map((s, i) => `${i + 1}. ${s.title} — ${s.url}`);
  return `${reply.trim()}${header}\n${lines.join("\n")}`;
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
}): Promise<Omit<QuickPathResult, "durationMs" | "ok">> {
  const lang = detectUserLanguage(input.prompt);
  const search = await input.webSearch({
    query: input.prompt,
    runId: input.runId,
    approved: input.networkApproved,
    fetchPages: true,
    maxPages: 3,
  });
  const sources = sourcesFromSearch(search);
  const evidence = search.pages
    .map(
      (p, i) =>
        `[${i + 1}] ${p.title}\nURL: ${p.url}\n${(p.text || p.snippet || "").slice(0, 1200)}`
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
      "Web evidence (cite by number):",
      evidence || "(no page text — use titles/snippets only)",
      "",
      "Write a short summary answering the user. Cite sources as [1], [2], …",
      "Do not invent URLs. Do not dump system status.",
    ].join("\n"),
    system: [
      "You summarize web research for the owner.",
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
          model: result.model,
          durationMs: result.durationMs,
          sourceCount: result.sources?.length || 0,
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
    // On failure of quick/web, fall through to agency only for web? Prefer surface error.
    // Owner asked for quick path — return failed result so CP can show it (not silent agency).
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
