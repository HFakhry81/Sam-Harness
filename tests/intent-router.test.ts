/**
 * Intent router — greetings stay chat; path audits go complex; no report packs for chat.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  classifyIntentHeuristic,
  classifyIntent,
  runIntentRouter,
  fallbackChatReply,
  shouldSkipChatModel,
} from "../src/lib/intentRouter/index.js";
import { appendMessage, loadConversation, newConversationId } from "../src/lib/conversation/history.js";
import { getOutputHome, ensureOutputHome } from "../src/lib/outputHome.js";
import { parseStructuredIntentOutput } from "../src/lib/intentRouter/model.js";
import type { WebSearchResult } from "../src/lib/quickPath/webSearch.js";

describe("intent router heuristics", () => {
  it("parses structured model tool decisions and bounds clarification choices", () => {
    expect(
      parseStructuredIntentOutput(
        '{"action":"search_web","query":"current Sam-Harness status"}'
      )
    ).toEqual({
      route: "research",
      searchQuery: "current Sam-Harness status",
    });
    expect(
      parseStructuredIntentOutput(
        '{"action":"ask_clarification","question":"Which format?","options":["A","B","C","D","E"]}'
      )
    ).toEqual({
      route: "clarify",
      clarifyQuestion: "Which format?",
      clarifyOptions: ["A", "B", "C", "D"],
    });
    expect(parseStructuredIntentOutput('{"action":"unknown"}')).toBeNull();
  });

  it("routes Arabic/English greetings to chat", () => {
    for (const p of [
      "اهلا",
      "أهلا",
      "مرحبا",
      "مرحباً",
      "السلام عليكم",
      "hi",
      "hello",
      "hey",
      "good morning",
      "thanks",
    ]) {
      const c = classifyIntentHeuristic(p);
      expect(c.route, p).toBe("chat");
    }
  });

  it("routes the exact owner greeting to chat (not agency)", () => {
    const c = classifyIntentHeuristic("مرحبا اسمي مز هيثم");
    expect(c.route).toBe("chat");
    expect(c.intent).toBe("smalltalk");
    expect(c.confidence).toBeGreaterThanOrEqual(0.9);
    expect(shouldSkipChatModel(c)).toBe(true);
  });

  it("skips model for Arabic greeting variants + name intros", () => {
    for (const p of [
      "مرحبا",
      "مرحباً",
      "اهلا",
      "أهلا",
      "السلام عليكم",
      "هاي",
      "مرحبا اسمي مز هيثم",
      "Hello my name is Maz",
    ]) {
      const c = classifyIntentHeuristic(p);
      expect(c.route, p).toBe("chat");
      expect(shouldSkipChatModel(c), p).toBe(true);
    }
  });

  it("routes research questions to research", () => {
    for (const p of [
      "search the web for TypeScript 5.5 release notes",
      "give me details about the latest OpenAI news",
      "ابحث لي على النت عن أخبار الذكاء الاصطناعي",
      "ما آخر أخبار أوبن إيه آي اليوم",
    ]) {
      const c = classifyIntentHeuristic(p);
      expect(c.route, p).toBe("research");
    }
  });

  it("routes path-based audit to complex", () => {
    const c = classifyIntentHeuristic(
      "حلل الكود في المسار E:\\UpNexa.com\\spendy"
    );
    expect(c.route).toBe("complex");
  });

  it("routes simple desktop actions to task", () => {
    const c = classifyIntentHeuristic("اعمل ملف Excel على سطح المكتب باسم report.xlsx");
    expect(c.route).toBe("task");
  });

  it("honors forceAgency → complex", async () => {
    const c = await classifyIntent("مرحبا", { forceAgency: true });
    expect(c.route).toBe("complex");
    expect(c.source).toBe("forced");
  });

  it("accepts structured search and clarification decisions", async () => {
    const search = await classifyIntent("Maybe this", {
      modelClassify: async () => ({
        route: "research",
        searchQuery: "Sam-Harness model routing",
      }),
    });
    expect(search.route).toBe("research");
    expect(search.searchQuery).toBe("Sam-Harness model routing");

    const clarify = await classifyIntent("Please do it", {
      modelClassify: async () => ({
        route: "clarify",
        clarifyQuestion: "Which output format should I use?",
        clarifyOptions: ["Markdown", "JSON"],
      }),
    });
    expect(clarify.route).toBe("clarify");
    expect(clarify.clarifyQuestion).toBe("Which output format should I use?");
    expect(clarify.clarifyOptions).toEqual(["Markdown", "JSON"]);
  });
});

describe("runIntentRouter chat has no artifacts", () => {
  let tmp: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sh-intent-"));
    prevHome = process.env.SAM_OUTPUT_HOME;
    process.env.SAM_OUTPUT_HOME = path.join(tmp, "output");
    ensureOutputHome();
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.SAM_OUTPUT_HOME;
    else process.env.SAM_OUTPUT_HOME = prevHome;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("chat greeting creates no report folder and no task.ts", async () => {
    const cwd = path.join(tmp, "cwd");
    fs.mkdirSync(cwd, { recursive: true });
    const invokeModel = vi.fn(async () => ({
      text: "SHOULD_NOT_RUN",
      model: "qwen2.5:1.5b",
      cloud: false,
      costUsd: 0,
      baseUrl: "http://127.0.0.1:11434",
    }));

    const out = await runIntentRouter({
      prompt: "مرحبا اسمي مز هيثم",
      cwd,
      heuristicOnly: true,
      invokeModel: invokeModel as any,
      writeResearchNote: false,
    });

    expect(out).not.toBeNull();
    expect(out!.route).toBe("chat");
    expect(out!.ok).toBe(true);
    expect(out!.noArtifacts).toBe(true);
    expect(out!.skippedModel).toBe(true);
    expect(out!.reply).toMatch(/أهلا|مرحبا|Sam-Harness/i);
    expect(out!.reply).not.toMatch(/SHOULD_NOT_RUN/);
    // Deterministic: never call a model for greetings / name intros
    expect(invokeModel).not.toHaveBeenCalled();
    expect(out!.durationMs).toBeLessThan(500);

    const reports = path.join(getOutputHome(), "reports");
    if (fs.existsSync(reports)) {
      const packs = fs
        .readdirSync(reports)
        .filter((d) => /^Sam-Harness no\./i.test(d));
      expect(packs).toEqual([]);
    }
    expect(fs.existsSync(path.join(cwd, "task.ts"))).toBe(false);
    expect(fs.existsSync(path.join(cwd, "final-report.md"))).toBe(false);
    expect(fs.existsSync(path.join(cwd, "execution-result.md"))).toBe(false);
  });

  it("console-facing route reason is ASCII for owner greeting", () => {
    const c = classifyIntentHeuristic("مرحبا اسمي مز هيثم");
    expect(c.reason).toMatch(/^[\x00-\x7F]+$/);
    const line = `route=${c.route} | ${c.reason} | 1ms | deterministic`;
    expect(line).toMatch(/^[\x00-\x7F]+$/);
    expect(line).not.toMatch(/·/);
  });

  it("falls back without escalating when model throws", async () => {
    const out = await runIntentRouter({
      prompt: "What is 2 + 2?",
      cwd: tmp,
      heuristicOnly: true,
      invokeModel: async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
      },
    });
    expect(out!.route).toBe("chat");
    expect(out!.ok).toBe(true);
    expect(out!.noArtifacts).toBe(true);
    expect(out!.reply).toContain("Could not connect to the local Ollama model");
    expect(out!.reply).toContain("ECONNREFUSED");
    expect(out!.error).toContain("ECONNREFUSED");
  });

  it("returns null for complex so agency can run", async () => {
    const out = await runIntentRouter({
      prompt: "analyze architecture at E:\\UpNexa.com\\spendy and produce reports",
      cwd: tmp,
      heuristicOnly: true,
      invokeModel: vi.fn() as any,
    });

    expect(out).toBeNull();
  });

  it("executes a structured web-search action in chat without writing a note", async () => {
    const cwd = path.join(tmp, "search-cwd");
    fs.mkdirSync(cwd, { recursive: true });
    let searchQuery = "";
    const webSearch = async (input: { query: string }): Promise<WebSearchResult> => {
      searchQuery = input.query;
      return {
        provider: "custom",
        query: input.query,
        hits: [],
        pages: [],
        usable: false,
        attempts: [],
        failureReason: "No test results",
      };
    };
    const out = await runIntentRouter({
      prompt: "Look into Sam-Harness",
      cwd,
      classify: async () => ({
        route: "research",
        intent: "web_research",
        confidence: 0.9,
        reason: "structured search tool call",
        source: "model",
        searchQuery: "Sam-Harness current release",
      }),
      webSearch,
      writeResearchNote: false,
    });

    expect(searchQuery).toBe("Sam-Harness current release");
    expect(out?.route).toBe("research");
    expect(out?.noArtifacts).toBe(true);
    expect(out?.notePath).toBeUndefined();
  });

  it("fallbackChatReply speaks Arabic for Arabic greetings", () => {
    const r = fallbackChatReply("مرحبا اسمي مز هيثم", "ar");
    expect(r).toMatch(/أهلا|مرحبا|Sam-Harness/);
  });
});

describe("conversation history under output home", () => {
  let tmp: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sh-conv-"));
    prevHome = process.env.SAM_OUTPUT_HOME;
    process.env.SAM_OUTPUT_HOME = path.join(tmp, "out");
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.SAM_OUTPUT_HOME;
    else process.env.SAM_OUTPUT_HOME = prevHome;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("persists messages in the database without creating transcript files", () => {
    const id = newConversationId();
    appendMessage(id, { role: "user", content: "مرحبا" });
    appendMessage(id, {
      role: "assistant",
      content: "أهلاً!",
      route: "chat",
      noArtifacts: true,
    });
    const loaded = loadConversation(id);
    expect(loaded.messages).toHaveLength(2);
    const conversations = path.join(getOutputHome(), "conversations");
    if (fs.existsSync(conversations)) {
      expect(
        fs.readdirSync(conversations).filter(
          (file) => file === `${id}.json` || file === `${id}.md`
        )
      ).toEqual([]);
    }
  });
});
