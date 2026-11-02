/**
 * Deterministic offline eval runner (Phase 3).
 *
 * Runs the golden cases in `evals/cases.json` against the real modules — no
 * model calls, no network, no repository writes. Fails the build when a suite
 * drops below its threshold, so routing/security/cost regressions are caught by
 * CI instead of by a production incident.
 *
 * Usage:
 *   pnpm run eval            # all deterministic suites
 *   pnpm run eval -- --json  # machine-readable summary on stdout
 *   pnpm run eval -- --suite intent,cost
 *   pnpm run eval -- --live  # reserved for future model-backed suites
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";
import { classifyIntentHeuristic } from "../src/lib/intentRouter/classify.js";
import { redactSensitive } from "../src/lib/security/redact.js";
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
  endCostRun,
  recordUsage,
} from "../src/lib/costLedger.js";
import { saveHybridProfile } from "../src/controlplane/hybridProfile.js";
import { sandboxMode } from "../src/tools/sandbox.js";
import { getActiveTenantId, setActiveTenantId } from "../src/lib/tenant/context.js";
import {
  buildChatContext,
  type ChatTurn,
} from "../src/lib/conversation/context.js";
import { localOllamaOptions } from "../src/lib/ollamaLocal.js";

type EvalCase = {
  id: string;
  suite: "intent" | "security" | "cost" | "sandbox" | "context";
  prompt?: string;
  kind?: "redact" | "write" | "path" | "history" | "window";
  target?: string;
  input?: string;
  turns?: ChatTurn[];
  maxMessages?: number;
  maxChars?: number;
  maxMessageChars?: number;
  runCapUsd?: number;
  dailyCapUsd?: number;
  spentUsd?: number;
  addUsd?: number;
  env?: Record<string, string>;
  expect: Record<string, unknown>;
};

type EvalFile = {
  version: number;
  thresholds: Record<string, number>;
  cases: EvalCase[];
};

type CaseResult = { id: string; suite: string; ok: boolean; detail: string };

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

/**
 * All eval scratch/state lives in an isolated output home so a developer run
 * never touches their real ledger, DB, or reports.
 */
let scratchRoot = os.tmpdir();

function parseArgs(argv: string[]): { json: boolean; live: boolean; suites: string[] } {
  const suites: string[] = [];
  let json = false;
  let live = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") json = true;
    else if (a === "--live") live = true;
    else if (a === "--suite") suites.push(...String(argv[++i] || "").split(",").filter(Boolean));
    else if (a.startsWith("--suite=")) suites.push(...a.slice(8).split(",").filter(Boolean));
  }
  return { json, live, suites };
}

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(scratchRoot, prefix));
}

function withEnv<T>(patch: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(patch)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function runIntent(c: EvalCase): CaseResult {
  const d = classifyIntentHeuristic(String(c.prompt || ""));
  const wantRoute = String(c.expect.route || "");
  const wantIntent = String(c.expect.intent || "");
  const ok = d.route === wantRoute && d.intent === wantIntent;
  return {
    id: c.id,
    suite: c.suite,
    ok,
    detail: ok
      ? `route=${d.route} intent=${d.intent} conf=${d.confidence.toFixed(2)}`
      : `want route=${wantRoute} intent=${wantIntent}; got route=${d.route} intent=${d.intent} conf=${d.confidence.toFixed(2)} (${d.reason})`,
  };
}

function runRedact(c: EvalCase): CaseResult {
  const out = redactSensitive(String(c.input || ""));
  const absent = (c.expect.absent as string[] | undefined) || [];
  const present = (c.expect.present as string[] | undefined) || [];
  const leaked = absent.filter((s) => out.text.includes(s));
  const missing = present.filter((s) => !out.text.includes(s));
  const ok = leaked.length === 0 && missing.length === 0;
  return {
    id: c.id,
    suite: c.suite,
    ok,
    detail: ok
      ? `hits=${out.hits} kinds=${out.kinds.join(",") || "none"}`
      : `leaked=${JSON.stringify(leaked)} missing=${JSON.stringify(missing)}`,
  };
}

function runWrite(c: EvalCase): CaseResult {
  const tmp = tempDir("sh-eval-write-");
  // Keep the fake repo OUTSIDE the output home: writePolicy allows output-home
  // paths inside the repo on purpose, which would mask the immutability check.
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "sh-eval-repo-"));
  const client = path.join(tmp, "client");
  fs.mkdirSync(client, { recursive: true });
  try {
    return withEnv({ SAM_HARNESS_ROOT: repo }, () => {
      resetWritePolicy();
      setStrictWriteRoots(false);
      registerWriteRoots([]);
      registerSourceRoots([client]);

      const target =
        c.target === "repo"
          ? path.join(repo, "src", "agent.ts")
          : c.target === "source"
            ? path.join(client, "app.ts")
            : path.join(tmp, "desktop-note.txt");

      const gate = assertWriteAllowed(target, "write");
      const want = Boolean(c.expect.allowed);
      return {
        id: c.id,
        suite: c.suite,
        ok: gate.ok === want,
        detail: gate.ok === want ? `allowed=${gate.ok}` : `want allowed=${want}; got ${gate.ok} (${gate.reason})`,
      };
    });
  } finally {
    resetWritePolicy();
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

function runPath(c: EvalCase): CaseResult {
  const tmp = tempDir("sh-eval-path-");
  const target = path.join(tmp, String(c.target || "x").replace(/\//g, path.sep));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    let allowed = true;
    let reason = "";
    try {
      assertAllowedPath(target);
    } catch (e: any) {
      allowed = false;
      reason = e?.message || String(e);
    }
    const want = Boolean(c.expect.allowed);
    return {
      id: c.id,
      suite: c.suite,
      ok: allowed === want,
      detail: allowed === want ? `allowed=${allowed}` : `want allowed=${want}; got ${allowed} (${reason})`,
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function runCost(c: EvalCase): CaseResult {
  const tmp = tempDir("sh-eval-cost-");
  // The ledger lives in the shared tenant DB, so give each cost case its own
  // tenant; otherwise earlier spend leaks into later cases.
  const prevTenant = getActiveTenantId();
  setActiveTenantId(`eval-${c.id}`);
  __resetActiveRunForTests();
  try {
    saveHybridProfile(tmp, {
      mode: "auto",
      costCapUsd: Number(c.runCapUsd || 0),
      costCapUsdPerDay: Number(c.dailyCapUsd || 0),
    });
    const runId = beginCostRun(`eval-${c.id}`);
    const spent = Number(c.spentUsd || 0);
    if (spent > 0) {
      recordUsage(tmp, {
        model: "eval-cloud-model",
        inputTokens: 100,
        outputTokens: 100,
        costUsd: spent,
        cloud: true,
        runId,
      });
    }

    let err: any = null;
    try {
      assertWithinCostCap(tmp, Number(c.addUsd || 0));
    } catch (e) {
      err = e;
    }

    const wantError = c.expect.error == null ? null : String(c.expect.error);
    const wantScope = c.expect.scope ? String(c.expect.scope) : null;
    let ok: boolean;
    if (wantError === null) {
      ok = err === null;
    } else {
      ok = err?.code === wantError && (!wantScope || err?.scope === wantScope);
    }
    return {
      id: c.id,
      suite: c.suite,
      ok,
      detail: ok
        ? err
          ? `blocked scope=${err.scope}`
          : "allowed within caps"
        : `want ${wantError || "no error"}${wantScope ? `/${wantScope}` : ""}; got ${err ? `${err.code}/${err.scope}: ${err.message}` : "no error"}`,
    };
  } finally {
    endCostRun();
    __resetActiveRunForTests();
    setActiveTenantId(prevTenant);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function runHistory(c: EvalCase): CaseResult {
  const ctx = buildChatContext(c.turns || [], {
    maxMessages: c.maxMessages,
    maxChars: c.maxChars,
    maxMessageChars: c.maxMessageChars,
  });
  const present = (c.expect.present as string[] | undefined) || [];
  const absent = (c.expect.absent as string[] | undefined) || [];
  const wantTurns =
    c.expect.turns == null ? null : Number(c.expect.turns);
  const wantMaxChars =
    c.expect.maxChars == null ? null : Number(c.expect.maxChars);
  const missing = present.filter((s) => !ctx.text.includes(s));
  const leaked = absent.filter((s) => ctx.text.includes(s));
  const turnsOk = wantTurns == null || ctx.turns.length === wantTurns;
  const budgetOk = wantMaxChars == null || ctx.chars <= wantMaxChars;
  const ok = turnsOk && budgetOk && missing.length === 0 && leaked.length === 0;
  return {
    id: c.id,
    suite: c.suite,
    ok,
    detail: ok
      ? `turns=${ctx.turns.length} chars=${ctx.chars}`
      : `turns=${ctx.turns.length} chars=${ctx.chars} missing=${JSON.stringify(
          missing
        )} unexpected=${JSON.stringify(leaked)}`,
  };
}

function runLocalWindow(c: EvalCase): CaseResult {
  const raw = c.env?.SAM_LOCAL_NUM_CTX;
  return withEnv({ SAM_LOCAL_NUM_CTX: raw }, () => {
    const got = localOllamaOptions().numCtx;
    const want = Number(c.expect.numCtx);
    return {
      id: c.id,
      suite: c.suite,
      ok: got === want,
      detail: got === want ? `numCtx=${got}` : `want numCtx=${want}; got ${got}`,
    };
  });
}

function runSandbox(c: EvalCase): CaseResult {
  const env: Record<string, string | undefined> = {
    SAM_SANDBOX_MODE: undefined,
    SAM_SANDBOX_DOCKER: undefined,
    ...(c.env || {}),
  };
  return withEnv(env, () => {
    const got = sandboxMode();
    const want = String(c.expect.mode || "");
    return {
      id: c.id,
      suite: c.suite,
      ok: got === want,
      detail: got === want ? `mode=${got}` : `want mode=${want}; got ${got}`,
    };
  });
}

function runCase(c: EvalCase): CaseResult {
  switch (c.suite) {
    case "intent":
      return runIntent(c);
    case "security":
      if (c.kind === "redact") return runRedact(c);
      if (c.kind === "path") return runPath(c);
      return runWrite(c);
    case "cost":
      return runCost(c);
    case "sandbox":
      return runSandbox(c);
    case "context":
      return c.kind === "window" ? runLocalWindow(c) : runHistory(c);
    default:
      return { id: c.id, suite: String(c.suite), ok: false, detail: "unknown suite" };
  }
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function main(): void {
  // Isolate all eval state (DB, ledger, reports) from the developer's install.
  const evalHome = fs.mkdtempSync(path.join(os.tmpdir(), "sh-eval-home-"));
  const prevOutputHome = process.env.SAM_OUTPUT_HOME;
  const prevTenant = process.env.SAM_TENANT_ID;
  process.env.SAM_OUTPUT_HOME = evalHome;
  delete process.env.SAM_TENANT_ID;
  scratchRoot = path.join(evalHome, "tmp");
  fs.mkdirSync(scratchRoot, { recursive: true });
  try {
    runMain(parseArgs(process.argv.slice(2)));
  } finally {
    if (prevOutputHome === undefined) delete process.env.SAM_OUTPUT_HOME;
    else process.env.SAM_OUTPUT_HOME = prevOutputHome;
    if (prevTenant === undefined) delete process.env.SAM_TENANT_ID;
    else process.env.SAM_TENANT_ID = prevTenant;
    try {
      fs.rmSync(evalHome, { recursive: true, force: true });
    } catch {
      /* sqlite handle may still be open on Windows; the temp dir is disposable */
    }
  }
}

function runMain(args: { json: boolean; live: boolean; suites: string[] }): void {
  if (args.live) {
    // No model-backed suites are defined yet; keep the flag harmless and explicit.
    console.error("[eval] --live: no live suites defined yet; running deterministic suites only");
  }

  const filePath = path.join(repoRoot, "evals", "cases.json");
  const spec = JSON.parse(fs.readFileSync(filePath, "utf8")) as EvalFile;
  const allowedSuites = args.suites.length ? new Set(args.suites) : null;
  const cases = spec.cases.filter((c) => !allowedSuites || allowedSuites.has(c.suite));

  if (!cases.length) {
    console.error(`[eval] no cases matched suites: ${args.suites.join(",")}`);
    process.exitCode = 1;
    return;
  }

  const results: CaseResult[] = [];
  for (const c of cases) {
    let r: CaseResult;
    try {
      r = runCase(c);
    } catch (e: any) {
      r = { id: c.id, suite: c.suite, ok: false, detail: `runner error: ${e?.message || e}` };
    }
    results.push(r);
    if (!args.json) {
      console.log(`${r.ok ? "[PASS]" : "[FAIL]"} ${r.id} — ${r.detail}`);
    }
  }

  const suites = [...new Set(results.map((r) => r.suite))].sort();
  const perSuite = suites.map((s) => {
    const rows = results.filter((r) => r.suite === s);
    const pass = rows.filter((r) => r.ok).length;
    const acc = pass / rows.length;
    const threshold = Number(spec.thresholds[s] ?? 1);
    return { suite: s, pass, total: rows.length, acc, threshold, ok: acc + 1e-9 >= threshold };
  });

  const pass = results.filter((r) => r.ok).length;
  const overall = pass / results.length;
  const overallThreshold = Number(spec.thresholds.overall ?? 1);
  const ok = overall + 1e-9 >= overallThreshold && perSuite.every((s) => s.ok);

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          ok,
          overall: { pass, total: results.length, accuracy: Number(overall.toFixed(4)), threshold: overallThreshold },
          suites: perSuite.map((s) => ({ ...s, accuracy: Number(s.acc.toFixed(4)) })),
          failures: results.filter((r) => !r.ok).map((r) => ({ id: r.id, suite: r.suite, detail: r.detail })),
        },
        null,
        2
      )
    );
  } else {
    console.log("");
    for (const s of perSuite) {
      console.log(
        `${s.ok ? "[OK]  " : "[FAIL]"} ${s.suite.padEnd(9)} ${String(s.pass).padStart(3)}/${String(s.total).padEnd(3)} ${pct(s.acc).padStart(6)} (min ${pct(s.threshold)})`
      );
    }
    console.log(`\noverall ${pass}/${results.length} = ${pct(overall)} (min ${pct(overallThreshold)})`);
    if (ok) console.log("PASS");
    else {
      console.error("FAILED cases:");
      for (const r of results.filter((x) => !x.ok)) console.error(`  - ${r.id}: ${r.detail}`);
    }
  }

  if (!ok) process.exitCode = 1;
}

main();
