/**
 * Phase 6 — verifiable gates, approvals, hash-chained audit, evidence.
 * No network calls.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetPersistenceForTests,
  getDriver,
  getPersistence,
  initPersistenceSync,
} from "../src/lib/db/index.js";
import { DEFAULT_TENANT_ID, setActiveTenantId } from "../src/lib/tenant/context.js";
import {
  __resetTrustPolicyForTests,
  appendAudit,
  assertStepDone,
  decideApproval,
  evaluateGate,
  GENESIS_HASH,
  getEffectiveTrustPolicy,
  listPendingApprovals,
  loadTrustPolicy,
  requireDestructiveFsApproval,
  requireSpendApproval,
  runStepGates,
  verifyAuditChain,
  writeEvidenceBundle,
  computeEntryHash,
} from "../src/lib/trust/index.js";
import { startDurableRun, finishDurableRun } from "../src/lib/durableRuns.js";
import { __resetActiveRunDirForTests } from "../src/lib/outputHome.js";

let tmp: string;
let prevCwd: string;
const envKeys = [
  "SAM_OUTPUT_HOME",
  "SAM_TRUST_GATES",
  "SAM_TRUST_AUDIT",
  "SAM_TRUST_EVIDENCE",
  "SAM_TRUST_REQUIRE_DESTRUCTIVE_APPROVAL",
  "SAM_TRUST_SPEND_APPROVAL_USD",
  "SAM_TRUST_GATE_RETRIES",
  "SAM_TRUST_ESCALATE_ON_GATE_FAIL",
  "APPROVE_DESTRUCTIVE",
  "APPROVE_SPEND",
  "APPROVE_TRUST",
] as const;
const prevEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sh-trust-"));
  prevCwd = process.cwd();
  for (const k of envKeys) {
    prevEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env.SAM_OUTPUT_HOME = path.join(tmp, "out");
  process.env.SAM_DATABASE_PATH = ":memory:";
  process.chdir(tmp);
  __resetActiveRunDirForTests();
  __resetTrustPolicyForTests();
  __resetPersistenceForTests();
  setActiveTenantId(DEFAULT_TENANT_ID);
  initPersistenceSync({ skipImport: true, skipBackup: true });
  getPersistence();
});

afterEach(() => {
  process.chdir(prevCwd);
  for (const k of envKeys) {
    if (prevEnv[k] === undefined) delete process.env[k];
    else process.env[k] = prevEnv[k];
  }
  __resetTrustPolicyForTests();
  __resetActiveRunDirForTests();
  __resetPersistenceForTests();
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* Windows locks */
  }
});

describe("trust policy", () => {
  it("loads defaults and env overrides", () => {
    const p = loadTrustPolicy(tmp);
    expect(p.gatesEnabled).toBe(true);
    expect(p.auditEnabled).toBe(true);
    expect(p.spendApprovalThresholdUsd).toBe(0.25);
    process.env.SAM_TRUST_SPEND_APPROVAL_USD = "0.1";
    process.env.SAM_TRUST_GATES = "0";
    __resetTrustPolicyForTests();
    const p2 = loadTrustPolicy(tmp);
    expect(p2.spendApprovalThresholdUsd).toBe(0.1);
    expect(p2.gatesEnabled).toBe(false);
  });

  it("merges trust-policy.json", () => {
    fs.writeFileSync(
      path.join(tmp, "trust-policy.json"),
      JSON.stringify({ spendApprovalThresholdUsd: 0.05, gateRetryAttempts: 1 }),
      "utf-8"
    );
    __resetTrustPolicyForTests();
    const p = loadTrustPolicy(tmp);
    expect(p.spendApprovalThresholdUsd).toBe(0.05);
    expect(p.gateRetryAttempts).toBe(1);
  });
});

describe("quality gates", () => {
  it("passes file_exists / file_contains gates", async () => {
    const f = path.join(tmp, "artifact.txt");
    fs.writeFileSync(f, "hello trust phase6", "utf-8");
    const exists = await evaluateGate({
      id: "g1",
      kind: "file_exists",
      path: f,
    });
    expect(exists.passed).toBe(true);
    const contains = await evaluateGate({
      id: "g2",
      kind: "file_contains",
      path: f,
      text: "phase6",
    });
    expect(contains.passed).toBe(true);
  });

  it("fails missing file and refuses empty gates as silent success", async () => {
    const missing = await evaluateGate({
      id: "miss",
      kind: "file_exists",
      path: path.join(tmp, "nope.txt"),
    });
    expect(missing.passed).toBe(false);

    const result = await assertStepDone({
      runId: "run-empty",
      stepId: "s1",
      gates: [],
    });
    expect(result.done).toBe(false);
    expect(result.result.escalated).toBe(true);
  });

  it("marks step done only when all gates pass; retries then escalates on fail", async () => {
    const f = path.join(tmp, "ok.txt");
    fs.writeFileSync(f, "ready", "utf-8");
    const ok = await assertStepDone({
      runId: "run-ok",
      stepId: "build",
      gates: [
        { id: "exists", kind: "file_exists", path: f },
        { id: "out", kind: "output_match", text: "READY", regex: true },
      ],
      output: "status READY",
    });
    expect(ok.done).toBe(true);
    expect(ok.result.passed).toBe(true);

    process.env.SAM_TRUST_GATE_RETRIES = "1";
    __resetTrustPolicyForTests();
    let retries = 0;
    const fail = await runStepGates({
      runId: "run-fail",
      stepId: "broken",
      gates: [{ id: "need", kind: "file_exists", path: path.join(tmp, "never.txt") }],
      onRetry: async () => {
        retries += 1;
      },
    });
    expect(fail.passed).toBe(false);
    expect(fail.escalated).toBe(true);
    expect(retries).toBeGreaterThanOrEqual(1);
    expect(fail.message).toMatch(/ESCALATED|Gate failure/i);
  });

  it("runs a cheap command gate (node -e exit 0)", async () => {
    const g = await evaluateGate({
      id: "cmd",
      kind: "command",
      command: 'node -e "process.exit(0)"',
      timeoutMs: 15_000,
    });
    expect(g.passed).toBe(true);

    const bad = await evaluateGate({
      id: "cmd-bad",
      kind: "command",
      command: 'node -e "process.exit(7)"',
      timeoutMs: 15_000,
    });
    expect(bad.passed).toBe(false);
  });
});

describe("approvals", () => {
  it("requires approval for destructive path outside output home", () => {
    // cwd is tmp; place the target in a sibling dir so it is outside cwd + SAM_OUTPUT_HOME
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "sh-outside-"));
    const outside = path.join(outsideDir, "user-file.txt");
    fs.writeFileSync(outside, "x", "utf-8");
    try {
      const decision = requireDestructiveFsApproval({
        tool: "delete_path",
        path: outside,
        cwd: tmp,
      });
      expect(decision.required).toBe(true);
      expect(decision.ok).toBe(false);
      expect(decision.approvalId).toBeTruthy();
      expect(listPendingApprovals().some((a) => a.id === decision.approvalId)).toBe(
        true
      );

      const granted = decideApproval(decision.approvalId!, true);
      expect(granted?.status).toBe("approved");

      const again = requireDestructiveFsApproval({
        tool: "delete_path",
        path: outside,
        approved: decision.approvalId,
        cwd: tmp,
      });
      expect(again.ok).toBe(true);
    } finally {
      try {
        fs.rmSync(outsideDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it("allows destructive ops under SAM_OUTPUT_HOME without approval", () => {
    const home = process.env.SAM_OUTPUT_HOME!;
    fs.mkdirSync(home, { recursive: true });
    const inside = path.join(home, "scratch.txt");
    fs.writeFileSync(inside, "y", "utf-8");
    const decision = requireDestructiveFsApproval({
      tool: "delete_path",
      path: inside,
    });
    expect(decision.required).toBe(false);
    expect(decision.ok).toBe(true);
  });

  it("requires spend approval above threshold", () => {
    process.env.SAM_TRUST_SPEND_APPROVAL_USD = "0.05";
    __resetTrustPolicyForTests();
    const low = requireSpendApproval({ amountUsd: 0.01, model: "t" });
    expect(low.required).toBe(false);
    expect(low.ok).toBe(true);

    const high = requireSpendApproval({ amountUsd: 0.2, model: "t" });
    expect(high.required).toBe(true);
    expect(high.ok).toBe(false);

    process.env.APPROVE_SPEND = "1";
    const auto = requireSpendApproval({ amountUsd: 0.2, model: "t" });
    expect(auto.ok).toBe(true);
  });
});

describe("audit log hash chain", () => {
  it("appends chained entries and verifies integrity", () => {
    const a = appendAudit({
      category: "system",
      action: "boot",
      detail: { n: 1 },
    });
    const b = appendAudit({
      category: "action",
      action: "tool",
      runId: "r1",
      detail: { tool: "write_file" },
    });
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a!.prevHash).toBe(GENESIS_HASH);
    expect(b!.prevHash).toBe(a!.entryHash);
    expect(b!.seq).toBe(a!.seq + 1);

    const ok = verifyAuditChain();
    expect(ok.ok).toBe(true);
    expect(ok.checked).toBeGreaterThanOrEqual(2);
    expect(ok.headHash).toBe(b!.entryHash);
  });

  it("detects tampering with entry_hash", () => {
    appendAudit({ category: "system", action: "a", detail: {} });
    appendAudit({ category: "system", action: "b", detail: {} });
    const driver = getDriver();
    driver
      .prepare(
        "UPDATE audit_log SET entry_hash = ? WHERE seq = ?"
      )
      .run("deadbeef".repeat(8), 2);
    const bad = verifyAuditChain();
    expect(bad.ok).toBe(false);
    expect(bad.brokenAtSeq).toBe(2);
    expect(bad.reason).toMatch(/entry_hash|mismatch/i);
  });

  it("computeEntryHash is stable for canonical detail key order", () => {
    const h1 = computeEntryHash({
      seq: 1,
      at: "t",
      category: "action",
      action: "x",
      runId: null,
      actor: "system",
      detail: { b: 2, a: 1 },
      prevHash: GENESIS_HASH,
    });
    const h2 = computeEntryHash({
      seq: 1,
      at: "t",
      category: "action",
      action: "x",
      runId: null,
      actor: "system",
      detail: { a: 1, b: 2 },
      prevHash: GENESIS_HASH,
    });
    expect(h1).toBe(h2);
  });
});

describe("evidence bundle", () => {
  it("writes report under runs/ and reports/", () => {
    const run = startDurableRun({ mode: "test-trust" });
    finishDurableRun(run.id, { ok: true, exitCode: 0 });
    const bundle = writeEvidenceBundle({ runId: run.id, cwd: tmp });
    expect(bundle).toBeTruthy();
    expect(fs.existsSync(bundle!.paths.reportJson)).toBe(true);
    expect(fs.existsSync(bundle!.paths.reportMd)).toBe(true);
    expect(bundle!.runId).toBe(run.id);
    expect(bundle!.status).toBe("completed");
    if (bundle!.paths.reportsCopy) {
      expect(fs.existsSync(bundle!.paths.reportsCopy)).toBe(true);
    }
    const verify = verifyAuditChain();
    expect(verify.ok).toBe(true);
  });
});

describe("effective policy cache", () => {
  it("caches until reset", () => {
    const a = getEffectiveTrustPolicy(tmp);
    process.env.SAM_TRUST_GATES = "0";
    const b = getEffectiveTrustPolicy(tmp);
    expect(b.gatesEnabled).toBe(a.gatesEnabled);
    __resetTrustPolicyForTests();
    const c = getEffectiveTrustPolicy(tmp);
    expect(c.gatesEnabled).toBe(false);
  });
});
