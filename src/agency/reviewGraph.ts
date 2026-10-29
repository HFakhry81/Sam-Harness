/**
 * LangGraph critique → remediate → audit loop (max 5).
 * Gate: only APPROVED opens downstream agency stages.
 */
import * as fs from "fs";
import * as path from "path";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { live, ok, warn } from "../lib/colors.js";
import {
  isTlsOrFetchError,
  makeSpecialistModel,
  specialistLabel,
} from "../agent/models.js";
import {
  extractUserGoal,
  goalWantsBookingBlueprint,
  scoreGoalFidelity,
} from "./goalFidelity.js";
import { learningContextBlock } from "../controlplane/projectMemory.js";

const MAX_LOOPS = 5;

const REJECTION_FORMAT = `
If [REJECTED], for EACH issue:
### Issue N
- أسباب الرفض / Rejection reason: ...
- درجة الخطورة / Severity: Critical | High | Medium | Low
- طريقة الحل / How to fix: ...
Also numbered FIX 1..N lines.
`.trim();

function clip(text: string, max = 6000): string {
  if (!text) return "";
  return text.length <= max ? text : text.slice(0, max) + "\n...(truncated)";
}

function parseApproved(report: string): boolean {
  if (/^\s*\[REJECTED\]/m.test(report) || /\n\[REJECTED\]/.test(report)) return false;
  if (/^\s*\[APPROVED\]/m.test(report) || /\n\[APPROVED\]/.test(report)) return true;
  return false;
}

function extractFixes(report: string): string[] {
  const fixes: string[] = [];
  for (const line of report.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:[-*]|\d+[.)]|FIX\s*\d+\s*:)\s*(.+)$/i);
    if (m?.[1] && m[1].trim().length > 8) fixes.push(m[1].trim());
    const how = line.match(/طريقة الحل\s*\/\s*How to fix:\s*(.+)$/i);
    if (how?.[1] && how[1].trim().length > 8) fixes.push(how[1].trim());
  }
  return [...new Set(fixes)].slice(0, 14);
}

async function invoke(
  model: ReturnType<typeof makeSpecialistModel>,
  prompt: string
): Promise<string> {
  const res = await model.invoke(prompt);
  return String(res.content || "");
}

async function invokeWithCloudFallback(
  primary: ReturnType<typeof makeSpecialistModel>,
  localOpts: {
    cloudModel: string;
    localModel: string;
    temperature: number;
    numPredict?: number;
  },
  prompt: string
): Promise<string> {
  try {
    return await invoke(primary, prompt);
  } catch (e) {
    if (!isTlsOrFetchError(e)) throw e;
    warn(
      "LangGraph",
      `Cloud specialist failed (${String((e as any)?.cause?.code || (e as any)?.message || e).slice(0, 80)}) — falling back to local`
    );
    return invoke(makeSpecialistModel({ ...localOpts, forceLocal: true }), prompt);
  }
}

export const ReviewState = Annotation.Root({
  brief: Annotation<string>,
  evidenceMarkdown: Annotation<string>,
  loopDir: Annotation<string>,
  userGoal: Annotation<string>,
  strategy: Annotation<string>,
  auditReport: Annotation<string>,
  loop: Annotation<number>,
  auditPassed: Annotation<boolean>,
  goalPassed: Annotation<boolean>,
  goalFidelityScore: Annotation<number>,
  history: Annotation<string[]>({
    reducer: (a, b) => a.concat(b),
    default: () => [],
  }),
});

export type ReviewStateType = typeof ReviewState.State;

function buildGraph() {
  const strategistOpts = {
    cloudModel: "gemma4:cloud",
    localModel: process.env.CEO_MODEL || "qwen2.5-coder:1.5b",
    temperature: 0.15,
    numPredict: 1600,
  };
  const auditorOpts = {
    cloudModel: "gemma4:cloud",
    localModel: "gemma3:1b",
    temperature: 0,
    numPredict: 1200,
  };
  const strategist = makeSpecialistModel(strategistOpts);
  const auditor = makeSpecialistModel(auditorOpts);

  const strategize = async (state: ReviewStateType) => {
    const loopNo = (state.loop || 0) + 1;
    live(
      `Strategist (${specialistLabel("gemma4:cloud", "local")})`,
      `LangGraph loop v${loopNo}/${MAX_LOOPS} — strategy-v${loopNo}`
    );

    const userGoal = state.userGoal || extractUserGoal(state.brief);
    const bookingMode = goalWantsBookingBlueprint(userGoal);
    const learned = learningContextBlock(process.cwd(), 10, 5);
    let strategy: string;
    if (loopNo === 1) {
      const sections = bookingMode
        ? `Required sections for THIS booking/clinic product goal:
## BookingType triad (APPOINTMENT/RESOURCE_RENTAL/BATCH_SCHEDULE)
## Status machines + transitions
## Lifecycle service→book→QR→session→invoice
## N-tier UI/API/Business/Data
## Security (tenant, RBAC, token lifecycle, audit)
## Delivery phases (handoff; do not claim already shipped)`
        : `Required sections for THIS user goal (do NOT invent BookingType/clinic content unless the goal asks for it):
## Direct answer to ORIGINAL USER GOAL (must be the main body)
## Current state vs gaps (cite evidence paths)
## Concrete recommendations / next actions
## Risks & verification
## Delivery / handoff notes`;

      strategy = await invokeWithCloudFallback(
        strategist,
        strategistOpts,
        `You are Agency Strategist. Write a COMPLETE concrete strategy (max 1400 words) that ANSWERS the ORIGINAL USER GOAL.
Not intentions — deliverables that match the goal.
If the goal asks for a status report on memory/Daily Ops/UI artifacts, write THAT report — do not pivot to unrelated product blueprints.
Obey PROJECT MEMORY lessons when they apply (do not repeat known failures).

${sections}

ORIGINAL USER GOAL (authoritative — fail if ignored):
${clip(userGoal, 2500)}

${learned ? `${clip(learned, 2500)}\n` : ""}EVIDENCE:
${clip(state.evidenceMarkdown, 5000)}

BRIEF:
${clip(state.brief, 8000)}`
      );
    } else {
      const fixes = extractFixes(state.auditReport || "");
      const briefRem = [
        `Merge strategy-v${loopNo - 1} with ALL rejection fixes into FULL strategy-v${loopNo}.`,
        `Add section "Merged fixes from rejection-v${loopNo - 1}".`,
        `ORIGINAL USER GOAL (must remain the primary subject — do not pivot to BookingType unless goal asks):`,
        clip(userGoal, 2000),
        learned ? `PROJECT MEMORY / LESSONS:\n${clip(learned, 2000)}` : "",
        `MUST-FIX:`,
        ...fixes.map((f, i) => `${i + 1}. ${f}`),
        ``,
        `PRIOR STRATEGY:`,
        clip(state.strategy, 7000),
        ``,
        `REJECTION:`,
        clip(state.auditReport, 3500),
        ``,
        `EVIDENCE:`,
        clip(state.evidenceMarkdown, 3000),
      ]
        .filter(Boolean)
        .join("\n");
      fs.writeFileSync(
        path.join(state.loopDir, `remediation-brief-v${loopNo - 1}.md`),
        briefRem,
        "utf-8"
      );
      strategy = await invokeWithCloudFallback(strategist, strategistOpts, briefRem);
    }

    fs.writeFileSync(path.join(state.loopDir, `strategy-v${loopNo}.md`), strategy, "utf-8");
    fs.writeFileSync("ceo-draft.md", strategy, "utf-8");
    ok("Strategist", `strategy-v${loopNo}.md`);
    return { strategy, loop: loopNo };
  };

  const audit = async (state: ReviewStateType) => {
    const loopNo = state.loop || 1;
    live(
      `Auditor (${specialistLabel("gemma4:cloud", "gemma3:1b")})`,
      `LangGraph loop v${loopNo}/${MAX_LOOPS} — audit-v${loopNo}`
    );

    const userGoal = state.userGoal || extractUserGoal(state.brief);
    const bookingMode = goalWantsBookingBlueprint(userGoal);
    const fidelityPre = scoreGoalFidelity(userGoal, state.strategy || "");

    const bookingRules = bookingMode
      ? `REJECT clinic-only framing, missing BookingTypes, missing token lifecycle, missing QR→invoice,
or "will include later" language.`
      : `REJECT topic drift away from ORIGINAL USER GOAL (e.g. BookingType/clinic blueprints when the goal was memory/Daily Ops/Control Plane UI).
REJECT strategies that ignore the stated goal.`;

    let auditReport = await invokeWithCloudFallback(
      auditor,
      auditorOpts,
      `You are Agency Auditor (evidence-grounded + goal-fidelity).
REJECT rubber-stamp checklists. Prefer citing EVIDENCE paths.
REJECT invented files not in evidence.
${bookingRules}

APPROVE only if strategy is concrete, consistent with evidence (or honestly marks gaps),
AND clearly answers ORIGINAL USER GOAL.

ORIGINAL USER GOAL:
${clip(userGoal, 2000)}

Deterministic fidelity hint (informational): ${fidelityPre.reason}

EVIDENCE PACK:
${clip(state.evidenceMarkdown, 5000)}

STRATEGY-v${loopNo}:
${clip(state.strategy, 8000)}

Line 1: [APPROVED] or [REJECTED]
${REJECTION_FORMAT}`
    );

    let llmApproved = parseApproved(auditReport);
    const fidelity = scoreGoalFidelity(userGoal, state.strategy || "");
    let goalPassed = fidelity.passed;
    // Hard gate: cannot APPROVE if goal fidelity fails
    if (llmApproved && !goalPassed) {
      auditReport = [
        `[REJECTED]`,
        ``,
        `### Issue 1`,
        `- أسباب الرفض / Rejection reason: Goal fidelity gate failed — strategy does not answer ORIGINAL USER GOAL (${fidelity.reason}).`,
        `- درجة الخطورة / Severity: Critical`,
        `- طريقة الحل / How to fix: Rewrite strategy so the main body answers the user goal; remove unrelated BookingType/clinic content unless the goal asks for it. Cite evidence paths for memory/Daily Ops/UI when those are the subject.`,
        `FIX 1: Align strategy-v${loopNo + 1} to: ${clip(userGoal, 400)}`,
        ``,
        `--- LLM draft (overridden) ---`,
        auditReport,
      ].join("\n");
      llmApproved = false;
      warn("Auditor", `Goal fidelity FAIL score=${fidelity.score.toFixed(2)} — forcing REJECT`);
    }

    const auditPassed = llmApproved && goalPassed;
    const auditDoc = [
      `# Audit v${loopNo}/${MAX_LOOPS}`,
      `Result: ${auditPassed ? "[APPROVED]" : "[REJECTED]"}`,
      `goalPassed: ${goalPassed}`,
      `goalFidelityScore: ${fidelity.score.toFixed(3)}`,
      `goalFidelityReason: ${fidelity.reason}`,
      ``,
      auditReport,
    ].join("\n");
    fs.writeFileSync(path.join(state.loopDir, `audit-v${loopNo}.md`), auditDoc, "utf-8");
    fs.writeFileSync("audit-report.md", auditDoc, "utf-8");
    if (!auditPassed) {
      fs.writeFileSync(
        path.join(state.loopDir, `rejection-v${loopNo}.md`),
        `# Rejection v${loopNo}\n\ngoalPassed=${goalPassed}\n${auditReport}\n`,
        "utf-8"
      );
      warn("Auditor", `[REJECTED] loop v${loopNo} → remediate`);
    } else {
      ok("Auditor", `[APPROVED] loop v${loopNo} — gate OPEN (goal OK)`);
    }
    return {
      auditReport: auditDoc,
      auditPassed,
      goalPassed,
      goalFidelityScore: fidelity.score,
      history: [auditDoc],
    };
  };

  const routeAfterAudit = (state: ReviewStateType): string => {
    if (state.auditPassed) return "approved";
    if ((state.loop || 0) >= MAX_LOOPS) return "failed";
    return "remediate";
  };

  const graph = new StateGraph(ReviewState)
    .addNode("strategize", strategize)
    .addNode("audit", audit)
    .addEdge(START, "strategize")
    .addEdge("strategize", "audit")
    .addConditionalEdges("audit", routeAfterAudit, {
      approved: END,
      failed: END,
      remediate: "strategize",
    });

  return graph.compile();
}

let compiled: ReturnType<typeof buildGraph> | null = null;

export async function runReviewGraph(input: {
  brief: string;
  evidenceMarkdown: string;
  loopDir: string;
  userGoal?: string;
}): Promise<{
  strategy: string;
  auditReport: string;
  auditPassed: boolean;
  goalPassed: boolean;
  goalFidelityScore: number;
  loop: number;
  history: string[];
}> {
  fs.mkdirSync(input.loopDir, { recursive: true });
  if (!compiled) compiled = buildGraph();
  const userGoal = input.userGoal || extractUserGoal(input.brief);
  const out = await compiled.invoke({
    brief: input.brief,
    evidenceMarkdown: input.evidenceMarkdown,
    loopDir: input.loopDir,
    userGoal,
    strategy: "",
    auditReport: "",
    loop: 0,
    auditPassed: false,
    goalPassed: false,
    goalFidelityScore: 0,
    history: [],
  });
  return {
    strategy: out.strategy || "",
    auditReport: out.auditReport || "",
    auditPassed: Boolean(out.auditPassed),
    goalPassed: Boolean(out.goalPassed),
    goalFidelityScore: Number(out.goalFidelityScore) || 0,
    loop: out.loop || 0,
    history: out.history || [],
  };
}

export { MAX_LOOPS };
