/**
 * Phase 5 — near-zero cost: routing, caching, compaction, accounting, cap.
 * No real network calls.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetActiveRunForTests,
  assertWithinCostCap,
  beginCostRun,
  chargeCloudCall,
  CostCapExceededError,
  getCostBudget,
  getRunTokenTotals,
  recordUsage,
} from "../src/lib/costLedger.js";
import { saveHybridProfile } from "../src/controlplane/hybridProfile.js";
import {
  buildCacheKey,
  buildProviderCacheHints,
  canAffordPaid,
  classifyDifficulty,
  clearPromptCache,
  compactContext,
  escalateTier,
  getCachedResponse,
  lightNormalize,
  loadCostOptConfig,
  promptCacheStats,
  resolveModelRoute,
  scoreDifficulty,
  setCachedResponse,
  shouldDegradeToLocal,
} from "../src/lib/cost/index.js";
import {
  isCostCapExhausted,
  routeForTask,
  useOllamaCloudNow,
} from "../src/agent/models.js";
import { getPersistence } from "../src/lib/db/index.js";

let tmp: string;
let prevCwd: string;
const envKeys = [
  "OLLAMA_API_KEY",
  "FORCE_LOCAL_SPECIALISTS",
  "HYBRID_MODE",
  "SAM_ROUTING_ENABLED",
  "SAM_CACHE_ENABLED",
  "SAM_PROVIDER_PROMPT_CACHE",
  "SAM_COST_NEAR_CAP_RATIO",
  "SAM_FREE_BASE_URL",
  "SAM_FREE_API_KEY",
  "SAM_FREE_MODEL",
  "SAM_LOCAL_BASE_URL",
  "SAM_LOCAL_MODEL",
  "SAM_PAID_MODEL",
  "SAM_PREFER_FREE_FOR_STANDARD",
  "SAM_ESCALATE_CONFIDENCE_BELOW",
  "CEO_MODEL",
] as const;
const prevEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sh-nzc-"));
  prevCwd = process.cwd();
  for (const k of envKeys) {
    prevEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.chdir(tmp);
  __resetActiveRunForTests();
  getPersistence(); // ensure in-memory DB from tests/setup.ts
  clearPromptCache();
  saveHybridProfile(tmp, { mode: "auto", costCapUsd: 0.5 });
});

afterEach(() => {
  process.chdir(prevCwd);
  for (const k of envKeys) {
    if (prevEnv[k] === undefined) delete process.env[k];
    else process.env[k] = prevEnv[k];
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  __resetActiveRunForTests();
  clearPromptCache();
});

describe("difficulty classification", () => {
  it("marks CEO router as cheap", () => {
    expect(classifyDifficulty({ role: "ceo_router", prompt: "route this" })).toBe(
      "cheap"
    );
    expect(scoreDifficulty({ role: "ceo_router" })).toBeLessThan(0.3);
  });

  it("marks strategist/auditor as premium", () => {
    expect(classifyDifficulty({ role: "strategist" })).toBe("premium");
    expect(classifyDifficulty({ role: "auditor" })).toBe("premium");
    expect(classifyDifficulty({ role: "architect" })).toBe("premium");
  });

  it("escalates on verification failure or low confidence", () => {
    expect(escalateTier("cheap", { verificationFailed: true })).toBe("standard");
    expect(escalateTier("standard", { confidence: 0.2, threshold: 0.55 })).toBe(
      "premium"
    );
    expect(escalateTier("standard", { confidence: 0.9 })).toBe("standard");
  });

  it("honors force flags", () => {
    expect(classifyDifficulty({ forcePremium: true, role: "ceo" })).toBe("premium");
    expect(classifyDifficulty({ forceCheap: true, role: "auditor" })).toBe("cheap");
  });
});

describe("model routing", () => {
  it("routes cheap tasks to local with zero estimated cost", () => {
    process.env.OLLAMA_API_KEY = "sk-test";
    const route = resolveModelRoute({
      cwd: tmp,
      role: "ceo_router",
      forceCheap: true,
    });
    expect(route.tier).toBe("local");
    expect(route.cloud).toBe(false);
    expect(route.estimatedUsd).toBe(0);
    expect(route.baseUrl).toMatch(/11434/);
  });

  it("routes premium to paid when key + budget allow", () => {
    process.env.OLLAMA_API_KEY = "sk-test";
    const route = resolveModelRoute({
      cwd: tmp,
      role: "strategist",
      cloudModel: "gemma4:cloud",
    });
    expect(route.tier).toBe("paid");
    expect(route.cloud).toBe(true);
    expect(route.estimatedUsd).toBeGreaterThan(0);
    expect(route.headers?.Authorization).toMatch(/Bearer/);
  });

  it("degrades to local near the cost cap and never selects paid", () => {
    process.env.OLLAMA_API_KEY = "sk-test";
    process.env.SAM_COST_NEAR_CAP_RATIO = "0.5"; // degrade when ≤50% left
    saveHybridProfile(tmp, { mode: "auto", costCapUsd: 0.1 });
    recordUsage(tmp, {
      model: "gemma4:cloud",
      costUsd: 0.06,
      inputTokens: 100,
      outputTokens: 50,
      cloud: true,
    });
    expect(shouldDegradeToLocal(tmp)).toBe(true);
    expect(canAffordPaid(tmp, 0.01)).toBe(false);
    const route = resolveModelRoute({ cwd: tmp, role: "auditor" });
    expect(route.tier).not.toBe("paid");
    expect(route.cloud).toBe(false);
    expect(route.degraded).toBe(true);
  });

  it("uses free tier when configured and paid is blocked", () => {
    process.env.OLLAMA_API_KEY = "sk-test";
    process.env.SAM_FREE_BASE_URL = "http://free.example/v1";
    process.env.SAM_FREE_MODEL = "free-small";
    process.env.SAM_FREE_API_KEY = "free-key";
    saveHybridProfile(tmp, { mode: "auto", costCapUsd: 0 });
    const route = resolveModelRoute({ cwd: tmp, role: "architect" });
    expect(route.tier).toBe("free");
    expect(route.cloud).toBe(false);
    expect(route.model).toBe("free-small");
    expect(route.degraded).toBe(true);
  });

  it("FORCE_LOCAL_SPECIALISTS keeps everything local", () => {
    process.env.OLLAMA_API_KEY = "sk-test";
    process.env.FORCE_LOCAL_SPECIALISTS = "1";
    const route = routeForTask({ cwd: tmp, role: "strategist" });
    expect(route.tier).toBe("local");
    expect(useOllamaCloudNow()).toBe(false);
  });

  it("hybrid cloud mode prefers paid for non-cheap when affordable", () => {
    process.env.OLLAMA_API_KEY = "sk-test";
    saveHybridProfile(tmp, { mode: "cloud", costCapUsd: 0.5 });
    const route = resolveModelRoute({
      cwd: tmp,
      role: "help",
      prompt: "x".repeat(500),
    });
    // help is not premium role → standard; cloud mode still pays
    expect(route.tier).toBe("paid");
  });
});

describe("prompt cache + compaction", () => {
  it("stores and hits exact cache without network", () => {
    const model = "local-test";
    const prompt = "hello cache world";
    const key = buildCacheKey(model, prompt);
    expect(getCachedResponse(model, prompt).hit).toBe(false);
    const stored = setCachedResponse(model, prompt, "cached-answer", {
      inputTokens: 10,
      outputTokens: 5,
    });
    expect(stored.stored).toBe(true);
    expect(stored.key).toBe(key);
    const hit = getCachedResponse(model, prompt);
    expect(hit.hit).toBe(true);
    expect(hit.response).toBe("cached-answer");
    expect(promptCacheStats().entries).toBeGreaterThanOrEqual(1);
  });

  it("normalizes CRLF so Windows and Unix share cache keys", () => {
    const a = buildCacheKey("m", "line1\r\nline2\r\n");
    const b = buildCacheKey("m", "line1\nline2\n");
    expect(a).toBe(b);
    expect(lightNormalize("a  \r\n\r\n\r\nb")).toBe("a\n\nb");
  });

  it("builds provider cache hints when enabled", () => {
    process.env.SAM_PROVIDER_PROMPT_CACHE = "1";
    const hints = buildProviderCacheHints("m", "prefix " + "x".repeat(100));
    expect(hints.enabled).toBe(true);
    expect(hints.promptCacheKey).toMatch(/^[a-f0-9]{64}$/);
    expect(hints.cacheControl?.type).toBe("ephemeral");
  });

  it("compacts oversized context while keeping head and tail", () => {
    const big = "HEAD-" + "m".repeat(30_000) + "-TAIL";
    const result = compactContext(big, {
      maxChars: 10_000,
      targetChars: 6_000,
      headChars: 500,
      tailChars: 500,
    });
    expect(result.truncated).toBe(true);
    expect(result.text.startsWith("HEAD-")).toBe(true);
    expect(result.text.endsWith("-TAIL")).toBe(true);
    expect(result.text).toMatch(/context compacted/);
    expect(result.compactedChars).toBeLessThan(result.originalChars);
    expect(result.compactedChars).toBeLessThanOrEqual(10_000);
  });

  it("leaves short prompts untouched", () => {
    const r = compactContext("short", { maxChars: 1000, targetChars: 800 });
    expect(r.truncated).toBe(false);
    expect(r.text).toBe("short");
  });
});

describe("accounting + cap behavior", () => {
  it("tracks per-run tokens for local ($0) and cloud charges", () => {
    saveHybridProfile(tmp, { mode: "auto", costCapUsd: 0.5 });
    const runId = beginCostRun("run-nzc-1");
    recordUsage(tmp, {
      model: "local-qwen",
      inputTokens: 100,
      outputTokens: 40,
      costUsd: 0,
      cloud: false,
      runId,
    });
    recordUsage(tmp, {
      model: "gemma4:cloud",
      inputTokens: 200,
      outputTokens: 80,
      costUsd: 0.02,
      cloud: true,
      runId,
    });
    const totals = getRunTokenTotals(tmp, runId);
    expect(totals.inputTokens).toBe(300);
    expect(totals.outputTokens).toBe(120);
    expect(totals.costUsd).toBeCloseTo(0.02, 4);
    expect(totals.cloudCalls).toBe(1);
    const budget = getCostBudget(tmp);
    // Only cloud $ counts against the cap
    expect(budget.spentUsd).toBeCloseTo(0.02, 4);
    expect(budget.blocked).toBe(false);
  });

  it("never exceeds the daily cap on chargeCloudCall", () => {
    saveHybridProfile(tmp, { mode: "auto", costCapUsd: 0.001 });
    beginCostRun("run-over");
    expect(() =>
      chargeCloudCall(tmp, {
        model: "cloud-model",
        prompt: "x".repeat(8000),
        output: "y".repeat(4000),
      })
    ).toThrow(CostCapExceededError);
    expect(getCostBudget(tmp).spentUsd).toBe(0);
  });

  it("cap of $0 blocks cloud eligibility and paid routes", () => {
    saveHybridProfile(tmp, { mode: "auto", costCapUsd: 0 });
    process.env.OLLAMA_API_KEY = "sk-test";
    expect(isCostCapExhausted(tmp)).toBe(true);
    expect(useOllamaCloudNow()).toBe(false);
    expect(() => assertWithinCostCap(tmp, 0.001)).toThrow(CostCapExceededError);
    const route = resolveModelRoute({ cwd: tmp, role: "strategist" });
    expect(route.cloud).toBe(false);
  });

  it("loadCostOptConfig reads env defaults", () => {
    const cfg = loadCostOptConfig();
    expect(cfg.routingEnabled).toBe(true);
    expect(cfg.cacheEnabled).toBe(true);
    expect(cfg.nearCapRemainingRatio).toBeCloseTo(0.15, 5);
    expect(cfg.localBaseUrl).toContain("11434");
  });
});
