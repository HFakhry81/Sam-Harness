/**
 * Phase 6 — verifiable quality gates for plan/task steps.
 * A step is never marked done until all gates pass; failures retry then escalate.
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { spawnSync } from "child_process";
import { getDriver, getPersistence } from "../db/index.js";
import type { SqlDriver } from "../db/types.js";
import { getActiveTenantId } from "../tenant/context.js";
import { resolveUserPath } from "../paths.js";
import { getEffectiveTrustPolicy } from "./config.js";
import { appendAudit } from "./auditLog.js";

export type GateKind =
  | "command"
  | "file_exists"
  | "file_absent"
  | "file_contains"
  | "output_match"
  | "desktop_postcondition"
  | "typecheck"
  | "lint"
  | "test";

export type GateSpec = {
  id: string;
  kind: GateKind;
  /** Shell command for command/typecheck/lint/test kinds. */
  command?: string;
  /** Working directory for command gates. */
  cwd?: string;
  /** Path for file_* gates. */
  path?: string;
  /** Substring / regex source for file_contains / output_match. */
  text?: string;
  /** Treat text as regex. */
  regex?: boolean;
  /** Desktop verify expectations (postcondition). */
  expectations?: Array<{
    kind: string;
    [key: string]: unknown;
  }>;
  /** Optional timeout ms for commands (default 120s). */
  timeoutMs?: number;
};

export type GateOutcome = {
  gateId: string;
  kind: GateKind;
  passed: boolean;
  detail: string;
  attempts: number;
  at: string;
  durationMs: number;
  data?: Record<string, unknown>;
};

export type StepGateResult = {
  stepId: string;
  runId: string;
  passed: boolean;
  escalated: boolean;
  outcomes: GateOutcome[];
  message: string;
};

function persistGateResult(
  driver: SqlDriver,
  input: {
    tenantId: string;
    runId: string;
    stepId: string;
    outcome: GateOutcome;
    escalated: boolean;
  }
): void {
  const id = `gate-${crypto.randomBytes(4).toString("hex")}`;
  driver
    .prepare(
      `INSERT INTO gate_results (
        id, tenant_id, run_id, step_id, gate_id, kind, passed, attempts, at, detail, escalated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.tenantId,
      input.runId,
      input.stepId,
      input.outcome.gateId,
      input.outcome.kind,
      input.outcome.passed ? 1 : 0,
      input.outcome.attempts,
      input.outcome.at,
      JSON.stringify({
        detail: input.outcome.detail,
        durationMs: input.outcome.durationMs,
        data: input.outcome.data || {},
      }),
      input.escalated ? 1 : 0
    );
}

export function listGateResults(
  runId: string,
  tenantId: string = getActiveTenantId(),
  driver: SqlDriver = getDriver()
): Array<{
  id: string;
  runId: string;
  stepId: string;
  gateId: string;
  kind: string;
  passed: boolean;
  attempts: number;
  at: string;
  detail: Record<string, unknown>;
  escalated: boolean;
}> {
  getPersistence();
  return driver
    .prepare(
      `SELECT * FROM gate_results WHERE tenant_id = ? AND run_id = ? ORDER BY at ASC`
    )
    .all(tenantId, runId)
    .map((r) => {
      let detail: Record<string, unknown> = {};
      try {
        detail = JSON.parse(String(r.detail || "{}"));
      } catch {
        detail = {};
      }
      return {
        id: String(r.id),
        runId: String(r.run_id),
        stepId: String(r.step_id),
        gateId: String(r.gate_id),
        kind: String(r.kind),
        passed: Boolean(Number(r.passed)),
        attempts: Number(r.attempts || 1),
        at: String(r.at),
        detail,
        escalated: Boolean(Number(r.escalated || 0)),
      };
    });
}

function resolveCommand(gate: GateSpec): string | null {
  if (gate.command && gate.command.trim()) return gate.command.trim();
  if (gate.kind === "typecheck") return "pnpm run typecheck";
  if (gate.kind === "lint") return "pnpm run typecheck"; // project has no separate lint; typecheck stands in
  if (gate.kind === "test") return "pnpm test";
  return null;
}

function runCommandGate(
  gate: GateSpec,
  cwd: string
): { passed: boolean; detail: string; data: Record<string, unknown> } {
  const cmd = resolveCommand(gate);
  if (!cmd) {
    return { passed: false, detail: "No command specified for gate", data: {} };
  }
  const workDir = gate.cwd ? path.resolve(cwd, gate.cwd) : cwd;
  const timeout = gate.timeoutMs ?? 120_000;
  const isWin = process.platform === "win32";
  const result = spawnSync(cmd, {
    cwd: workDir,
    shell: true,
    encoding: "utf-8",
    timeout,
    env: { ...process.env, FORCE_COLOR: "0" },
    windowsHide: isWin,
  });
  const stdout = String(result.stdout || "").slice(0, 4000);
  const stderr = String(result.stderr || "").slice(0, 4000);
  const code = result.status;
  if (result.error) {
    return {
      passed: false,
      detail: `Command error: ${result.error.message}`,
      data: { cmd, stdout, stderr, code },
    };
  }
  const passed = code === 0;
  return {
    passed,
    detail: passed
      ? `Command ok (exit 0): ${cmd}`
      : `Command failed (exit ${code}): ${cmd}${stderr ? ` — ${stderr.split("\n")[0]}` : ""}`,
    data: { cmd, code, stdout, stderr },
  };
}

function runFileExists(gate: GateSpec): { passed: boolean; detail: string } {
  if (!gate.path) return { passed: false, detail: "file_exists requires path" };
  const abs = resolveUserPath(gate.path);
  const ok = fs.existsSync(abs);
  return { passed: ok, detail: ok ? `Exists: ${abs}` : `Missing: ${abs}` };
}

function runFileAbsent(gate: GateSpec): { passed: boolean; detail: string } {
  if (!gate.path) return { passed: false, detail: "file_absent requires path" };
  const abs = resolveUserPath(gate.path);
  const gone = !fs.existsSync(abs);
  return { passed: gone, detail: gone ? `Absent: ${abs}` : `Still present: ${abs}` };
}

function runFileContains(gate: GateSpec): { passed: boolean; detail: string } {
  if (!gate.path || gate.text == null) {
    return { passed: false, detail: "file_contains requires path + text" };
  }
  const abs = resolveUserPath(gate.path);
  if (!fs.existsSync(abs)) {
    return { passed: false, detail: `Missing file: ${abs}` };
  }
  const body = fs.readFileSync(abs, "utf-8");
  let ok: boolean;
  if (gate.regex) {
    try {
      ok = new RegExp(gate.text, "m").test(body);
    } catch (e) {
      return { passed: false, detail: `Invalid regex: ${String(e)}` };
    }
  } else {
    ok = body.includes(gate.text);
  }
  return {
    passed: ok,
    detail: ok
      ? `Contains match in ${abs}`
      : `Content not found in ${abs}: ${gate.text.slice(0, 80)}`,
  };
}

function runOutputMatch(
  gate: GateSpec,
  context: { output?: string }
): { passed: boolean; detail: string } {
  const hay = context.output ?? "";
  if (gate.text == null) {
    return { passed: false, detail: "output_match requires text" };
  }
  let ok: boolean;
  if (gate.regex) {
    try {
      ok = new RegExp(gate.text, "m").test(hay);
    } catch (e) {
      return { passed: false, detail: `Invalid regex: ${String(e)}` };
    }
  } else {
    ok = hay.includes(gate.text);
  }
  return {
    passed: ok,
    detail: ok ? "Output matched" : `Output missing: ${gate.text.slice(0, 80)}`,
  };
}

async function runDesktopPostcondition(
  gate: GateSpec
): Promise<{ passed: boolean; detail: string; data?: Record<string, unknown> }> {
  const expectations = gate.expectations || [];
  if (!expectations.length) {
    return { passed: false, detail: "desktop_postcondition requires expectations" };
  }
  try {
    const { getDesktopBackend } = await import("../../tools/desktop/backendFactory.js");
    const { verifyAfterAct } = await import("../../tools/desktop/verify.js");
    const backend = getDesktopBackend();
    const v = await verifyAfterAct(backend, expectations as never, { retries: 1 });
    return {
      passed: v.ok,
      detail: v.ok
        ? `Desktop postcondition ok (${expectations.length} checks)`
        : `Desktop postcondition failed: ${(v.details || []).join("; ")}`,
      data: { details: v.details, attempts: v.attempts },
    };
  } catch (e) {
    return {
      passed: false,
      detail: `Desktop verify error: ${String((e as Error)?.message || e)}`,
    };
  }
}

/** Evaluate a single gate once (no retry). */
export async function evaluateGate(
  gate: GateSpec,
  opts: { cwd?: string; output?: string } = {}
): Promise<Omit<GateOutcome, "attempts">> {
  const started = Date.now();
  const at = new Date().toISOString();
  const cwd = opts.cwd || process.cwd();
  let result: { passed: boolean; detail: string; data?: Record<string, unknown> };

  switch (gate.kind) {
    case "command":
    case "typecheck":
    case "lint":
    case "test":
      result = runCommandGate(gate, cwd);
      break;
    case "file_exists":
      result = runFileExists(gate);
      break;
    case "file_absent":
      result = runFileAbsent(gate);
      break;
    case "file_contains":
      result = runFileContains(gate);
      break;
    case "output_match":
      result = runOutputMatch(gate, { output: opts.output });
      break;
    case "desktop_postcondition":
      result = await runDesktopPostcondition(gate);
      break;
    default:
      result = { passed: false, detail: `Unknown gate kind: ${(gate as GateSpec).kind}` };
  }

  return {
    gateId: gate.id,
    kind: gate.kind,
    passed: result.passed,
    detail: result.detail,
    at,
    durationMs: Date.now() - started,
    data: result.data,
  };
}

/**
 * Run all gates for a step. Retries failed gates up to policy.gateRetryAttempts.
 * Never marks success on failure — sets escalated when retries exhausted.
 */
export async function runStepGates(input: {
  runId: string;
  stepId: string;
  gates: GateSpec[];
  cwd?: string;
  output?: string;
  tenantId?: string;
  /** Optional async work to re-run before each retry after the first attempt. */
  onRetry?: (attempt: number, failed: GateOutcome[]) => Promise<void>;
}): Promise<StepGateResult> {
  const policy = getEffectiveTrustPolicy(input.cwd);
  const tenantId = input.tenantId || getActiveTenantId();
  getPersistence();

  if (!policy.gatesEnabled) {
    return {
      stepId: input.stepId,
      runId: input.runId,
      passed: true,
      escalated: false,
      outcomes: [],
      message: "Gates disabled (SAM_TRUST_GATES=0)",
    };
  }

  if (!input.gates.length) {
    const msg = "No acceptance gates defined — refusing silent success";
    appendAudit({
      category: "gate",
      action: "step_no_gates",
      runId: input.runId,
      detail: { stepId: input.stepId, message: msg },
      tenantId,
    });
    return {
      stepId: input.stepId,
      runId: input.runId,
      passed: false,
      escalated: policy.escalateOnGateFail,
      outcomes: [],
      message: msg,
    };
  }

  const maxAttempts = Math.max(1, policy.gateRetryAttempts + 1);
  let outcomes: GateOutcome[] = [];
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt += 1;
    if (attempt > 1 && input.onRetry) {
      await input.onRetry(attempt, outcomes.filter((o) => !o.passed));
    }
    outcomes = [];
    for (const gate of input.gates) {
      const once = await evaluateGate(gate, {
        cwd: input.cwd,
        output: input.output,
      });
      outcomes.push({ ...once, attempts: attempt });
    }
    if (outcomes.every((o) => o.passed)) break;
  }

  const passed = outcomes.length > 0 && outcomes.every((o) => o.passed);
  const escalated = !passed && policy.escalateOnGateFail;
  const driver = getDriver();

  for (const o of outcomes) {
    persistGateResult(driver, {
      tenantId,
      runId: input.runId,
      stepId: input.stepId,
      outcome: o,
      escalated,
    });
  }

  const message = passed
    ? `All ${outcomes.length} gate(s) passed for step ${input.stepId}`
    : `Gate failure on step ${input.stepId} after ${attempt} attempt(s): ${outcomes
        .filter((o) => !o.passed)
        .map((o) => o.detail)
        .join("; ")}${escalated ? " — ESCALATED" : ""}`;

  appendAudit({
    category: "gate",
    action: passed ? "gates_passed" : escalated ? "gates_escalated" : "gates_failed",
    runId: input.runId,
    detail: {
      stepId: input.stepId,
      passed,
      escalated,
      attempt,
      outcomes: outcomes.map((o) => ({
        gateId: o.gateId,
        kind: o.kind,
        passed: o.passed,
        detail: o.detail,
      })),
    },
    tenantId,
  });

  return {
    stepId: input.stepId,
    runId: input.runId,
    passed,
    escalated,
    outcomes,
    message,
  };
}

/**
 * Mark a plan step done only when gates pass.
 * Returns { done:false } on failure — caller must retry or escalate, never fake done.
 */
export async function assertStepDone(input: {
  runId: string;
  stepId: string;
  gates: GateSpec[];
  cwd?: string;
  output?: string;
  tenantId?: string;
  onRetry?: (attempt: number, failed: GateOutcome[]) => Promise<void>;
}): Promise<{ done: boolean; result: StepGateResult }> {
  const result = await runStepGates(input);
  if (!result.passed) {
    return { done: false, result };
  }
  appendAudit({
    category: "action",
    action: "step_done",
    runId: input.runId,
    detail: { stepId: input.stepId, gates: result.outcomes.length },
    tenantId: input.tenantId,
  });
  return { done: true, result };
}
