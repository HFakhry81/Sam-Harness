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
} from "../src/lib/intentRouter/index.js";
import { appendMessage, loadConversation, newConversationId } from "../src/lib/conversation/history.js";
import { getOutputHome, ensureOutputHome } from "../src/lib/outputHome.js";

describe("intent router heuristics", () => {
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
      text: "أهلاً! كيف أقدر أساعدك؟",
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
    expect(out!.reply).toMatch(/أهلا|مرحبا|Sam-Harness/i);

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

  it("falls back without escalating when model throws", async () => {
    const out = await runIntentRouter({
      prompt: "مرحبا",
      cwd: tmp,
      heuristicOnly: true,
      invokeModel: async () => {
        throw new Error("ollama down");
      },
    });
    expect(out!.route).toBe("chat");
    expect(out!.ok).toBe(true);
    expect(out!.noArtifacts).toBe(true);
    expect(out!.reply.length).toBeGreaterThan(0);
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

  it("persists messages under conversations/", () => {
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
    const file = path.join(getOutputHome(), "conversations", `${id}.json`);
    expect(fs.existsSync(file)).toBe(true);
  });
});
