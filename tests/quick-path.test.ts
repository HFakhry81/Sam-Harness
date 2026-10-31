/**
 * Quick reply path — classifier, language, web (mocked), agency fallback.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  classifyIntentHeuristic,
  classifyIntent,
  detectUserLanguage,
  languageReplyDirective,
  replyMatchesLanguage,
  tryRunQuickPath,
  resolveQuickModel,
  DEFAULT_QUICK_LOCAL_MODEL,
  emptyWebSearchReply,
  parseDuckDuckGoHtml,
  unwrapDuckRedirect,
  filterUsablePages,
} from "../src/lib/quickPath/index.js";
import type { QuickPathResult } from "../src/lib/quickPath/index.js";

describe("classifyIntentHeuristic", () => {
  it("classifies Arabic greetings as smalltalk → chat", () => {
    for (const p of ["اهلا", "أهلا", "مرحبا", "مرحباً", "السلام عليكم", "صباح الخير"]) {
      const c = classifyIntentHeuristic(p);
      expect(c.intent, p).toBe("smalltalk");
      expect(c.replyPath, p).toBe("chat");
      expect(c.route, p).toBe("chat");
    }
  });

  it("classifies English greetings as smalltalk → chat", () => {
    for (const p of ["hi", "hello", "hey", "good morning", "thanks"]) {
      const c = classifyIntentHeuristic(p);
      expect(c.intent, p).toBe("smalltalk");
      expect(c.replyPath, p).toBe("chat");
    }
  });

  it("classifies simple questions as chat", () => {
    const c = classifyIntentHeuristic("What is a REST API?");
    expect(c.intent).toBe("simple_question");
    expect(c.replyPath).toBe("chat");
    const ar = classifyIntentHeuristic("ما معنى REST؟");
    expect(ar.replyPath).toBe("chat");
  });

  it("classifies web research requests", () => {
    for (const p of [
      "search the web for TypeScript 5.5 release notes",
      "give me details about the latest OpenAI news",
      "ابحث لي على النت عن أخبار الذكاء الاصطناعي",
      "ما آخر أخبار أوبن إيه آي اليوم",
    ]) {
      const c = classifyIntentHeuristic(p);
      expect(c.intent, p).toBe("web_research");
      expect(c.replyPath, p).toBe("research");
      expect(c.route, p).toBe("research");
    }
  });

  it("routes real tasks to task or complex", () => {
    const simple = classifyIntentHeuristic(
      "اعمل ملف Excel على سطح المكتب باسم report.xlsx"
    );
    expect(simple.route).toBe("task");
    expect(simple.replyPath).toBe("task");

    const complex = classifyIntentHeuristic(
      "analyze Maw3ed architecture and produce a gap matrix"
    );
    expect(complex.route).toBe("complex");
    expect(complex.replyPath).toBe("complex");

    for (const p of ["افتح Notepad واكتب Hello", "انقل الملف report.md إلى Downloads"]) {
      const c = classifyIntentHeuristic(p);
      expect(["task", "complex"], p).toContain(c.route);
    }
  });

  it("honors forceAgency", async () => {
    const c = await classifyIntent("مرحبا", { forceAgency: true });
    expect(c.replyPath).toBe("complex");
    expect(c.route).toBe("complex");
    expect(c.source).toBe("forced");
  });
});

describe("language matching", () => {
  it("detects Arabic and English", () => {
    expect(detectUserLanguage("اهلا كيفك")).toBe("ar");
    expect(detectUserLanguage("hello there")).toBe("en");
    expect(detectUserLanguage("مرحبا hello")).toBe("mixed");
  });

  it("replyMatchesLanguage accepts Arabic for Arabic prompts", () => {
    expect(replyMatchesLanguage("أهلاً! كيف أقدر أساعدك؟", "ar")).toBe(true);
    expect(replyMatchesLanguage("Hello! How can I help?", "en")).toBe(true);
  });

  it("language directive forbids status dumps", () => {
    expect(languageReplyDirective("ar")).toMatch(/Arabic/i);
    expect(languageReplyDirective("ar")).toMatch(/system status/i);
  });
});

describe("resolveQuickModel", () => {
  it("defaults to qwen2.5:1.5b local", () => {
    const m = resolveQuickModel(process.cwd());
    expect(m.local).toBe(DEFAULT_QUICK_LOCAL_MODEL);
    expect(m.prefersCloud).toBe(false);
  });
});

describe("tryRunQuickPath", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sh-quick-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("greetings use deterministic reply — never call a model", async () => {
    const invokeModel = vi.fn(async () => ({
      text: "SHOULD_NOT_RUN",
      model: "qwen2.5:1.5b",
      cloud: false,
      costUsd: 0,
      baseUrl: "http://localhost:11434",
    }));

    const out = await tryRunQuickPath({
      prompt: "اهلا",
      cwd: tmp,
      heuristicOnly: true,
      invokeModel: invokeModel as any,
    });

    expect(out).not.toBeNull();
    expect(out!.result.replyPath).toBe("chat");
    expect(out!.result.ok).toBe(true);
    expect(out!.result.skippedModel).toBe(true);
    expect(out!.result.language).toBe("ar");
    expect(out!.result.noArtifacts).toBe(true);
    expect(out!.result.reply).toMatch(/أهلا|مرحبا|Sam-Harness/i);
    expect(invokeModel).not.toHaveBeenCalled();
    expect(out!.result.durationMs).toBeLessThan(500);
    // Chat must not write report artifacts into cwd
    expect(fs.existsSync(path.join(tmp, "execution-result.md"))).toBe(false);
    expect(fs.existsSync(path.join(tmp, "final-report.md"))).toBe(false);
  });

  it("owner greeting مرحبا اسمي مز هيثم never calls a model", async () => {
    const invokeModel = vi.fn(async () => ({
      text: "SHOULD_NOT_RUN",
      model: "qwen2.5:1.5b",
      cloud: false,
      costUsd: 0,
      baseUrl: "http://localhost:11434",
    }));
    const out = await tryRunQuickPath({
      prompt: "مرحبا اسمي مز هيثم",
      cwd: tmp,
      heuristicOnly: false,
      invokeModel: invokeModel as any,
    });
    expect(out!.result.route).toBe("chat");
    expect(out!.result.skippedModel).toBe(true);
    expect(invokeModel).not.toHaveBeenCalled();
  });

  it("web path uses mocked search and cites URLs", async () => {
    const invokeModel = vi.fn(async () => ({
      text: "ملخص قصير عن الموضوع [1].",
      model: "qwen2.5:1.5b",
      cloud: false,
      costUsd: 0,
      baseUrl: "http://localhost:11434",
    }));

    const pageText =
      "Vitest is a blazing fast unit test framework powered by Vite. ".repeat(3);
    const webSearch = vi.fn(async () => ({
      provider: "duckduckgo" as const,
      query: "search the web for vitest",
      hits: [
        {
          title: "Vitest",
          url: "https://vitest.dev/",
          snippet: "Next generation testing",
        },
      ],
      pages: [
        {
          title: "Vitest",
          url: "https://vitest.dev/",
          snippet: "Next generation testing",
          text: pageText,
        },
      ],
      usable: true,
      attempts: [
        { provider: "duckduckgo" as const, ok: true, hitCount: 1, ms: 10 },
      ],
    }));

    const out = await tryRunQuickPath({
      prompt: "search the web for vitest",
      cwd: tmp,
      heuristicOnly: true,
      invokeModel: invokeModel as any,
      webSearch: webSearch as any,
      networkApproved: true,
    });

    expect(out).not.toBeNull();
    expect(out!.result.replyPath).toBe("research");
    expect(out!.result.ok).toBe(true);
    expect(out!.result.skippedModel).toBeFalsy();
    expect(webSearch).toHaveBeenCalled();
    expect(invokeModel).toHaveBeenCalledTimes(1);
    expect(out!.result.sources?.[0]?.url).toBe("https://vitest.dev/");
    expect(out!.result.reply).toMatch(/vitest\.dev/i);
    // Grounding: model prompt must include page evidence, not "no page text"
    const promptArg = String(invokeModel.mock.calls[0][0].prompt || "");
    expect(promptArg).toMatch(/Vitest is a blazing/);
    expect(promptArg).not.toMatch(/no page text/i);
  });

  it("empty web results do NOT call the model", async () => {
    const invokeModel = vi.fn(async () => ({
      text: "HALLUCINATED last update 2023-09-15 by username",
      model: "qwen2.5:1.5b",
      cloud: false,
      costUsd: 0,
      baseUrl: "http://localhost:11434",
    }));

    const webSearch = vi.fn(async () => ({
      provider: "duckduckgo" as const,
      query: "ابحث على النت عن آخر أخبار Ollama",
      hits: [],
      pages: [],
      usable: false,
      attempts: [
        {
          provider: "duckduckgo" as const,
          ok: false,
          hitCount: 0,
          ms: 50,
          error: "DuckDuckGo HTML returned 0 results",
        },
        {
          provider: "duckduckgo_lite" as const,
          ok: false,
          hitCount: 0,
          ms: 40,
          error: "DuckDuckGo lite returned 0 results",
        },
      ],
      failureReason:
        "duckduckgo: DuckDuckGo HTML returned 0 results; duckduckgo_lite: DuckDuckGo lite returned 0 results",
    }));

    const events: string[] = [];
    const out = await tryRunQuickPath({
      prompt: "ابحث على النت عن آخر أخبار Ollama",
      cwd: tmp,
      heuristicOnly: true,
      invokeModel: invokeModel as any,
      webSearch: webSearch as any,
      networkApproved: true,
      onEvent: (ev) => events.push(ev.type),
    });

    expect(out).not.toBeNull();
    expect(out!.result.replyPath).toBe("research");
    expect(out!.result.ok).toBe(true);
    expect(out!.result.skippedModel).toBe(true);
    expect(out!.result.model).toBeUndefined();
    expect(invokeModel).not.toHaveBeenCalled();
    expect(out!.result.sources).toEqual([]);
    expect(out!.result.searchFailureReason).toMatch(/DuckDuckGo/i);
    expect(out!.result.reply).toMatch(/لم أجد|لم ألخّص|تعذّر/i);
    expect(out!.result.reply).toMatch(/agency|وكالة|force/i);
    expect(out!.result.reply).not.toMatch(/2023-09-15|username|HALLUCINATED/i);
    expect(events.some((t) => t.includes("empty") || t.includes("skip") || t.includes("research"))).toBe(
      true
    );
  });

  it("returns null so agency/ops path is used for real tasks", async () => {
    const invokeModel = vi.fn();
    const out = await tryRunQuickPath({
      prompt: "اعمل ملف Excel على سطح المكتب",
      cwd: tmp,
      heuristicOnly: true,
      invokeModel: invokeModel as any,
    });
    expect(out).toBeNull();
    expect(invokeModel).not.toHaveBeenCalled();
  });

  it("forceAgency skips chat path", async () => {
    const out = await tryRunQuickPath({
      prompt: "مرحبا",
      cwd: tmp,
      forceAgency: true,
      heuristicOnly: true,
      invokeModel: vi.fn() as any,
    });
    expect(out).toBeNull();
  });
});

describe("web parse helpers", () => {
  it("unwraps DuckDuckGo uddg redirects", () => {
    const wrapped =
      "https://duckduckgo.com/l/?uddg=" +
      encodeURIComponent("https://ollama.com/blog") +
      "&rut=abc";
    expect(unwrapDuckRedirect(wrapped)).toBe("https://ollama.com/blog");
  });

  it("parses result__a anchors from DDG HTML", () => {
    const html = `
      <a class="result__a" href="https://duckduckgo.com/l/?uddg=${encodeURIComponent("https://example.com/a")}">Example A</a>
      <a href="https://example.com/b" class="result__a">Example B</a>
      <a class="result__snippet">Snippet A about the topic</a>
    `;
    const hits = parseDuckDuckGoHtml(html);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].url).toMatch(/^https:\/\/example\.com\//);
  });

  it("filterUsablePages drops short bodies", () => {
    expect(
      filterUsablePages([
        { title: "a", url: "https://a.test", snippet: "", text: "short" },
        {
          title: "b",
          url: "https://b.test",
          snippet: "",
          text: "x".repeat(100),
        },
      ]).map((p) => p.url)
    ).toEqual(["https://b.test"]);
  });

  it("emptyWebSearchReply is Arabic for ar locale", () => {
    const msg = emptyWebSearchReply("ar", "0 results");
    expect(msg).toMatch(/بحث الويب|لم ألخّص/);
    expect(msg).toMatch(/0 results/);
  });
});

describe("reply language for Arabic greeting", () => {
  it("deterministic Arabic greeting reply (no model)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sh-quick-lang-"));
    try {
      const out = await tryRunQuickPath({
        prompt: "مرحبا",
        cwd: tmp,
        heuristicOnly: true,
        invokeModel: async () => {
          throw new Error("model must not be called");
        },
      });
      expect(out!.result.language).toBe("ar");
      expect(out!.result.skippedModel).toBe(true);
      expect(replyMatchesLanguage(out!.result.reply, "ar")).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
