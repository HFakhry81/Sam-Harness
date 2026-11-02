/**
 * Phase 3 — isolation mode resolution + the classifier fixes that the eval suite
 * locks down. Kept fast and hermetic (no Docker probe, no model).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetSandboxCacheForTests,
  sandboxMode,
  sandboxStatus,
} from "../src/tools/sandbox.js";
import { classifyIntentHeuristic } from "../src/lib/intentRouter/classify.js";

const ENV_KEYS = ["SAM_SANDBOX_MODE", "SAM_SANDBOX_DOCKER"] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  __resetSandboxCacheForTests();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = saved[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  __resetSandboxCacheForTests();
});

describe("phase 3 — sandbox mode", () => {
  it("defaults to the hardened subprocess", () => {
    expect(sandboxMode()).toBe("subprocess");
  });

  it("accepts explicit modes", () => {
    process.env.SAM_SANDBOX_MODE = "docker";
    expect(sandboxMode()).toBe("docker");
    process.env.SAM_SANDBOX_MODE = " auto ";
    expect(sandboxMode()).toBe("auto");
    process.env.SAM_SANDBOX_MODE = "subprocess";
    expect(sandboxMode()).toBe("subprocess");
  });

  it("keeps SAM_SANDBOX_DOCKER=1 as an auto alias", () => {
    process.env.SAM_SANDBOX_DOCKER = "1";
    expect(sandboxMode()).toBe("auto");
  });

  it("falls back safely on unknown values", () => {
    process.env.SAM_SANDBOX_MODE = "firecracker";
    expect(sandboxMode()).toBe("subprocess");
  });

  it("reports a misconfiguration when docker is required but unprobed", () => {
    process.env.SAM_SANDBOX_MODE = "docker";
    const status = sandboxStatus();
    expect(status.mode).toBe("docker");
    expect(status.misconfigured).toBe(true);
    expect(status.effectiveMode).toBe("docker");
  });

  it("auto resolves to subprocess until Docker is known to be available", () => {
    process.env.SAM_SANDBOX_MODE = "auto";
    const status = sandboxStatus();
    expect(status.dockerAvailable).toBe(false);
    expect(status.effectiveMode).toBe("subprocess");
    expect(status.misconfigured).toBe(false);
  });
});

describe("phase 3 — classifier corrections", () => {
  it("routes version/'what's new' questions to research", () => {
    for (const p of [
      "What's new in Next.js 16?",
      "latest release notes for TypeScript",
      "ما الجديد في نسخة Node 24؟",
    ]) {
      expect(classifyIntentHeuristic(p).route, p).toBe("research");
    }
  });

  it("routes report requests to complex", () => {
    for (const p of [
      "اكتب تقرير عن أداء الشركة الربعي",
      "write a report on our monthly support backlog",
    ]) {
      expect(classifyIntentHeuristic(p).route, p).toBe("complex");
    }
  });

  it("routes filesystem counting questions to task", () => {
    for (const p of [
      "كم عدد الملفات في مجلد التنزيلات؟",
      "how many files are in the Downloads folder?",
    ]) {
      expect(classifyIntentHeuristic(p).route, p).toBe("task");
    }
  });

  it("routes bug-fix requests to complex", () => {
    expect(classifyIntentHeuristic("fix the login bug in src/auth.ts").route).toBe("complex");
  });

  it("keeps plain lookups in chat", () => {
    expect(classifyIntentHeuristic("What is a REST API?").route).toBe("chat");
    expect(classifyIntentHeuristic("ما معنى REST؟").route).toBe("chat");
  });
});
