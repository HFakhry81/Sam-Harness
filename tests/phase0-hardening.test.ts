/**
 * Phase 0 hardening — spec §2/§6/§8 guarantees:
 *  - per-run cost cap (not only daily)
 *  - secrets denied by filename anywhere (target project `.env`, MCP configs, keys)
 *  - the Sam-Harness repo is never writable by tools, in any mode
 *  - owner token rejected in query strings except for the SSE stream
 */
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertAllowedPath } from "../src/lib/paths.js";
import {
  assertWriteAllowed,
  registerSourceRoots,
  registerWriteRoots,
  resetWritePolicy,
  setStrictWriteRoots,
} from "../src/lib/writePolicy.js";
import {
  __resetActiveRunForTests,
  assertWithinCostCap,
  beginCostRun,
  CostCapExceededError,
  getCostBudget,
  getDailyCostCapUsd,
  recordUsage,
} from "../src/lib/costLedger.js";
import { saveHybridProfile } from "../src/controlplane/hybridProfile.js";
import { extractOwnerTokenFromRequest } from "../src/controlplane/auth.js";

let tmp: string;
let prevCwd: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sh-p0-"));
  prevCwd = process.cwd();
  __resetActiveRunForTests();
  resetWritePolicy();
});

afterEach(() => {
  process.chdir(prevCwd);
  resetWritePolicy();
  __resetActiveRunForTests();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("phase 0 — secret filenames denied everywhere", () => {
  it("blocks a target project's .env (not just the harness cwd)", () => {
    const project = path.join(tmp, "client-app");
    fs.mkdirSync(project, { recursive: true });
    expect(() => assertAllowedPath(path.join(project, ".env"))).toThrow(/blocked/i);
    expect(() => assertAllowedPath(path.join(project, ".env.local"))).toThrow(/blocked/i);
    expect(() => assertAllowedPath(path.join(project, "id_rsa"))).toThrow(/blocked/i);
    expect(() => assertAllowedPath(path.join(project, "server.pem"))).toThrow(/blocked/i);
  });

  it("blocks harness control files that rewrite guardrails", () => {
    expect(() => assertAllowedPath(path.join(tmp, "mcp.json"))).toThrow(/blocked/i);
    expect(() => assertAllowedPath(path.join(tmp, "workspace-roots.json"))).toThrow(/blocked/i);
  });

  it("keeps .env.example readable", () => {
    const project = path.join(tmp, "client-app");
    fs.mkdirSync(project, { recursive: true });
    expect(() => assertAllowedPath(path.join(project, ".env.example"))).not.toThrow();
  });
});

describe("phase 0 — harness repo is never writable by tools", () => {
  it("blocks writes inside the repo even in non-strict (operational) mode", () => {
    setStrictWriteRoots(false);
    registerSourceRoots([]);
    registerWriteRoots([]);
    const insideRepo = path.join(prevCwd, "src", "phase0-should-not-exist.ts");
    const gate = assertWriteAllowed(insideRepo, "write");
    expect(gate.ok).toBe(false);
    expect(gate.reason).toMatch(/Sam-Harness repository/i);
  });

  it("still allows operational writes outside the repo and source roots", () => {
    setStrictWriteRoots(false);
    const outside = path.join(tmp, "desktop-note.txt");
    expect(assertWriteAllowed(outside, "write").ok).toBe(true);
  });

  it("strict mode keeps confining writes to write roots", () => {
    setStrictWriteRoots(true);
    registerWriteRoots([]);
    expect(assertWriteAllowed(path.join(tmp, "outside-root.txt"), "write").ok).toBe(false);
  });
});

describe("phase 0 — per-run cost cap", () => {
  it("blocks a second call when the run cap is spent, even with daily budget left", () => {
    saveHybridProfile(tmp, { mode: "auto", costCapUsd: 0.05, costCapUsdPerDay: 5 });
    const runId = beginCostRun("run-p0");
    recordUsage(tmp, {
      model: "cloud-model",
      inputTokens: 10,
      outputTokens: 10,
      costUsd: 0.04,
      cloud: true,
      runId,
    });

    const budget = getCostBudget(tmp);
    expect(budget.runBlocked).toBe(false);
    expect(budget.blocked).toBe(false);

    let err: unknown;
    try {
      assertWithinCostCap(tmp, 0.02);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CostCapExceededError);
    expect((err as CostCapExceededError).scope).toBe("run");
  });

  it("marks the run blocked once its cap is reached", () => {
    saveHybridProfile(tmp, { mode: "auto", costCapUsd: 0.05, costCapUsdPerDay: 5 });
    const runId = beginCostRun("run-p0b");
    recordUsage(tmp, {
      model: "cloud-model",
      inputTokens: 10,
      outputTokens: 10,
      costUsd: 0.05,
      cloud: true,
      runId,
    });
    const budget = getCostBudget(tmp);
    expect(budget.runBlocked).toBe(true);
    expect(budget.blocked).toBe(true);
    expect(budget.blockReason).toMatch(/Per-run/i);
  });

  it("keeps the daily cap when costCapUsdPerDay is set", () => {
    saveHybridProfile(tmp, { mode: "auto", costCapUsd: 1, costCapUsdPerDay: 2 });
    expect(getDailyCostCapUsd(tmp)).toBeCloseTo(2, 4);
  });
});

describe("phase 0 — owner token in query string", () => {
  const req = (method: string, url: string): http.IncomingMessage =>
    ({ method, url, headers: {} }) as unknown as http.IncomingMessage;

  it("accepts ?token= for the SSE stream only", () => {
    expect(extractOwnerTokenFromRequest(req("GET", "/api/events?token=abc"))).toBe("abc");
  });

  it("rejects ?token= on other GET routes", () => {
    expect(extractOwnerTokenFromRequest(req("GET", "/api/health?token=abc"))).toBeNull();
  });

  it("rejects ?token= on mutating requests", () => {
    expect(extractOwnerTokenFromRequest(req("POST", "/api/events?token=abc"))).toBeNull();
  });

  it("still accepts Authorization: Bearer everywhere", () => {
    const withBearer = {
      method: "POST",
      url: "/api/run",
      headers: { authorization: "Bearer abc" },
    } as unknown as http.IncomingMessage;
    expect(extractOwnerTokenFromRequest(withBearer)).toBe("abc");
  });
});
