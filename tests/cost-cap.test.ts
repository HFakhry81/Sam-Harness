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
  recordUsage,
} from "../src/lib/costLedger.js";
import { saveHybridProfile } from "../src/controlplane/hybridProfile.js";
import { isCostCapExhausted, useOllamaCloudNow } from "../src/agent/models.js";

let tmp: string;
let prevCwd: string;
let prevKey: string | undefined;
let prevForce: string | undefined;
let prevHybrid: string | undefined;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sh-cost-"));
  prevCwd = process.cwd();
  prevKey = process.env.OLLAMA_API_KEY;
  prevForce = process.env.FORCE_LOCAL_SPECIALISTS;
  prevHybrid = process.env.HYBRID_MODE;
  process.chdir(tmp);
  __resetActiveRunForTests();
  delete process.env.FORCE_LOCAL_SPECIALISTS;
  delete process.env.HYBRID_MODE;
});

afterEach(() => {
  process.chdir(prevCwd);
  if (prevKey === undefined) delete process.env.OLLAMA_API_KEY;
  else process.env.OLLAMA_API_KEY = prevKey;
  if (prevForce === undefined) delete process.env.FORCE_LOCAL_SPECIALISTS;
  else process.env.FORCE_LOCAL_SPECIALISTS = prevForce;
  if (prevHybrid === undefined) delete process.env.HYBRID_MODE;
  else process.env.HYBRID_MODE = prevHybrid;
  fs.rmSync(tmp, { recursive: true, force: true });
  __resetActiveRunForTests();
});

describe("cost-cap enforcement", () => {
  it("cap of $0 blocks cloud eligibility", () => {
    saveHybridProfile(tmp, { mode: "auto", costCapUsd: 0 });
    process.env.OLLAMA_API_KEY = "sk-test-key";
    expect(isCostCapExhausted(tmp)).toBe(true);
    expect(useOllamaCloudNow()).toBe(false);
    expect(() => assertWithinCostCap(tmp, 0.001)).toThrow(CostCapExceededError);
  });

  it("records per-run and per-day usage by model", () => {
    saveHybridProfile(tmp, { mode: "auto", costCapUsd: 5 });
    const runId = beginCostRun("run-test-1");
    recordUsage(tmp, {
      model: "gpt-oss:120b-cloud",
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 0.05,
      cloud: true,
      runId,
    });
    recordUsage(tmp, {
      model: "gpt-oss:120b-cloud",
      inputTokens: 200,
      outputTokens: 100,
      costUsd: 0.02,
      cloud: true,
      runId,
    });
    const budget = getCostBudget(tmp);
    expect(budget.spentUsd).toBeCloseTo(0.07, 4);
    expect(budget.byModel["gpt-oss:120b-cloud"].calls).toBe(2);
    expect(budget.runSpentUsd).toBeCloseTo(0.07, 4);
    expect(budget.blocked).toBe(false);
  });

  it("chargeCloudCall throws with clear error when exceeding cap", () => {
    saveHybridProfile(tmp, { mode: "cloud", costCapUsd: 0.00001 });
    beginCostRun("run-over");
    expect(() =>
      chargeCloudCall(tmp, {
        model: "cloud-model",
        prompt: "x".repeat(4000),
        output: "y".repeat(2000),
      })
    ).toThrow(/Cost cap exceeded/i);
  });

  it("surfaces blockReason on exhausted budget", () => {
    saveHybridProfile(tmp, { mode: "auto", costCapUsd: 0.01 });
    recordUsage(tmp, {
      model: "m",
      costUsd: 0.01,
      inputTokens: 10,
      outputTokens: 10,
      cloud: true,
    });
    const budget = getCostBudget(tmp);
    expect(budget.blocked).toBe(true);
    expect(budget.blockReason).toMatch(/cap/i);
  });
});
