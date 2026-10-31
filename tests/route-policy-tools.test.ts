/**
 * Phase 1 follow-up: routing (force-agency + Spendy intent), write policy,
 * path-with-spaces shell quoting, repeat guard.
 */
import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  classifyRouteIntent,
  parseForceRouteFlags,
  resolveAppRoute,
} from "../src/agency/routeIntent.js";
import {
  resetWritePolicy,
  registerSourceRoots,
  registerWriteRoots,
  assertWriteAllowed,
  setStrictWriteRoots,
  setDisableShell,
  isShellDisabled,
} from "../src/lib/writePolicy.js";
import { quoteShellPath, resolveShellArgv, executeTool } from "../src/tools/registry.js";
import {
  RepeatGuard,
  formatStructuredFailureMarkdown,
} from "../src/lib/repeatGuard.js";
import { getOutputHome, ensureOutputHome } from "../src/lib/outputHome.js";

const SPENDY =
  "examine project E:\\UpNexa.com\\spendy against spec docs in D:\\My Documents\\Spendy and produce reports";

const SPENDY_AR =
  'افحص المشروع "E:\\UpNexa.com\\spendy" مقابل المواصفات في "D:\\My Documents\\Spendy" وانتِج تقرير';

describe("route intent — Spendy / force flags", () => {
  it("classifies Spendy English prompt as architecture/audit", () => {
    const d = classifyRouteIntent(SPENDY);
    expect(d.route).toBe("architecture");
    expect(d.kind).toBe("audit");
    expect(d.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("classifies Arabic examine-against-spec as architecture/audit", () => {
    const d = classifyRouteIntent(SPENDY_AR);
    expect(d.route).toBe("architecture");
    expect(d.kind).toBe("audit");
  });

  it("--force-agency overrides task.ts operational", () => {
    const d = resolveAppRoute({
      task: SPENDY,
      argv: ["--force-agency", "--yes"],
      configuredRoute: "operational",
    });
    expect(d.route).toBe("architecture");
    expect(d.forced).toBe(true);
    expect(d.reason).toMatch(/force-agency/i);
  });

  it("Spendy without flag still overrides task.ts operational via intent", () => {
    const d = resolveAppRoute({
      task: SPENDY,
      argv: ["--yes"],
      configuredRoute: "operational",
    });
    expect(d.route).toBe("architecture");
    expect(d.kind).toBe("audit");
    expect(d.forced).toBe(false);
  });

  it("parseForceRouteFlags reads env and argv", () => {
    expect(
      parseForceRouteFlags(["--force-operational"], {}).forceOperational
    ).toBe(true);
    expect(
      parseForceRouteFlags([], { FORCE_AGENCY: "1" } as NodeJS.ProcessEnv).forceAgency
    ).toBe(true);
    expect(
      parseForceRouteFlags(["--force-quick"], {}).forceQuick
    ).toBe(true);
  });

  it("low confidence prefers analysis over execution", () => {
    const d = classifyRouteIntent("hello please help with something vague");
    expect(d.route).toBe("architecture");
    expect(d.confidence).toBeLessThan(0.6);
  });
});

describe("write policy — source dirs read-only", () => {
  beforeEach(() => {
    resetWritePolicy();
    ensureOutputHome();
  });

  it("blocks write into a registered source dir (Spendy failure mode)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sam-src-"));
    const spec = path.join(tmp, "My Documents", "Spendy");
    fs.mkdirSync(spec, { recursive: true });
    registerSourceRoots([spec]);
    registerWriteRoots([getOutputHome()]);
    setStrictWriteRoots(true);

    const target = path.join(spec, "spendy_report.csv");
    const gate = assertWriteAllowed(target, "write");
    expect(gate.ok).toBe(false);
    expect(gate.reason).toMatch(/READ-ONLY source/i);

    const result = await executeTool("write_file", {
      path: target,
      content: "should not write",
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/READ-ONLY|Denied/i);
    expect(fs.existsSync(target)).toBe(false);
  });

  it("allows write_report under output home", async () => {
    registerWriteRoots([getOutputHome()]);
    setStrictWriteRoots(true);
    const result = await executeTool("write_report", {
      name: "phase1-policy-test.md",
      content: "# ok\n",
    });
    expect(result.ok).toBe(true);
    const out = String((result.data as { path?: string })?.path || "");
    expect(out.toLowerCase()).toContain("sam-harness");
    expect(fs.existsSync(out)).toBe(true);
  });
});

describe("shell path quoting + argv", () => {
  beforeEach(() => {
    resetWritePolicy();
    setDisableShell(false);
  });

  it("quotes paths with spaces", () => {
    expect(quoteShellPath("D:\\My Documents\\Spendy")).toBe(
      '"D:\\My Documents\\Spendy"'
    );
    expect(quoteShellPath("E:\\UpNexa.com\\spendy")).toBe("E:\\UpNexa.com\\spendy");
  });

  it("prefers argv arrays over string-concat commands", () => {
    const r = resolveShellArgv({
      argv: [
        "powershell.exe",
        "-NoProfile",
        "-Command",
        "Get-ChildItem -LiteralPath 'D:\\My Documents\\Spendy'",
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.argv[0]).toMatch(/powershell/i);
      expect(r.argv).toContain("-Command");
    }
  });

  it("blocks Export-Csv write redirects via command string", () => {
    const r = resolveShellArgv({
      command:
        "powershell -NoProfile -Command Get-ChildItem E:\\x | Export-Csv -Path D:\\My Documents\\Spendy\\out.csv",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Export-Csv|blocked/i);
  });

  it("disables run_shell entirely when analysis mode", async () => {
    setDisableShell(true);
    expect(isShellDisabled()).toBe(true);
    const result = await executeTool("run_shell", {
      argv: ["echo", "hi"],
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/disabled/i);
  });
});

describe("repeat guard", () => {
  it("stops after 2 identical failures and builds structured report", () => {
    const g = new RepeatGuard();
    const a = g.recordFailure("run_shell", "path not found E:\\UpNexa.com\\spendy");
    expect(g.shouldStopRetry(a)).toBe(false);
    const b = g.recordFailure("run_shell", "path not found E:\\UpNexa.com\\spendy");
    expect(g.shouldStopRetry(b)).toBe(true);
    g.markSwitched(b);
    const c = g.recordFailure("run_shell", "path not found E:\\UpNexa.com\\spendy");
    expect(g.hasSwitched(c)).toBe(true);
    const fail = g.buildStructuredFailure({
      stage: "tool:run_shell",
      sig: c,
    });
    expect(fail.success).toBe(false);
    expect(fail.failedStage).toBe("tool:run_shell");
    expect(fail.neededToContinue).toMatch(/list_dir|write_report/i);
    const md = formatStructuredFailureMarkdown(fail);
    expect(md).toMatch(/Structured failure report/);
    expect(md).toMatch(/Failed stage/);
  });
});
