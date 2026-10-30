/**
 * Phase 8 — team config, per-role routing (incl. cap), pipeline reorder.
 * No network.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetTeamConfigCacheForTests,
  defaultTeamConfig,
  deleteTeamRole,
  loadTeamConfig,
  resolveDownstreamPipeline,
  resolveRoleModels,
  saveTeamConfig,
  setDownstreamOrder,
  upsertTeamRole,
  validateTeamConfig,
} from "../src/agency/teamConfig.js";
import { saveHybridProfile } from "../src/controlplane/hybridProfile.js";
import {
  canAffordPaid,
  resolveModelRoute,
  shouldDegradeToLocal,
} from "../src/lib/cost/index.js";
import {
  __resetActiveRunForTests,
  recordUsage,
} from "../src/lib/costLedger.js";
import { effectiveRoutingDecisions } from "../src/agent/models.js";
import { getPersistence } from "../src/lib/db/index.js";

let tmp: string;
let prevCwd: string;
const envKeys = [
  "OLLAMA_API_KEY",
  "FORCE_LOCAL_SPECIALISTS",
  "HYBRID_MODE",
  "SAM_ROUTING_ENABLED",
  "SAM_COST_NEAR_CAP_RATIO",
  "SAM_ROLE_STRATEGIST_MODEL",
  "SAM_ROLE_AUDITOR_CLOUD_MODEL",
  "SAM_ROLE_ARCHITECT_MODEL",
  "CEO_MODEL",
  "SAM_FREE_BASE_URL",
  "SAM_FREE_MODEL",
] as const;
const prevEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sh-p8-"));
  prevCwd = process.cwd();
  for (const k of envKeys) {
    prevEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.chdir(tmp);
  fs.mkdirSync(path.join(tmp, "config"), { recursive: true });
  // Seed default team.json from package defaults
  const seeded = defaultTeamConfig();
  fs.writeFileSync(
    path.join(tmp, "config", "team.json"),
    JSON.stringify(seeded, null, 2)
  );
  __resetTeamConfigCacheForTests();
  __resetActiveRunForTests();
  getPersistence();
  saveHybridProfile(tmp, { mode: "auto", costCapUsd: 0.5 });
});

afterEach(() => {
  process.chdir(prevCwd);
  for (const k of envKeys) {
    if (prevEnv[k] === undefined) delete process.env[k];
    else process.env[k] = prevEnv[k];
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  __resetTeamConfigCacheForTests();
  __resetActiveRunForTests();
});

describe("team config load/validate", () => {
  it("loads defaults with all builtin roles", () => {
    const cfg = loadTeamConfig(tmp);
    expect(cfg.version).toBe(1);
    expect(cfg.pipeline.keepReviewLoop).toBe(true);
    expect(cfg.pipeline.keepGoGate).toBe(true);
    expect(cfg.roles.find((r) => r.id === "strategist")?.models.cloud).toBe(
      "gemma4:cloud"
    );
    expect(cfg.roles.find((r) => r.id === "auditor")?.models.local).toBe(
      "gemma3:1b"
    );
  });

  it("rejects disabling review-loop roles", () => {
    const cfg = loadTeamConfig(tmp);
    const strat = cfg.roles.find((r) => r.id === "strategist")!;
    strat.enabled = false;
    const v = validateTeamConfig(cfg);
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => /strategist/.test(i.message))).toBe(true);
  });

  it("rejects clearing keepReviewLoop", () => {
    const cfg = loadTeamConfig(tmp);
    const bad = {
      ...cfg,
      pipeline: { ...cfg.pipeline, keepReviewLoop: false as unknown as true },
    };
    expect(validateTeamConfig(bad).ok).toBe(false);
  });

  it("applies SAM_ROLE_*_MODEL env overrides", () => {
    process.env.SAM_ROLE_STRATEGIST_MODEL = "custom-local:7b";
    process.env.SAM_ROLE_AUDITOR_CLOUD_MODEL = "custom-cloud";
    __resetTeamConfigCacheForTests();
    const models = resolveRoleModels("strategist", tmp);
    expect(models.local).toBe("custom-local:7b");
    const aud = resolveRoleModels("auditor", tmp);
    expect(aud.cloud).toBe("custom-cloud");
  });
});

describe("role CRUD + pipeline reorder", () => {
  it("upserts custom role into downstream pipeline", () => {
    const cfg = upsertTeamRole(tmp, {
      id: "research_analyst",
      title: "Research Analyst",
      prompt: "Write a research brief with citations.",
      stage: "downstream",
      prefersCloud: false,
      models: { local: "qwen2.5:1.5b", cloud: "gemma4:cloud", free: null },
    });
    expect(cfg.roles.some((r) => r.id === "research_analyst")).toBe(true);
    expect(cfg.pipeline.downstreamOrder).toContain("research_analyst");
    const pipe = resolveDownstreamPipeline(tmp);
    expect(pipe.map((r) => r.id)).toContain("research_analyst");
  });

  it("reorders downstream and skips disabled", () => {
    setDownstreamOrder(tmp, ["verifier", "marketer", "architect", "help"]);
    upsertTeamRole(tmp, { id: "help", enabled: false });
    const pipe = resolveDownstreamPipeline(tmp);
    expect(pipe.map((r) => r.id)).toEqual(["verifier", "marketer", "architect"]);
  });

  it("deletes custom roles only", () => {
    upsertTeamRole(tmp, {
      id: "temp_role",
      title: "Temp",
      prompt: "temp",
      models: { local: "a", cloud: "b" },
    });
    deleteTeamRole(tmp, "temp_role");
    expect(loadTeamConfig(tmp).roles.some((r) => r.id === "temp_role")).toBe(
      false
    );
    expect(() => deleteTeamRole(tmp, "strategist")).toThrow(/builtin/);
  });
});

describe("per-role routing + cap", () => {
  it("honors hybrid profile roles map (local forces local)", () => {
    process.env.OLLAMA_API_KEY = "test-key";
    saveHybridProfile(tmp, {
      mode: "auto",
      costCapUsd: 0.5,
      roles: { strategist: "local", auditor: "cloud" },
    });
    const localRoute = resolveModelRoute({
      cwd: tmp,
      role: "strategist",
      prefersCloud: true,
      cloudModel: "gemma4:cloud",
      localModel: "qwen2.5-coder:1.5b",
    });
    expect(localRoute.tier).toBe("local");
    expect(localRoute.reason).toMatch(/role hybrid map/);

    const cloudRoute = resolveModelRoute({
      cwd: tmp,
      role: "auditor",
      prefersCloud: true,
      cloudModel: "gemma4:cloud",
      localModel: "gemma3:1b",
    });
    expect(cloudRoute.tier).toBe("paid");
    expect(cloudRoute.cloud).toBe(true);
  });

  it("cap always wins over prefersCloud / hybrid cloud", () => {
    process.env.OLLAMA_API_KEY = "test-key";
    process.env.SAM_COST_NEAR_CAP_RATIO = "0.5";
    saveHybridProfile(tmp, {
      mode: "cloud",
      costCapUsd: 0.1,
      roles: { strategist: "cloud" },
    });
    recordUsage(tmp, {
      model: "gemma4:cloud",
      costUsd: 0.06,
      inputTokens: 100,
      outputTokens: 50,
      cloud: true,
    });
    expect(shouldDegradeToLocal(tmp)).toBe(true);
    const route = resolveModelRoute({
      cwd: tmp,
      role: "strategist",
      prefersCloud: true,
      cloudModel: "gemma4:cloud",
      localModel: "qwen2.5-coder:1.5b",
    });
    expect(route.cloud).toBe(false);
    expect(route.degraded).toBe(true);
    expect(route.reason).toMatch(/cap/i);
  });

  it("exposes effective decisions for API/doctor", () => {
    process.env.OLLAMA_API_KEY = "test-key";
    const decisions = effectiveRoutingDecisions(tmp, [
      "ceo_router",
      "strategist",
      "operator",
    ]);
    expect(decisions).toHaveLength(3);
    expect(decisions.find((d) => d.role === "ceo_router")?.route.tier).toBe(
      "local"
    );
    expect(decisions.find((d) => d.role === "strategist")?.models.cloud).toBe(
      "gemma4:cloud"
    );
  });

  it("never affords paid when cap is $0", () => {
    process.env.OLLAMA_API_KEY = "test-key";
    saveHybridProfile(tmp, { mode: "cloud", costCapUsd: 0 });
    expect(canAffordPaid(tmp, 0.001)).toBe(false);
    const route = resolveModelRoute({
      cwd: tmp,
      role: "auditor",
      prefersCloud: true,
      cloudModel: "gemma4:cloud",
      localModel: "gemma3:1b",
    });
    expect(route.cloud).toBe(false);
  });
});

describe("saveTeamConfig round-trip", () => {
  it("persists edits", () => {
    const cfg = loadTeamConfig(tmp);
    const arch = cfg.roles.find((r) => r.id === "architect")!;
    arch.models.local = "my-arch:latest";
    saveTeamConfig(tmp, cfg, { audit: false });
    __resetTeamConfigCacheForTests();
    expect(resolveRoleModels("architect", tmp).local).toBe("my-arch:latest");
  });
});
