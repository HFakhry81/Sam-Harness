/**
 * LangGraph critique → remediate → audit loop (max 5).
 * Gate: only APPROVED opens downstream agency stages.
 */
import * as fs from "fs";
import * as path from "path";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { live, ok, warn } from "../lib/colors.js";
import {
  invokeTracked,
  isTlsOrFetchError,
  makeSpecialistModel,
  specialistLabel,
  useOllamaCloudNow,
} from "../agent/models.js";
import {
  extractUserGoal,
  goalWantsBookingBlueprint,
  scoreGoalFidelity,
  GROUNDED_FIDELITY_THRESHOLD,
} from "./goalFidelity.js";
import { verifyCitationsAgainstRepo } from "./claimVerify.js";
import {
  chooseNonDegenerateDraft,
  detectRepetition,
} from "./repetitionGuard.js";
import { learningContextBlock } from "../controlplane/projectMemory.js";
import { getCheckpointer } from "../lib/db/checkpointer.js";
import { getPersistence } from "../lib/db/index.js";
import { withRetry } from "../lib/retry.js";
import { appendTimeline } from "../lib/durableRuns.js";
import { withSpan } from "../lib/observability/index.js";

const MAX_LOOPS = 5;
/** Min share of REQs that must be addressed (not missing) before APPROVED. */
export const MIN_REQ_COVERAGE = 0.7;

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

/** Parse auditor report gate marker. Exported for unit tests. */
export function parseApproved(report: string): boolean {
  if (/^\s*\[REJECTED\]/m.test(report) || /\n\[REJECTED\]/.test(report)) return false;
  if (/^\s*\[APPROVED\]/m.test(report) || /\n\[APPROVED\]/.test(report)) return true;
  return false;
}

/** LangGraph conditional edge after audit — caps remediations at MAX_LOOPS. */
export function routeAfterAudit(state: {
  auditPassed?: boolean;
  loop?: number;
}): "approved" | "failed" | "remediate" {
  if (state.auditPassed) return "approved";
  if ((state.loop || 0) >= MAX_LOOPS) return "failed";
  return "remediate";
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
  const modelName = String((model as { model?: string }).model || "specialist");
  return withRetry(
    () =>
      invokeTracked(model, prompt, {
        modelName,
        cloud: useOllamaCloudNow(),
      }),
    { attempts: 3, label: `llm:${modelName}` }
  );
}

async function invokeWithCloudFallback(
  primary: ReturnType<typeof makeSpecialistModel>,
  localOpts: {
    cloudModel?: string;
    localModel?: string;
    temperature: number;
    numPredict?: number;
    role?: string;
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
  targetRepo: Annotation<string>,
  /** 0..1 from evidence REQ matrix; 1 when no REQs extracted. */
  reqCoverage: Annotation<number>,
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
  // Phase 8: models from team.json / SAM_ROLE_* env (defaults preserve prior hardcodes)
  const strategistOpts = {
    temperature: 0.15,
    numPredict: 1600,
    role: "strategist",
  };
  const auditorOpts = {
    temperature: 0,
    numPredict: 1200,
    role: "auditor",
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

    // Repetition guard: regenerate once with stronger (cloud) model, else keep prior good draft
    const priorGood =
      loopNo > 1 && state.strategy && detectRepetition(state.strategy).ok
        ? state.strategy
        : null;
    if (!detectRepetition(strategy).ok) {
      warn(
        "Strategist",
        `Degenerate strategy-v${loopNo} — regenerating once with stronger model`
      );
      try {
        const stronger = makeSpecialistModel({
          ...strategistOpts,
          prefersCloud: true,
          explicitComplexity: true,
          forceLocal: false,
          temperature: 0.1,
        });
        const retryPrompt = `Rewrite the strategy WITHOUT repeated lines or copied paragraphs. Keep all substance; vary wording.
PRIOR DRAFT (degenerate — do not copy loops):
${clip(strategy, 4000)}

ORIGINAL USER GOAL:
${clip(userGoal, 2000)}

EVIDENCE:
${clip(state.evidenceMarkdown, 3000)}`;
        const regenerated = await invokeWithCloudFallback(
          stronger,
          strategistOpts,
          retryPrompt
        );
        const chosen = chooseNonDegenerateDraft(regenerated, priorGood || strategy);
        strategy = chosen.text;
        if (chosen.usedFallback) {
          warn(
            "Strategist",
            `Regenerate still degenerate — fell back to prior good draft and flagged`
          );
          strategy =
            strategy +
            `\n\n<!-- REPETITION_FLAG: regenerate failed; used prior non-degenerate draft -->\n`;
        } else if (!detectRepetition(strategy).ok && priorGood) {
          strategy =
            priorGood +
            `\n\n<!-- REPETITION_FLAG: both drafts degenerate; kept prior -->\n`;
        } else if (!detectRepetition(strategy).ok) {
          strategy =
            strategy +
            `\n\n<!-- REPETITION_FLAG: degenerate output kept after one regenerate -->\n`;
        }
      } catch (e) {
        const chosen = chooseNonDegenerateDraft(strategy, priorGood);
        strategy = chosen.text;
        if (chosen.usedFallback || !detectRepetition(strategy).ok) {
          strategy +=
            `\n\n<!-- REPETITION_FLAG: ${String((e as Error)?.message || e).slice(0, 120)} -->\n`;
        }
      }
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
    const fidelity = scoreGoalFidelity(
      userGoal,
      state.strategy || "",
      GROUNDED_FIDELITY_THRESHOLD
    );
    let goalPassed = fidelity.passed;
    const rejectReasons: string[] = [];

    // Hard gate: fidelity
    if (llmApproved && !goalPassed) {
      rejectReasons.push(
        `Goal fidelity gate failed (score=${fidelity.score.toFixed(3)} < ${GROUNDED_FIDELITY_THRESHOLD}): ${fidelity.reason}`
      );
      llmApproved = false;
    }

    // Hard gate: REQ coverage
    const reqCoverage =
      typeof state.reqCoverage === "number" && !Number.isNaN(state.reqCoverage)
        ? state.reqCoverage
        : 1;
    if (llmApproved && reqCoverage < MIN_REQ_COVERAGE) {
      rejectReasons.push(
        `Requirements coverage ${(reqCoverage * 100).toFixed(1)}% < ${MIN_REQ_COVERAGE * 100}% — too many REQs still missing`
      );
      llmApproved = false;
      goalPassed = false;
    }

    // Hard gate: cited paths must exist
    const targetRepo = state.targetRepo || process.cwd();
    const cites = verifyCitationsAgainstRepo(state.strategy || "", targetRepo);
    if (llmApproved && !cites.ok) {
      rejectReasons.push(cites.reason);
      llmApproved = false;
      goalPassed = false;
    }

    // Repetition / degeneration on strategy
    const rep = detectRepetition(state.strategy || "");
    if (llmApproved && !rep.ok) {
      rejectReasons.push(`Strategy degeneration: ${rep.reason}`);
      llmApproved = false;
      goalPassed = false;
    }

    if (rejectReasons.length) {
      auditReport = [
        `[REJECTED]`,
        ``,
        ...rejectReasons.map(
          (r, i) =>
            `### Issue ${i + 1}\n- أسباب الرفض / Rejection reason: ${r}\n- درجة الخطورة / Severity: Critical\n- طريقة الحل / How to fix: Ground claims in evidence-pack.md / evidence.json; cite only real paths; raise REQ coverage; avoid invented folders.\nFIX ${i + 1}: ${r}`
        ),
        ``,
        `--- LLM draft (overridden by grounded gates) ---`,
        auditReport,
      ].join("\n");
      warn(
        "Auditor",
        `Grounded gates FAIL — ${rejectReasons.length} issue(s); forcing REJECT`
      );
    }

    const auditPassed = llmApproved && goalPassed;
    // Empty / failed gates => CLOSED (never OPEN without APPROVED)
    const gateOpen = auditPassed === true;

    // Persist gates.json snapshot for the run (never empty→OPEN)
    try {
      const gatesPath = path.join(process.cwd(), "gates.json");
      const prev = fs.existsSync(gatesPath)
        ? JSON.parse(fs.readFileSync(gatesPath, "utf-8"))
        : { gates: [] };
      const gates = Array.isArray(prev.gates) ? prev.gates : [];
      gates.push({
        at: new Date().toISOString(),
        loop: loopNo,
        gate: gateOpen ? "OPEN" : "CLOSED",
        auditPassed,
        goalPassed,
        goalFidelityScore: fidelity.score,
        reqCoverage,
        missingCitations: cites.missing.map((m) => m.raw),
        rejectReasons,
      });
      fs.writeFileSync(
        gatesPath,
        JSON.stringify({ gates, latest: gates[gates.length - 1] }, null, 2),
        "utf-8"
      );
    } catch {
      /* ignore */
    }

    const auditDoc = [
      `# Audit v${loopNo}/${MAX_LOOPS}`,
      `Result: ${auditPassed ? "[APPROVED]" : "[REJECTED]"}`,
      `gate: ${gateOpen ? "OPEN" : "CLOSED"}`,
      `goalPassed: ${goalPassed}`,
      `goalFidelityScore: ${fidelity.score.toFixed(3)} (threshold ${GROUNDED_FIDELITY_THRESHOLD})`,
      `goalFidelityReason: ${fidelity.reason}`,
      `reqCoverage: ${reqCoverage.toFixed(3)} (min ${MIN_REQ_COVERAGE})`,
      `citationsOk: ${cites.ok}`,
      `repetitionOk: ${rep.ok}`,
      ``,
      auditReport,
    ].join("\n");
    fs.writeFileSync(path.join(state.loopDir, `audit-v${loopNo}.md`), auditDoc, "utf-8");
    fs.writeFileSync("audit-report.md", auditDoc, "utf-8");
    if (!auditPassed) {
      fs.writeFileSync(
        path.join(state.loopDir, `rejection-v${loopNo}.md`),
        `# Rejection v${loopNo}\n\ngate=CLOSED\ngoalPassed=${goalPassed}\n${auditReport}\n`,
        "utf-8"
      );
      warn("Auditor", `[REJECTED] loop v${loopNo} → gate CLOSED`);
    } else {
      ok("Auditor", `[APPROVED] loop v${loopNo} — gate OPEN (grounded OK)`);
    }
    return {
      auditReport: auditDoc,
      auditPassed,
      goalPassed,
      goalFidelityScore: fidelity.score,
      history: [auditDoc],
    };
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

  // Checkpointer enables crash-resume via thread_id
  getPersistence();
  return graph.compile({ checkpointer: getCheckpointer() });
}

let compiled: ReturnType<typeof buildGraph> | null = null;

function getCompiled() {
  if (!compiled) compiled = buildGraph();
  return compiled;
}

/** Reset compiled graph (tests / checkpointer swap). */
export function __resetReviewGraphForTests(): void {
  compiled = null;
}

export async function runReviewGraph(input: {
  brief: string;
  evidenceMarkdown: string;
  loopDir: string;
  userGoal?: string;
  targetRepo?: string;
  /** 0..1 REQ coverage from evidence matrix; default 1 when unknown. */
  reqCoverage?: number;
  /** LangGraph thread id — stable across resume after crash/restart */
  threadId?: string;
  /** When true, resume from last checkpoint instead of fresh state */
  resume?: boolean;
  runId?: string;
}): Promise<{
  strategy: string;
  auditReport: string;
  auditPassed: boolean;
  goalPassed: boolean;
  goalFidelityScore: number;
  loop: number;
  history: string[];
  threadId: string;
}> {
  fs.mkdirSync(input.loopDir, { recursive: true });
  getPersistence();
  const graph = getCompiled();
  const userGoal = input.userGoal || extractUserGoal(input.brief);
  const threadId =
    input.threadId ||
    process.env.SAM_HARNESS_RUN_ID ||
    `review-${Date.now().toString(36)}`;
  const config = {
    configurable: { thread_id: threadId },
  };

  if (input.runId) {
    appendTimeline(input.runId, {
      kind: "graph",
      name: input.resume ? "review-resume" : "review-start",
      status: "start",
      detail: { threadId },
    });
  }

  // Ensure gates.json exists as CLOSED until APPROVED (never empty→OPEN)
  try {
    if (!fs.existsSync("gates.json")) {
      fs.writeFileSync(
        "gates.json",
        JSON.stringify(
          {
            gates: [],
            latest: { gate: "CLOSED", auditPassed: false, at: new Date().toISOString() },
          },
          null,
          2
        ),
        "utf-8"
      );
    }
  } catch {
    /* ignore */
  }

  const out = await withSpan(
    "reviewGraph",
    { "sam.thread_id": threadId, "sam.resume": Boolean(input.resume) },
    async () => {
      if (input.resume) {
        // Resume: invoke with null input to continue from checkpoint
        return graph.invoke(null, config);
      }
      return graph.invoke(
        {
          brief: input.brief,
          evidenceMarkdown: input.evidenceMarkdown,
          loopDir: input.loopDir,
          userGoal,
          targetRepo: input.targetRepo || process.cwd(),
          reqCoverage:
            typeof input.reqCoverage === "number" ? input.reqCoverage : 1,
          strategy: "",
          auditReport: "",
          loop: 0,
          auditPassed: false,
          goalPassed: false,
          goalFidelityScore: 0,
          history: [],
        },
        config
      );
    }
  );

  if (input.runId) {
    appendTimeline(input.runId, {
      kind: "graph",
      name: "review-end",
      status: out.auditPassed ? "ok" : "error",
      detail: { loop: out.loop, auditPassed: out.auditPassed },
    });
  }

  return {
    strategy: out.strategy || "",
    auditReport: out.auditReport || "",
    auditPassed: Boolean(out.auditPassed),
    goalPassed: Boolean(out.goalPassed),
    goalFidelityScore: Number(out.goalFidelityScore) || 0,
    loop: out.loop || 0,
    history: out.history || [],
    threadId,
  };
}

export { MAX_LOOPS };
