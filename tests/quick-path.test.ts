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
} from "../src/lib/quickPath/index.js";
import type { QuickPathResult } from "../src/lib/quickPath/index.js";

describe("classifyIntentHeuristic", () => {
  it("classifies Arabic greetings as smalltalk → quick", () => {
    for (const p of ["اهلا", "أهلا", "مرحبا", "مرحباً", "السلام عليكم", "صباح الخير"]) {
      const c = classifyIntentHeuristic(p);
      expect(c.intent, p).toBe("smalltalk");
      expect(c.replyPath, p).toBe("quick");
    }
  });

  it("classifies English greetings as smalltalk → quick", () => {
    for (const p of ["hi", "hello", "hey", "good morning", "thanks"]) {
      const c = classifyIntentHeuristic(p);
      expect(c.intent, p).toBe("smalltalk");
      expect(c.replyPath, p).toBe("quick");
    }
  });

  it("classifies simple questions as quick", () => {
    const c = classifyIntentHeuristic("What is a REST API?");
    expect(c.intent).toBe("simple_question");
    expect(c.replyPath).toBe("quick");
    const ar = classifyIntentHeuristic("ما معنى REST؟");
    expect(ar.replyPath).toBe("quick");
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
      expect(c.replyPath, p).toBe("web");
    }
  });

  it("routes real tasks to agency", () => {
    for (const p of [
      "اعمل ملف Excel على سطح المكتب باسم report.xlsx",
      "analyze Maw3ed architecture and produce a gap matrix",
      "implement the patch on the client repo",
      "افتح Notepad واكتب Hello",
      "انقل الملف report.md إلى Downloads",
    ]) {
      const c = classifyIntentHeuristic(p);
      expect(c.intent, p).toBe("task");
      expect(c.replyPath, p).toBe("agency");
    }
  });

  it("honors forceAgency", async () => {
    const c = await classifyIntent("مرحبا", { forceAgency: true });
    expect(c.intent).toBe("task");
    expect(c.replyPath).toBe("agency");
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

  it("quick path uses injected local model for greetings", async () => {
    const invokeModel = vi.fn(async () => ({
      text: "أهلاً! كيف أقدر أساعدك اليوم؟",
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
    expect(out!.result.replyPath).toBe("quick");
    expect(out!.result.ok).toBe(true);
    expect(out!.result.model).toBe("qwen2.5:1.5b");
    expect(out!.result.language).toBe("ar");
    expect(invokeModel).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(tmp, "execution-result.md"))).toBe(true);
  });

  it("web path uses mocked search and cites URLs", async () => {
    const invokeModel = vi.fn(async () => ({
      text: "ملخص قصير عن الموضوع [1].",
      model: "qwen2.5:1.5b",
      cloud: false,
      costUsd: 0,
      baseUrl: "http://localhost:11434",
    }));

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
          text: "Vitest is a blazing fast unit test framework.",
        },
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
    expect(out!.result.replyPath).toBe("web");
    expect(out!.result.ok).toBe(true);
    expect(webSearch).toHaveBeenCalled();
    expect(out!.result.sources?.[0]?.url).toBe("https://vitest.dev/");
    expect(out!.result.reply).toMatch(/vitest\.dev/i);
  });

  it("returns null so agency path is used for real tasks", async () => {
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

  it("forceAgency skips quick path", async () => {
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

describe("reply language for Arabic greeting", () => {
  it("quick result language is ar for اهلا", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sh-quick-lang-"));
    try {
      const out = await tryRunQuickPath({
        prompt: "مرحبا",
        cwd: tmp,
        heuristicOnly: true,
        invokeModel: async () =>
          ({
            text: "مرحباً بك! كيف يمكنني مساعدتك؟",
            model: "qwen2.5:1.5b",
            cloud: false,
            costUsd: 0,
            baseUrl: "http://127.0.0.1:11434",
          }) as QuickPathResult extends never ? never : any,
      });
      expect(out!.result.language).toBe("ar");
      expect(replyMatchesLanguage(out!.result.reply, "ar")).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
