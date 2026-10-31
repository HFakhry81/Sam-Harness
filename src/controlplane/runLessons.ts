/**
 * Unified post-run lesson writer (LangGraph + ops + legacy).
 * Feeds agent-memory.md + project-memory.json + optional daily ledger.
 */
import * as fs from "fs";
import * as path from "path";
import { upsertMemory } from "./projectMemory.js";
import { recordDailyResult } from "./dailyOps.js";
import { agentMemoryPath, ensureOutputHome } from "../lib/outputHome.js";

export type RunLessonInput = {
  title: string;
  route: string;
  mode: string;
  success: boolean;
  summary: string;
  auditPassed?: boolean | null;
  goalPassed?: boolean | null;
  goalFidelityScore?: number | null;
  exitCode?: number | null;
};

export function appendRunLesson(cwd: string, input: RunLessonInput): void {
  const at = new Date().toISOString();
  const flags = [
    input.auditPassed == null ? null : `audit=${input.auditPassed}`,
    input.goalPassed == null ? null : `goal=${input.goalPassed}`,
    input.goalFidelityScore == null
      ? null
      : `goalScore=${Number(input.goalFidelityScore).toFixed(2)}`,
  ]
    .filter(Boolean)
    .join(" ");

  const line =
    `\n- [${at}] route=${input.route} mode=${input.mode} success=${input.success}` +
    (flags ? ` ${flags}` : "") +
    ` title="${input.title.slice(0, 80)}" ` +
    `lesson=${input.success ? "ok" : "retry"}: ${input.summary.replace(/\s+/g, " ").slice(0, 220)}\n`;

  try {
    ensureOutputHome();
    const am = agentMemoryPath("agent-memory.md");
    fs.mkdirSync(path.dirname(am), { recursive: true });
    fs.appendFileSync(am, line, "utf-8");
  } catch {
    /* ignore */
  }

  try {
    const key = `last-run:${input.route}`;
    const value = `${input.success ? "OK" : "FAIL"} · ${input.title.slice(0, 60)} · ${input.summary
      .replace(/\s+/g, " ")
      .slice(0, 160)}`;
    upsertMemory(cwd, key, value);
    if (input.goalPassed === false) {
      upsertMemory(
        cwd,
        "lesson:goal-fidelity",
        "Reject strategies that drift from ## Goal (e.g. BookingType when goal is memory/Daily Ops/UI)."
      );
    }
    if (!input.success && /delete|حذف/i.test(input.summary) && /write|اكتب|أنشئ/i.test(input.title + input.summary)) {
      upsertMemory(
        cwd,
        "lesson:negation-delete",
        "Arabic/English negation (لا تحذف / don't delete) must not classify as delete intent."
      );
    }
    if (!input.success && /Select-Object|run_shell/i.test(input.summary)) {
      upsertMemory(
        cwd,
        "lesson:run-shell-powershell",
        "run_shell PowerShell must exec powershell.exe directly — never cmd /c (pipes like Select-Object break)."
      );
    }
    if (
      !input.success &&
      /excel|جرد|inventory/i.test(input.title + input.summary) &&
      /write_file|Missing required path|excel-report/i.test(input.summary)
    ) {
      upsertMemory(
        cwd,
        "lesson:excel-inventory-write",
        "Excel inventory on a drive: after run_shell/list_dir always write_file the .txt report — scan alone is not success."
      );
    }
    if (/Sam-Harness\\docs|nested|\.\/Sam-Harness|[\\/]docs[\\/]Sam-Harness/i.test(input.summary)) {
      upsertMemory(
        cwd,
        "lesson:target-repo-absolute",
        "Packs archive under SAM_OUTPUT_HOME/reports only — never under ./Sam-Harness/docs or a target project docs/."
      );
    }
  } catch {
    /* ignore */
  }

  try {
    recordDailyResult(cwd, {
      taskId: `adhoc-${input.route}`,
      prompt: input.title,
      success: input.success,
      summary: input.summary,
    });
  } catch {
    /* ignore */
  }
}

/** Parse audit/goal flags from execution-result.md / final-report.md text. */
export function parseRunQualityFlags(text: string): {
  auditPassed: boolean | null;
  goalPassed: boolean | null;
  goalFidelityScore: number | null;
  verified: boolean | null;
} {
  const auditM = text.match(/auditPassed:\s*(true|false)/i);
  const goalM = text.match(/goalPassed:\s*(true|false)/i);
  const scoreM = text.match(/goalFidelityScore:\s*([0-9.]+)/i);
  const verifiedM = text.match(/verified\s*=\s*(true|false)/i);
  const verifiedTag = /\[VERIFIED\]/i.test(text)
    ? true
    : /\[GAPS\]|\[FAILED_AUDIT/i.test(text)
      ? false
      : null;
  return {
    auditPassed: auditM ? auditM[1].toLowerCase() === "true" : null,
    goalPassed: goalM ? goalM[1].toLowerCase() === "true" : null,
    goalFidelityScore: scoreM ? Number(scoreM[1]) : null,
    verified: verifiedM ? verifiedM[1].toLowerCase() === "true" : verifiedTag,
  };
}
