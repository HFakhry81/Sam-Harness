import { ChatOllama } from "@langchain/ollama";
import * as fs from "fs";
import { live, ok, warn, err } from "../lib/colors.js";
import { TOOL_CATALOG, type ToolResult } from "../tools/registry.js";
import { executeToolAsRole } from "../agency/safeExecute.js";
import { learningContextBlock } from "../controlplane/projectMemory.js";
import {
  detectOpsIntent,
  extractGoalFocus,
  heuristicPlan,
  isHighConfidencePlan,
  type CeoDecision,
} from "./heuristic.js";

/** Prefer ## Goal for ops; strip architecture boilerplate that confused older task files. */
function focusTask(task: string): string {
  const route = task.match(/## Route\s*\n\s*(\w+)/i)?.[1]?.toLowerCase();
  const goal = task.match(/## Goal\s*\n([\s\S]*?)(?=\n## |\n# |$)/i)?.[1]?.trim();
  if (route === "operational" && goal) {
    const intent = detectOpsIntent(goal);
    const learned = learningContextBlock(process.cwd(), 8, 4);
    return [
      "## Route",
      "operational",
      "",
      "## Goal",
      goal,
      "",
      "## Detected intent",
      intent,
      "",
      "## Operator rules",
      "- Desktop Operator only — no architecture or marketing crew.",
      "- Obey Detected intent: move→move_file, create_excel→write_excel, etc.",
      "- If Goal asks for a REPORT/inventory of Excel files on a drive: run_shell Get-ChildItem (or list_dir), then write_file a .txt report — never write_excel.",
      "- Never invent a different task than the Goal.",
      "- Apply Project memory lessons below when relevant.",
      learned ? `\n${learned}` : "",
    ]
      .filter((x) => x !== "")
      .join("\n");
  }
  return task;
}

export type { CeoDecision };

/** Prefer a small instruct/coder model for JSON tools; override with CEO_MODEL. */
const CEO_MODEL = process.env.CEO_MODEL || "qwen2.5-coder:1.5b";

const ceo = new ChatOllama({
  baseUrl: "http://localhost:11434",
  model: CEO_MODEL,
  temperature: 0,
  think: false,
  numPredict: 400,
  numCtx: 4096,
});

function extractJson(text: string): Record<string, unknown> | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function parseDecision(text: string): CeoDecision | null {
  const obj = extractJson(text);
  if (!obj) return null;

  if (obj.action === "finish" || obj.tool === "finish" || obj.type === "finish") {
    const params = (obj.params as Record<string, unknown>) || obj;
    return {
      action: "finish",
      summary: String(params.summary || obj.summary || obj.message || "Done"),
      success: params.success !== false && obj.success !== false,
    };
  }

  const tool = String(obj.tool || obj.name || "");
  const params = (obj.params || obj.arguments || {}) as Record<string, unknown>;
  if (!tool || tool === "undefined") return null;

  return { action: "tool", tool, params };
}

function transcript(lines: string[]): string {
  return lines.slice(-12).join("\n\n");
}

async function runDecision(
  decision: CeoDecision,
  toolLog: ToolResult[]
): Promise<"continue" | "done"> {
  if (decision.action === "finish") {
    ok("CEO", `Finished: ${decision.summary}`);
    return "done";
  }

  console.log(
    `tool=${decision.tool} params=${JSON.stringify(decision.params).slice(0, 220)}`
  );
  const result = await executeToolAsRole("operator", decision.tool, decision.params);
  toolLog.push(result);
  if (result.ok) ok(result.tool, result.message);
  else err(result.tool, result.message);
  return "continue";
}

function writeReports(
  report: { success: boolean; summary: string; steps: number; tools: ToolResult[] }
) {
  fs.writeFileSync("final-report.md", JSON.stringify(report, null, 2), "utf-8");
  fs.writeFileSync(
    "execution-result.md",
    report.tools.map((t) => `- [${t.ok ? "OK" : "FAIL"}] ${t.tool}: ${t.message}`).join("\n"),
    "utf-8"
  );
}

function isExcelInventoryGoal(task: string): boolean {
  const g = extractGoalFocus(task);
  return (
    /تقرير|report|جرد|امسح|scan|قائمة\s*ب?الملفات|على\s*المحرك/i.test(g) &&
    /excel|\.xls|\.xlsx|\.xlsm|جداول/i.test(g)
  );
}

function inventoryReportPath(task: string): string {
  try {
    // sync require via dynamic import already in loop — read disk Spec if present
    const specPath = `${process.cwd()}/task.spec.json`;
    if (fs.existsSync(specPath)) {
      const spec = JSON.parse(fs.readFileSync(specPath, "utf-8")) as {
        entities?: { destinations?: string[] };
      };
      const d = spec.entities?.destinations?.[0];
      if (d) return d;
    }
  } catch {
    /* ignore */
  }
  const named =
    extractGoalFocus(task).match(
      /(?:Desktop|سطح المكتب)\\?[/\\]?([\w.\u0600-\u06FF-]+\.txt)/i
    )?.[1] || "excel-report-D.txt";
  // Prefer agent output home for generated inventory reports
  const outHome = process.env.SAM_OUTPUT_HOME || "";
  if (outHome) {
    return `${outHome.replace(/[\\/]+$/, "")}\\documents\\${named}`;
  }
  return `Desktop\\${named}`;
}

function pathsFromScanTool(t: ToolResult): string[] {
  const raw = String(
    (t.data as { stdout?: string; listing?: string } | undefined)?.stdout ||
      (t.data as { listing?: string } | undefined)?.listing ||
      t.message ||
      ""
  );
  const hits = raw.match(/[A-Za-z]:\\[^\r\n"'|]+?\.(?:xls|xlsx|xlsm)\b/gi) || [];
  return [...new Set(hits.map((p) => p.trim()))];
}

async function ensureInventoryWriteFile(
  focused: string,
  toolLog: ToolResult[]
): Promise<boolean> {
  if (!isExcelInventoryGoal(focused)) return true;
  if (toolLog.some((t) => t.tool === "write_file" && t.ok)) return true;
  const scan = [...toolLog]
    .reverse()
    .find((t) => (t.tool === "run_shell" || t.tool === "list_dir") && t.ok);
  if (!scan) return false;
  const paths = pathsFromScanTool(scan);
  const reportPath = inventoryReportPath(focused);
  const stamp = new Date().toLocaleString();
  const body = [
    `Excel inventory report — ${stamp}`,
    `Source scan: ${scan.tool}`,
    `Count: ${paths.length}`,
    "",
    ...(paths.length ? paths : ["(no .xls/.xlsx/.xlsm paths parsed from scan output)"]),
    "",
  ].join("\n");
  warn("CEO", `Inventory scan OK but write_file missing — writing ${reportPath}...`);
  await runDecision(
    {
      action: "tool",
      tool: "write_file",
      params: { path: reportPath, content: body },
    },
    toolLog
  );
  return toolLog.some((t) => t.tool === "write_file" && t.ok);
}

export async function runOperationalCeoLoop(task: string, maxSteps = 8) {
  live("CEO Supervisor", `Operational tool loop starting (model: ${CEO_MODEL})...`);
  const focused = focusTask(task);
  const history: string[] = [`USER TASK:\n${focused}`];
  const toolLog: ToolResult[] = [];
  let parseFails = 0;

  // Prefer Task Spec plan (entities / planSteps) — never invent paths like Desktop/old.txt
  let earlyPlan = heuristicPlan(focused);
  let usedSpecPlan = false;
  try {
    const { readTaskSpec, planToolsFromSpec } = await import("../controlplane/taskSpec.js");
    const spec = readTaskSpec(process.cwd());
    if (spec && spec.route === "operational") {
      const fromSpec = planToolsFromSpec(spec);
      if (fromSpec.length) {
        earlyPlan = fromSpec as typeof earlyPlan;
        usedSpecPlan = true;
        warn(
          "CEO",
          `Using Task Spec plan (intent=${spec.intent}, conf=${spec.confidence.toFixed(2)}, roots=${(spec.roots || []).join("|") || "—"})...`
        );
      } else if (
        !spec.entities.sources.length &&
        !spec.entities.destinations.length &&
        !spec.planSteps?.length
      ) {
        const report = {
          success: false,
          summary:
            "Task Spec فارغ (لا مسارات). النموذج الهجين يتطلب planSteps أو entities قبل التنفيذ — أعد المعاينة/التوضيح في Control Plane.",
          steps: 0,
          tools: toolLog,
        };
        writeReports(report);
        return report;
      }
    }
  } catch {
    /* fall through to heuristic */
  }

  if (isHighConfidencePlan(earlyPlan)) {
    if (!usedSpecPlan) warn("CEO", "Using deterministic desktop plan...");
    for (const d of earlyPlan) {
      if (d.action === "finish") {
        const anyFail = toolLog.some((t) => !t.ok);
        const report = {
          success: !anyFail && d.success,
          summary: anyFail
            ? `Plan finished with tool failures: ${toolLog
                .filter((t) => !t.ok)
                .map((t) => t.message)
                .join("; ")}`
            : d.summary,
          steps: earlyPlan.length,
          tools: toolLog,
        };
        writeReports(report);
        return report;
      }
      await runDecision(d, toolLog);
      const last = toolLog[toolLog.length - 1];
      if (last && !last.ok) {
        const report = {
          success: false,
          summary: `Deterministic plan stopped: ${last.message}`,
          steps: toolLog.length,
          tools: toolLog,
        };
        writeReports(report);
        return report;
      }
    }
  }

  for (let step = 1; step <= maxSteps; step++) {
    live("CEO Supervisor", `Planning next action (step ${step}/${maxSteps})...`);

    const intent = detectOpsIntent(extractGoalFocus(focused));
    const prompt = `You are the Sam-Harness Desktop Operator on Windows.
Complete ONLY the USER GOAL. Detected intent=${intent}.
If intent=move → use move_file. If intent=create_excel → write_excel. Do not switch intents.
Never take a screen capture unless intent=screenshot.
Never invent marketing/architecture work.
Do not copy example filenames — use the real name from the Goal.

${TOOL_CATALOG}

Respond with ONLY one JSON object.
Examples by intent:
move: {"tool":"move_file","params":{"source":"Desktop\\\\Sam-Harness team test.xls","destination":"D:\\\\Sam-Harness team test.xls"}}
create_excel: {"tool":"write_excel","params":{"path":"Desktop\\\\report.xls","a1":"${new Date().toLocaleString()}"}}
finish: {"tool":"finish","params":{"summary":"Done","success":true}}

Conversation so far:
${transcript(history)}
`;

    const response = await ceo.invoke(prompt);
    const raw = String(response.content || "");
    history.push(`CEO RAW:\n${raw.slice(0, 1500)}`);

    let decision = parseDecision(raw);
    if (!decision) {
      parseFails += 1;
      warn("CEO", "Could not parse JSON tool call.");
      if (parseFails >= 2) {
        const plan = heuristicPlan(focused);
        if (plan.length) {
          warn("CEO", "Switching to deterministic heuristic plan...");
          for (const d of plan) {
            const status = await runDecision(d, toolLog);
            if (status === "done") {
              const report = {
                success: d.action === "finish" ? d.success : true,
                summary: d.action === "finish" ? d.summary : "Heuristic plan completed",
                steps: step,
                tools: toolLog,
              };
              writeReports(report);
              return report;
            }
          }
        }
      }
      history.push("SYSTEM: Invalid JSON. Reply with one valid JSON tool call only.");
      continue;
    }

    parseFails = 0;
    const status = await runDecision(decision, toolLog);
    if (decision.action === "tool") {
      const last = toolLog[toolLog.length - 1];
      history.push(
        `TOOL RESULT (${last.tool}):\n${last.message}\nDATA:${JSON.stringify(last.data || {}).slice(0, 1200)}`
      );
    }
    if (status === "done" || decision.action === "finish") {
      if (decision.action === "finish" && isExcelInventoryGoal(focused)) {
        const wroteOk = await ensureInventoryWriteFile(focused, toolLog);
        if (!wroteOk) {
          history.push(
            "SYSTEM: Inventory incomplete. After a successful run_shell/list_dir you MUST call write_file with the .txt report path and list of paths. Do not finish yet."
          );
          continue;
        }
      }
      const anyFail = toolLog.some((t) => !t.ok);
      const inventoryNeedsWrite =
        isExcelInventoryGoal(focused) &&
        !toolLog.some((t) => t.tool === "write_file" && t.ok);
      const report = {
        success:
          !anyFail &&
          !inventoryNeedsWrite &&
          (decision.action === "finish" ? decision.success : true),
        summary:
          inventoryNeedsWrite
            ? "Scan ran but write_file report was not created"
            : decision.action === "finish"
              ? decision.summary
              : "Done",
        steps: step,
        tools: toolLog,
      };
      writeReports(report);
      return report;
    }
  }

  // Final heuristic rescue
  const plan = heuristicPlan(focused);
  if (plan.length && toolLog.length === 0) {
    warn("CEO", "Max LLM steps failed — running heuristic rescue...");
    for (const d of plan) {
      await runDecision(d, toolLog);
    }
    const last = plan[plan.length - 1];
    const report = {
      success: last.action === "finish" ? last.success : true,
      summary: last.action === "finish" ? last.summary : "Heuristic rescue",
      steps: maxSteps,
      tools: toolLog,
    };
    writeReports(report);
    return report;
  }

  warn("CEO", "Max steps reached without finish.");
  const report = {
    success: false,
    summary: "Max steps reached without explicit finish",
    steps: maxSteps,
    tools: toolLog,
  };
  writeReports(report);
  return report;
}

export async function verifyAgainstTask(task: string, executionSummary: string) {
  live("CEO Verifier", "Comparing result to Task Spec success criteria...");
  const {
    parseSuccessCriteriaFromMarkdown,
    readTaskSpec,
    verifySuccessCriteria,
  } = await import("../controlplane/taskSpec.js");

  const goal = extractGoalFocus(task);
  const intent = detectOpsIntent(goal);

  // Prefer task.spec.json → else parse ## Success criteria from markdown
  const diskSpec = readTaskSpec(process.cwd());
  const criteria =
    diskSpec?.successCriteria?.length
      ? diskSpec.successCriteria
      : parseSuccessCriteriaFromMarkdown(task);

  if (criteria.length) {
    const result = verifySuccessCriteria(criteria, executionSummary);
    if (result.verified) {
      ok("Verifier", result.reason);
      return { verified: true, reason: `${result.reason}\n${result.details.join("\n")}` };
    }
    warn("Verifier", result.reason);
    return { verified: false, reason: `${result.reason}\n${result.details.join("\n")}` };
  }

  // Fallback legacy intent checks when no structured criteria
  if (intent === "move" || intent === "copy") {
    const toolMove = /move_file|copy_file/i.test(executionSummary);
    if (/write_excel|screenshot/i.test(executionSummary) && !toolMove) {
      return {
        verified: false,
        reason: `Intent was ${intent} but execution used a different tool`,
      };
    }
  }

  try {
    const prompt = `Goal:\n${goal}\nDetected intent: ${intent}\n\nExecution summary:\n${executionSummary}\n\nDid execution fulfill THIS intent?
Reply ONLY JSON: {"verified":true|false,"reason":"..."}`;
    const response = await ceo.invoke(prompt);
    const obj = extractJson(String(response.content || "")) || {
      verified: /true/i.test(String(response.content)),
      reason: String(response.content).slice(0, 300),
    };
    const verified = Boolean(obj.verified);
    if (verified) ok("Verifier", String(obj.reason || "Verified"));
    else warn("Verifier", String(obj.reason || "Not verified"));
    return { verified, reason: String(obj.reason || "") };
  } catch (e: any) {
    warn("Verifier", `Verify failed: ${e?.message || e}`);
    return { verified: false, reason: String(e?.message || e) };
  }
}
