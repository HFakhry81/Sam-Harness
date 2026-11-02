/**
 * Phase 4 — bounded chat context / session memory for local models.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildChatContext,
  chatHistoryMaxChars,
  chatHistoryMaxMessages,
  historyBudgetForContext,
  renderChatHistory,
  trimChatTurns,
} from "../src/lib/conversation/context.js";
import { localOllamaOptions } from "../src/lib/ollamaLocal.js";
import { buildQuickPromptPayload } from "../src/lib/quickPath/quickModel.js";
import { runIntentRouter } from "../src/lib/intentRouter/index.js";

const ENV_KEYS = [
  "SAM_CHAT_HISTORY_ENABLED",
  "SAM_CHAT_HISTORY_MESSAGES",
  "SAM_CHAT_HISTORY_CHARS",
  "SAM_CHAT_HISTORY_MESSAGE_CHARS",
  "SAM_LOCAL_NUM_CTX",
] as const;

describe("bounded chat context", () => {
  const saved: Record<string, string | undefined> = {};
  let tmp: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sh-chat-context-"));
    prevHome = process.env.SAM_OUTPUT_HOME;
    process.env.SAM_OUTPUT_HOME = path.join(tmp, "out");
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    if (prevHome === undefined) delete process.env.SAM_OUTPUT_HOME;
    else process.env.SAM_OUTPUT_HOME = prevHome;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("defaults expose a larger local window and a bounded history", () => {
    expect(localOllamaOptions().numCtx).toBe(16_384);
    expect(chatHistoryMaxMessages()).toBe(12);
    expect(chatHistoryMaxChars()).toBe(6_000);
  });

  it("keeps the newest N turns in chronological order", () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `turn-${i}`,
    }));
    const ctx = buildChatContext(messages, { maxMessages: 4, maxChars: 10_000 });
    expect(ctx.turns.map((t) => t.content)).toEqual([
      "turn-6",
      "turn-7",
      "turn-8",
      "turn-9",
    ]);
    expect(ctx.dropped).toBe(6);
    expect(ctx.text).toMatch(/^User: turn-6/);
  });

  it("drops a trailing copy of the current prompt", () => {
    const ctx = buildChatContext(
      [
        { role: "user", content: "my name is Maz" },
        { role: "assistant", content: "Nice to meet you." },
        { role: "user", content: "What is a REST API?" },
      ],
      { currentPrompt: "  what is a REST api?  " }
    );
    expect(ctx.turns.map((t) => t.content)).toEqual([
      "my name is Maz",
      "Nice to meet you.",
    ]);
  });

  it("enforces the char budget by dropping the oldest turns", () => {
    const messages = [
      { role: "user" as const, content: "old ".repeat(80) },
      { role: "assistant" as const, content: "mid ".repeat(40) },
      { role: "user" as const, content: "newest question" },
    ];
    const ctx = buildChatContext(messages, { maxChars: 120, maxMessageChars: 500 });
    expect(ctx.text).toMatch(/newest question/);
    expect(ctx.text).not.toMatch(/old old/);
    expect(ctx.chars).toBeLessThanOrEqual(120);
  });

  it("trims a single long message head+tail instead of dropping it", () => {
    const long = "HEAD-" + "x".repeat(5_000) + "-TAIL";
    const ctx = buildChatContext(
      [{ role: "user", content: long }],
      { maxChars: 260, maxMessageChars: 260 }
    );
    expect(ctx.turns).toHaveLength(1);
    expect(ctx.turns[0].content).toMatch(/^HEAD-/);
    expect(ctx.turns[0].content).toMatch(/-TAIL$/);
    expect(ctx.turns[0].content).toMatch(/trimmed/);
    expect(ctx.truncated).toBe(1);
  });

  it("returns empty context when disabled", () => {
    process.env.SAM_CHAT_HISTORY_ENABLED = "0";
    const ctx = buildChatContext(
      [{ role: "user", content: "hello" }],
      { maxChars: 1000 }
    );
    expect(ctx.enabled).toBe(false);
    expect(ctx.turns).toEqual([]);
  });

  it("split budget keeps room for system + prompt + output", () => {
    expect(
      historyBudgetForContext({
        numCtx: 16_384,
        systemChars: 600,
        promptChars: 1_000,
        numPredict: 220,
        desiredChars: 6_000,
      })
    ).toBe(6_000);

    expect(
      historyBudgetForContext({
        numCtx: 4_096,
        systemChars: 600,
        promptChars: 12_000,
        numPredict: 768,
        desiredChars: 6_000,
      })
    ).toBe(0);
  });

  it("renderChatHistory labels roles and preserves order", () => {
    expect(
      renderChatHistory([
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ])
    ).toBe("User: hi\n\nAssistant: hello");
  });

  it("trimChatTurns returns metadata for dropped turns", () => {
    const out = trimChatTurns(
      [
        { role: "user", content: "a".repeat(400) },
        { role: "assistant", content: "b".repeat(400) },
        { role: "user", content: "latest" },
      ],
      { maxChars: 20, maxMessageChars: 200 }
    );
    expect(out.turns).toHaveLength(1);
    expect(out.turns[0].content).toBe("latest");
    expect(out.dropped).toBe(2);
  });
});

describe("prompt payload with history", () => {
  it("uses a plain string for one-shot calls", () => {
    const payload = buildQuickPromptPayload({
      system: "SYS",
      prompt: "hello",
    });
    expect(typeof payload.prompt).toBe("string");
    expect(payload.prompt).toContain("SYS");
    expect(payload.prompt).toContain("hello");
    expect(payload.historyTurns).toBe(0);
  });

  it("uses structured messages when history exists", () => {
    const payload = buildQuickPromptPayload({
      system: "SYS",
      prompt: "and then?",
      history: [
        { role: "user", content: "we discuss HTTP" },
        { role: "assistant", content: "HTTP is a protocol" },
      ],
    });
    expect(Array.isArray(payload.prompt)).toBe(true);
    const messages = payload.prompt as Array<{ _getType?: () => string; content: unknown }>;
    expect(messages).toHaveLength(4); // system + user + assistant + current user
    expect(messages.map((m) => m._getType?.())).toEqual([
      "system",
      "human",
      "ai",
      "human",
    ]);
    expect(payload.historyTurns).toBe(2);
  });
});

describe("runIntentRouter history wiring", () => {
  let tmp: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sh-history-router-"));
    prevHome = process.env.SAM_OUTPUT_HOME;
    process.env.SAM_OUTPUT_HOME = path.join(tmp, "out");
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.SAM_OUTPUT_HOME;
    else process.env.SAM_OUTPUT_HOME = prevHome;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("forwards bounded history to the chat model", async () => {
    const invokeModel = vi.fn(async () => ({
      text: "REST is an architectural style.",
      model: "qwen2.5:1.5b",
      cloud: false,
      costUsd: 0,
      baseUrl: "http://127.0.0.1:11434",
    }));
    const history = [
      { role: "user" as const, content: "We are talking about web APIs." },
      { role: "assistant" as const, content: "Got it — HTTP and REST." },
    ];

    const out = await runIntentRouter({
      prompt: "What is a REST API?",
      cwd: tmp,
      heuristicOnly: true,
      invokeModel: invokeModel as any,
      history,
    });

    expect(out).not.toBeNull();
    expect(out!.route).toBe("chat");
    expect(invokeModel).toHaveBeenCalledTimes(1);
    const call = invokeModel.mock.calls[0][0] as { history?: unknown[] };
    expect(call.history).toEqual(history);
  });
});
