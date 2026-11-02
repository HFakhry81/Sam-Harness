/**
 * Phase 1 — real hybrid: one OpenAI-compatible adapter (LM Studio / OpenRouter /
 * Groq / Together / OpenAI), cloud-egress redaction, and cloud key detection.
 */
import * as http from "http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ChatOpenAiCompat,
  isLocalOpenAiCompatBase,
  openAiCompatUrl,
} from "../src/agent/providers/openAiCompat.js";
import { redactSensitive } from "../src/lib/security/redact.js";
import { cloudKeyPresent } from "../src/agent/models.js";

const ENV_KEYS = [
  "OLLAMA_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "SAM_FREE_BASE_URL",
  "SAM_FREE_MODEL",
  "SAM_FREE_API_KEY",
];
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = saved[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("phase 1 — OpenAI-compatible URL builder", () => {
  it("keeps an explicit /v1 root", () => {
    expect(openAiCompatUrl("http://localhost:1234/v1")).toBe(
      "http://localhost:1234/v1/chat/completions"
    );
    expect(openAiCompatUrl("https://openrouter.ai/api/v1/")).toBe(
      "https://openrouter.ai/api/v1/chat/completions"
    );
  });

  it("adds /v1 for a bare host", () => {
    expect(openAiCompatUrl("https://api.groq.com/openai")).toBe(
      "https://api.groq.com/openai/v1/chat/completions"
    );
  });

  it("detects loopback runtimes (LM Studio)", () => {
    expect(isLocalOpenAiCompatBase("http://localhost:1234/v1")).toBe(true);
    expect(isLocalOpenAiCompatBase("https://openrouter.ai/api/v1")).toBe(false);
  });
});

describe("phase 1 — cloud egress redaction", () => {
  it("strips provider keys, JWTs and env assignments", () => {
    const input = [
      "key sk-proj-abcdefghijklmnopqrstuvwxyz012345",
      "aws AKIAIOSFODNN7EXAMPLE",
      "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
      "OPENAI_API_KEY=supersecretvalue123",
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEowIBAAKCAQEA1234",
      "-----END RSA PRIVATE KEY-----",
      "normal sentence stays",
    ].join("\n");
    const out = redactSensitive(input);
    expect(out.hits).toBeGreaterThanOrEqual(4);
    expect(out.text).not.toContain("sk-proj-abcdefghijklmnopqrstuvwxyz012345");
    expect(out.text).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(out.text).not.toContain("supersecretvalue123");
    expect(out.text).not.toContain("MIIEowIBAAKCAQEA1234");
    expect(out.text).toContain("OPENAI_API_KEY=");
    expect(out.text).toContain("normal sentence stays");
  });

  it("leaves clean text untouched", () => {
    const clean = "Build a monthly expense report from the Spendy data.";
    expect(redactSensitive(clean)).toEqual({ text: clean, hits: 0, kinds: [] });
  });
});

describe("phase 1 — cloud key detection", () => {
  it("is false with no credentials", () => {
    expect(cloudKeyPresent()).toBe(false);
  });

  it("accepts OPENAI_API_KEY (previously dead config)", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    expect(cloudKeyPresent()).toBe(true);
  });

  it("accepts a configured free tier without any paid key", () => {
    process.env.SAM_FREE_BASE_URL = "https://openrouter.ai/api/v1";
    process.env.SAM_FREE_MODEL = "meta-llama/llama-3.1-8b-instruct:free";
    expect(cloudKeyPresent()).toBe(true);
  });
});

describe("phase 1 — adapter talks the OpenAI protocol", () => {
  it("posts to /v1/chat/completions and parses the reply", async () => {
    const seen: { path?: string; auth?: string; body?: any } = {};
    const server = http.createServer((req, res) => {
      seen.path = req.url;
      seen.auth = String(req.headers.authorization || "");
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        seen.body = JSON.parse(raw || "{}");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "pong" } }],
            usage: { total_tokens: 3 },
          })
        );
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      const model = new ChatOpenAiCompat({
        baseUrl: `http://127.0.0.1:${port}/v1`,
        apiKey: "local-key",
        model: "llama-3.1-8b",
        temperature: 0.1,
        maxTokens: 64,
      });
      const res = await model.invoke("ping");
      expect(String(res.content)).toBe("pong");
      expect(seen.path).toBe("/v1/chat/completions");
      expect(seen.auth).toBe("Bearer local-key");
      expect(seen.body.model).toBe("llama-3.1-8b");
      expect(seen.body.max_tokens).toBe(64);
      expect(seen.body.messages[0]).toEqual({ role: "user", content: "ping" });
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("surfaces provider errors with the host name", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "bad key" } }));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      const model = new ChatOpenAiCompat({
        baseUrl: `http://127.0.0.1:${port}/v1`,
        model: "m",
      });
      await expect(model.invoke("x")).rejects.toThrow(/401/);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
