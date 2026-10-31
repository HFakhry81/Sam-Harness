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
} from "./goalFidelity.js";
import {
  buildClaimRewritePrompt,
  finalizeClaimsClean,
  sanitizeDraftClaims,
  verifyCitationsAgainstRepo,
} from "./claimVerify.js";
import {
  assertCleanPackClaims,
  GROUNDED_FIDELITY_THRESHOLD,
  keywordHitInfo,
  scoreGroundedAuditRubric,
  scrubPackMarkdown,
  type RubricContext,
} from "./fidelityRubric.js";
import {
  clipStrategyForPrompt,
  injectGroundedStrategyBlocks,
} from "./finalReport.js";
import {
  hasStructuralMarkdownHoles,
  normalizeMarkdownStructure,
} from "./markdownNormalize.js";
import type { ChecklistFinding } from "./auditChecklist.js";
import {
  repairStrategyDeterministically,
  runStrategyConsistencyChecks,
  type ConsistencyGrounding,
} from "./strategyConsistency.js";
import {
  appendGateEntry,
  currentRunId,
  ensureGatesForRun,
  logModelClaimErrors,
  type ModelClaimError,
} from "./gatesStore.js";
import {
  chooseNonDegenerateDraft,
  detectRepetition,
} from "./repetitionGuard.js";
import {
  detectStall,
  MAX_CONSECUTIVE_STALLS,
} from "./stallDetect.js";
import { learningContextBlock } from "../controlplane/projectMemory.js";
import { getCheckpointer } from "../lib/db/checkpointer.js";
import { getPersistence } from "../lib/db/index.js";
import { withRetry } from "../lib/retry.js";
import { appendTimeline } from "../lib/durableRuns.js";
import { withSpan } from "../lib/observability/index.js";

const MAX_LOOPS = 5;
/** Max writer rewrites when invalid claims are detected. */
const MAX_CLAIM_REWRITES = 2;
/** Min share of REQs that must be addressed (not missing) before APPROVED. */
export const MIN_REQ_COVERAGE = 0.7;

export { GROUNDED_FIDELITY_THRESHOLD };

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

/** LangGraph conditional edge after audit — caps remediations at MAX_LOOPS / stall. */
export function routeAfterAudit(state: {
  auditPassed?: boolean;
  loop?: number;
  stallCount?: number;
}): "approved" | "failed" | "remediate" {
  if (state.auditPassed) return "approved";
  if ((state.stallCount || 0) >= MAX_CONSECUTIVE_STALLS) return "failed";
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

/** Pull explicit auditor rejection reasons for the next rewrite prompt. */
export function extractAuditorIssues(report: string): string[] {
  const issues: string[] = [];
  const text = String(report || "");
  for (const line of text.split(/\r?\n/)) {
    const reason = line.match(
      /(?:Rejection reason|أسباب الرفض)\s*(?:\/\s*Rejection reason)?\s*:\s*(.+)$/i
    );
    if (reason?.[1] && reason[1].trim().length > 6) {
      issues.push(reason[1].trim());
      continue;
    }
    const how = line.match(/(?:How to fix|طريقة الحل)\s*(?:\/\s*How to fix)?\s*:\s*(.+)$/i);
    if (how?.[1] && how[1].trim().length > 6) {
      issues.push(`Fix: ${how[1].trim()}`);
    }
  }
  for (const f of extractFixes(text)) {
    if (!issues.some((x) => x.includes(f.slice(0, 40)))) issues.push(f);
  }
  // Catch common structural / RTM complaints even without FIX lines
  if (/empty (section|bullet|list)|structural|trailing colon|incomplete content|erasure placeholder/i.test(text)) {
    issues.push(
      "Repair structural holes: no empty sections/bullets, renumber lists, fill or remove empty headings"
    );
  }
  if (/RTM|traceability|coverage|implemented.*docx|hallucin/i.test(text)) {
    issues.push(
      "Use deterministic RTM statuses/coverage from evidence; never mark Implemented from spec-only citations"
    );
  }
  if (/P0|dependency|onPress|mock data|Key Findings/i.test(text)) {
    issues.push(
      "Include all P0 checklist findings with real file:line code citations from evidence"
    );
  }
  return [...new Set(issues)].slice(0, 20);
}

function findingsAsChecklist(
  findings: Array<{
    id?: string;
    severity?: string;
    summary?: string;
    category?: string;
    paths?: string[];
    detail?: string;
  }>
): ChecklistFinding[] {
  return (findings || []).map((f, i) => ({
    id: f.id || `F-${i + 1}`,
    category: (f.category as ChecklistFinding["category"]) || "mock_data",
    severity: (f.severity as ChecklistFinding["severity"]) || "P0",
    summary: f.summary || "",
    paths: f.paths || [],
    detail: f.detail || "",
  }));
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
  /** Eligible REQ denominator (excludes n/a headings). */
  eligibleCount: Annotation<number>,
  /** Code-backed REQ count (implemented+partial+contradicts). */
  codeBackedCount: Annotation<number>,
  groundedCurrency: Annotation<string>,
  /** Per-run id for gates.json isolation. */
  runId: Annotation<string>,
  /** Spec files ingested (rubric: specs_read). */
  specsReadCount: Annotation<number>,
  /** REQ rows for rubric scoring + deterministic RTM injection. */
  reqRows: Annotation<
    Array<{ id: string; status: string; codePaths?: string[]; text?: string }>
  >,
  /** Checklist findings for P0/P1 rubric + Key Findings injection. */
  findings: Annotation<
    Array<{
      id?: string;
      severity?: string;
      summary?: string;
      category?: string;
      paths?: string[];
      detail?: string;
    }>
  >,
  strategy: Annotation<string>,
  auditReport: Annotation<string>,
  loop: Annotation<number>,
  auditPassed: Annotation<boolean>,
  goalPassed: Annotation<boolean>,
  goalFidelityScore: Annotation<number>,
  /** Consecutive no-progress (identical/near-identical) strategy drafts. */
  stallCount: Annotation<number>,
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
    const currency = state.groundedCurrency || "EGP";
    const targetRepo = state.targetRepo || process.cwd();
    let stallCount = state.stallCount || 0;
    let strategy: string;

    // Stall-aware model opts: raise temperature / force cloud on prior stall
    const stalledBefore = stallCount > 0;
    const activeOpts = {
      ...strategistOpts,
      temperature: stalledBefore ? 0.45 : strategistOpts.temperature,
      prefersCloud: true as boolean | undefined,
      explicitComplexity: stalledBefore || undefined,
    };
    const activeModel = stalledBefore
      ? makeSpecialistModel({
          ...activeOpts,
          prefersCloud: true,
          explicitComplexity: true,
          forceLocal: false,
        })
      : strategist;

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
## Current state vs gaps (cite ONLY real evidence paths — never invented monorepo roots unless they exist)
## Currency/locale MUST use ${currency} (never invent other ISO currency codes)
## Concrete recommendations / next actions for failing checklist items
## Risks & verification
## Delivery / handoff notes`;

      strategy = await invokeWithCloudFallback(
        activeModel,
        activeOpts,
        `You are Agency Strategist. Write a COMPLETE concrete strategy (max 1400 words) that ANSWERS the ORIGINAL USER GOAL.
Not intentions — deliverables that match the goal.
Cite ONLY paths that appear in EVIDENCE. Currency=${currency}.
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
      const auditorIssues = extractAuditorIssues(state.auditReport || "");
      const checklistItems = [
        `You MUST address EVERY item below. Mark each as DONE or GAP with a real path citation.`,
        `1. Remove any non-${currency} currency claims; rewrite using ${currency} only.`,
        `2. Remove citations to nonexistent paths (invented monorepo roots, etc.).`,
        `3. Cover failing REQs / checklist items from the rejection (auth wiring, mock data, missing deps, stack conflict, UI handlers without onPress).`,
        `4. Do NOT copy the prior strategy verbatim — change structure and fill the gaps.`,
        `5. Do NOT leave empty sections, empty bullets, skipped list numbers, or trailing colons with no content.`,
        `6. Do NOT mark REQs Implemented from spec .docx alone — cite code paths; use the deterministic RTM block.`,
        ...auditorIssues.map((f, i) => `AUDITOR ISSUE ${i + 1}: ${f}`),
        ...fixes.map((f, i) => `FIX ${i + 1}: ${f}`),
      ];
      const briefRem = [
        `REMEDIATION CHECKLIST for strategy-v${loopNo} (item-by-item — do not skip):`,
        ...checklistItems,
        ``,
        `ORIGINAL USER GOAL:`,
        clip(userGoal, 2000),
        learned ? `PROJECT MEMORY / LESSONS:\n${clip(learned, 2000)}` : "",
        ``,
        `FULL REJECTION REPORT:`,
        clip(state.auditReport, 4000),
        ``,
        `PRIOR STRATEGY (do not reproduce unchanged; deterministic RTM/Key Findings are summarized — full blocks stay in the written file):`,
        clipStrategyForPrompt(state.strategy || "", 4500),
        ``,
        `EVIDENCE (cite only these real paths):`,
        clip(state.evidenceMarkdown, 4000),
        stalledBefore
          ? `\nSTALL DETECTED on prior loop — you MUST produce a materially different draft targeting only failing REQs and missing citations.\n`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
      fs.writeFileSync(
        path.join(state.loopDir, `remediation-brief-v${loopNo - 1}.md`),
        briefRem,
        "utf-8"
      );
      strategy = await invokeWithCloudFallback(activeModel, activeOpts, briefRem);
    }

    // Stall detector vs previous draft
    const stall = detectStall(state.strategy, strategy);
    if (stall.stalled && loopNo > 1) {
      stallCount += 1;
      warn(
        "Strategist",
        `Stall detected (${stall.reason}) — consecutive=${stallCount}/${MAX_CONSECUTIVE_STALLS}`
      );
      // One forced rewrite with higher temperature / cloud
      try {
        const antiStall = makeSpecialistModel({
          ...strategistOpts,
          temperature: 0.55,
          prefersCloud: true,
          explicitComplexity: true,
          forceLocal: false,
        });
        const rewrite = await invokeWithCloudFallback(
          antiStall,
          { ...strategistOpts, temperature: 0.55 },
          `STALL BREAKER: Prior draft was ${stall.reason}. Rewrite from scratch.
Address ONLY failing items from this rejection checklist:
${clip(state.auditReport || "", 3500)}

Use currency=${currency}. Cite only real paths from evidence.
EVIDENCE:
${clip(state.evidenceMarkdown, 3500)}
GOAL:
${clip(userGoal, 1500)}`
        );
        const stall2 = detectStall(strategy, rewrite);
        if (!stall2.stalled) {
          strategy = rewrite;
          // Recovered this loop — do not count as consecutive stall if rewrite succeeded
          stallCount = Math.max(0, stallCount - 1);
          ok("Strategist", "Stall broken with alternate draft");
        } else {
          strategy =
            rewrite +
            `\n\n<!-- STALL_FLAG: ${stall.reason}; consecutive=${stallCount} -->\n`;
        }
      } catch (e) {
        strategy +=
          `\n\n<!-- STALL_FLAG: ${stall.reason}; rewrite failed: ${String((e as Error)?.message || e).slice(0, 100)} -->\n`;
      }
    } else if (loopNo > 1) {
      stallCount = 0;
    }

    // Repetition guard
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
          temperature: 0.2,
        });
        const retryPrompt = `Rewrite the strategy WITHOUT repeated lines. Keep substance; vary wording. Currency=${currency}.
PRIOR DRAFT (degenerate; deterministic blocks summarized):
${clipStrategyForPrompt(strategy, 3500)}
GOAL:
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
        if (chosen.usedFallback || !detectRepetition(strategy).ok) {
          strategy +=
            `\n\n<!-- REPETITION_FLAG: regenerate incomplete -->\n`;
        }
      } catch (e) {
        const chosen = chooseNonDegenerateDraft(strategy, priorGood);
        strategy = chosen.text;
        strategy +=
          `\n\n<!-- REPETITION_FLAG: ${String((e as Error)?.message || e).slice(0, 120)} -->\n`;
      }
    }

    // Claim sanitizer: detect → rewrite (max 2) → clean-delete (never [REMOVED] / never auto-sub currency)
    const runId = state.runId || currentRunId();
    const groundedReqRows = (state.reqRows || []).map((r) => ({
      id: r.id,
      status: r.status,
      codePaths: r.codePaths,
    }));
    const groundedCoverage =
      typeof state.eligibleCount === "number" &&
      state.eligibleCount > 0 &&
      typeof state.codeBackedCount === "number"
        ? {
            coverageRatio:
              typeof state.reqCoverage === "number" ? state.reqCoverage : 0,
            codeBackedCount: state.codeBackedCount,
            eligibleCount: state.eligibleCount,
          }
        : null;
    const priorAuditorIssues = extractAuditorIssues(state.auditReport || "");
    {
      let claimErrors: ModelClaimError[] = [];
      let detected = sanitizeDraftClaims(
        strategy,
        targetRepo,
        currency,
        groundedReqRows,
        priorAuditorIssues,
        groundedCoverage
      );
      if (detected.modelErrors.length) {
        claimErrors = claimErrors.concat(
          detected.modelErrors.map((e) => ({ ...e, loop: loopNo }))
        );
      }
      for (
        let attempt = 0;
        attempt < MAX_CLAIM_REWRITES && detected.needsRewrite;
        attempt++
      ) {
        warn(
          "Strategist",
          `Invalid claims detected — rewrite attempt ${attempt + 1}/${MAX_CLAIM_REWRITES}`
        );
        const rewritePrompt =
          detected.rewritePrompt ||
          buildClaimRewritePrompt({
            draft: strategy,
            invalid: detected.invalid,
            groundedCurrency: currency,
            evidenceClip: clip(state.evidenceMarkdown, 3500),
            priorAuditorIssues,
          });
        // Inject full evidence clip into rewrite prompt
        const fullRewrite = rewritePrompt.includes("EVIDENCE (real paths only):")
          ? rewritePrompt.replace(
              /\(targetRepo=[\s\S]*?currency=[\s\S]*?\)/,
              clip(state.evidenceMarkdown, 3500)
            )
          : rewritePrompt;
        try {
          const rewritten = await invokeWithCloudFallback(
            activeModel,
            activeOpts,
            fullRewrite
          );
          strategy = rewritten;
          detected = sanitizeDraftClaims(
            strategy,
            targetRepo,
            currency,
            groundedReqRows,
            priorAuditorIssues,
            groundedCoverage
          );
          if (detected.modelErrors.length) {
            claimErrors = claimErrors.concat(
              detected.modelErrors.map((e) => ({
                ...e,
                loop: loopNo,
                detail: `${e.detail} (after rewrite ${attempt + 1})`,
              }))
            );
          }
        } catch (e) {
          warn(
            "Strategist",
            `Claim rewrite failed: ${String((e as Error)?.message || e).slice(0, 120)}`
          );
          break;
        }
      }
      if (detected.needsRewrite) {
        const cleaned = finalizeClaimsClean(
          strategy,
          targetRepo,
          currency,
          groundedReqRows,
          groundedCoverage
        );
        strategy = cleaned.text;
        if (cleaned.flags.length) {
          warn("Strategist", `Claim clean-delete: ${cleaned.flags.join("; ")}`);
        }
        if (cleaned.modelErrors.length) {
          claimErrors = claimErrors.concat(
            cleaned.modelErrors.map((e) => ({ ...e, loop: loopNo }))
          );
        }
      } else if (detected.flags.length) {
        warn("Strategist", `Claim sanitizer: ${detected.flags.join("; ")}`);
      }
      // Absolute ban residues — strip any leftover placeholders without substituting currency
      strategy = strategy.replace(/\s*\[REMOVED[^\]]*\]\s*/gi, " ");
      strategy = normalizeMarkdownStructure(strategy);
      if (claimErrors.length) {
        logModelClaimErrors(claimErrors, runId);
      }
      const packCheck = assertCleanPackClaims(strategy, currency);
      if (!packCheck.ok) {
        warn(
          "Strategist",
          `Pack claim assertion FAIL after sanitize: ${packCheck.violations.join(", ")}`
        );
      }
    }

    // Inject deterministic RTM + Key Findings so auditor always sees grounded P0s / coverage
    strategy = injectGroundedStrategyBlocks(strategy, {
      checklistFindings: findingsAsChecklist(state.findings || []),
      reqRows: (state.reqRows || []).map((r) => ({
        id: r.id,
        text: r.text || "",
        status: r.status,
        codePaths: r.codePaths || [],
      })),
      coverageRatio: state.reqCoverage,
      eligibleCount: state.eligibleCount,
      codeBackedCount: state.codeBackedCount,
      groundedCurrency: currency,
    });
    strategy = normalizeMarkdownStructure(strategy);
    if (hasStructuralMarkdownHoles(strategy)) {
      strategy = normalizeMarkdownStructure(strategy);
    }

    if (stallCount >= MAX_CONSECUTIVE_STALLS) {
      strategy +=
        `\n\n<!-- STRUCTURED_STALL_FAILURE: ${MAX_CONSECUTIVE_STALLS} consecutive no-progress loops — stopping remediation early -->\n`;
      warn(
        "Strategist",
        `Early stop: ${MAX_CONSECUTIVE_STALLS} consecutive stalls — structured failure`
      );
    }

    fs.writeFileSync(path.join(state.loopDir, `strategy-v${loopNo}.md`), strategy, "utf-8");
    fs.writeFileSync("ceo-draft.md", strategy, "utf-8");
    ok("Strategist", `strategy-v${loopNo}.md (stallCount=${stallCount})`);
    return { strategy, loop: loopNo, stallCount };
  };

  const audit = async (state: ReviewStateType) => {
    const loopNo = state.loop || 1;
    live(
      `Auditor (${specialistLabel("gemma4:cloud", "gemma3:1b")})`,
      `LangGraph loop v${loopNo}/${MAX_LOOPS} — audit-v${loopNo}`
    );

    const userGoal = state.userGoal || extractUserGoal(state.brief);
    const bookingMode = goalWantsBookingBlueprint(userGoal);
    const runId = state.runId || currentRunId();
    const targetRepo = state.targetRepo || process.cwd();
    const currency = state.groundedCurrency || "EGP";

    const consistencyGrounding: ConsistencyGrounding = {
      reqRows: (state.reqRows || []).map((r) => ({
        id: r.id,
        text: r.text,
        status: r.status,
        codePaths: r.codePaths,
      })),
      checklistFindings: findingsAsChecklist(state.findings || []),
      coverageRatio: state.reqCoverage,
      eligibleCount: state.eligibleCount,
      codeBackedCount: state.codeBackedCount,
      groundedCurrency: currency,
      targetRepo,
    };

    // —— Deterministic pre-check BEFORE any LLM auditor call ——
    let strategyForAudit = state.strategy || "";
    let pre = runStrategyConsistencyChecks(strategyForAudit, consistencyGrounding);
    if (!pre.ok) {
      warn(
        "Auditor",
        `Deterministic consistency FAIL (${pre.issues.length}) — repairing without LLM loop`
      );
      strategyForAudit = repairStrategyDeterministically(
        strategyForAudit,
        consistencyGrounding
      );
      try {
        fs.writeFileSync("ceo-draft.md", strategyForAudit, "utf-8");
        fs.writeFileSync(
          path.join(state.loopDir, `strategy-v${loopNo}-consistency-repair.md`),
          strategyForAudit,
          "utf-8"
        );
      } catch {
        /* ignore */
      }
      pre = runStrategyConsistencyChecks(strategyForAudit, consistencyGrounding);
    }

    // Keyword hits are informational only — gate uses task rubric
    const keywordInfo = keywordHitInfo(userGoal, strategyForAudit);
    const keywordFidelity = scoreGoalFidelity(userGoal, strategyForAudit);

    const rubricCtx: RubricContext = {
      strategy: strategyForAudit,
      evidenceMarkdown: state.evidenceMarkdown,
      specsReadCount: state.specsReadCount || 0,
      reqRows: state.reqRows || [],
      findings: state.findings || [],
      cwd: process.cwd(),
    };
    const rubricPre = scoreGroundedAuditRubric(rubricCtx);

    const clipOpts = {
      reqRowCount: (state.reqRows || []).length,
      findingCount: (state.findings || []).filter((f) => {
        if (!f) return false;
        if (/^CUR-OK$/i.test(String(f.id || ""))) return false;
        return true;
      }).length,
    };

    let auditReport = "";
    let llmApproved = false;
    const rejectReasons: string[] = [];

    if (!pre.ok) {
      // Still inconsistent after deterministic repair — reject without spending LLM
      auditReport = [
        `[REJECTED]`,
        `### Issue 1`,
        `- Rejection reason: Deterministic consistency checks failed after repair`,
        `- Severity: Critical`,
        `- How to fix: Align narrative with reqTrace RTM; remove invented statuses/coverage/deps; keep deterministic blocks intact`,
        ...pre.issues.slice(0, 8).map((i, n) => `FIX ${n + 1}: [${i.kind}] ${i.detail}`),
      ].join("\n");
      rejectReasons.push(
        ...pre.issues.slice(0, 6).map((i) => `${i.kind}: ${i.detail}`)
      );
      warn("Auditor", "Skipped LLM auditor — deterministic consistency still failing");
    } else {
      const bookingRules = bookingMode
        ? `REJECT clinic-only framing, missing BookingTypes, missing token lifecycle, missing QR→invoice,
or "will include later" language.`
        : `REJECT topic drift away from ORIGINAL USER GOAL (e.g. BookingType/clinic blueprints when the goal was memory/Daily Ops/Control Plane UI).
REJECT strategies that ignore the stated goal.`;

      auditReport = await invokeWithCloudFallback(
        auditor,
        auditorOpts,
        `You are Agency Auditor (evidence-grounded + goal-fidelity).
REJECT rubber-stamp checklists. Prefer citing EVIDENCE paths.
REJECT invented files not in evidence.
REJECT drafts that contain erasure placeholders or invent wrong currencies / nonexistent monorepo roots.
Do NOT invent per-REQ statuses, coverage percentages, counts, or dependency lists — those are deterministic from reqTrace.
${bookingRules}

APPROVE only if strategy is concrete, consistent with evidence (or honestly marks gaps),
AND clearly answers ORIGINAL USER GOAL (specs cited, REQ statuses from RTM, stack conflict, P0/P1 findings, recommendations).

ORIGINAL USER GOAL:
${clip(userGoal, 2000)}

Rubric hint (gate): ${rubricPre.reason}
Keyword hits (informational only, not a gate): ${keywordInfo.hit}/${keywordInfo.total} (${keywordFidelity.reason})

EVIDENCE PACK:
${clip(state.evidenceMarkdown, 5000)}

STRATEGY-v${loopNo} (deterministic RTM/Key Findings summarized here; full blocks are in ceo-draft.md / written strategy — never reject solely for prompt truncation):
${clipStrategyForPrompt(strategyForAudit, 5500, clipOpts)}

Line 1: [APPROVED] or [REJECTED]
${REJECTION_FORMAT}`
      );
      llmApproved = parseApproved(auditReport);
    }

    // Re-score rubric against repaired strategy
    const rubric = scoreGroundedAuditRubric({
      ...rubricCtx,
      strategy: strategyForAudit,
    });
    let goalPassed = rubric.passed;

    // Hard gate: grounded-audit rubric (NOT keyword count)
    if (llmApproved && !goalPassed) {
      rejectReasons.push(
        `Goal fidelity rubric failed (score=${rubric.score.toFixed(3)} < ${GROUNDED_FIDELITY_THRESHOLD}): ${rubric.reason}`
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

    // Detect residual invalid claims (strategize / consistency repair should have cleaned)
    let strategyText = strategyForAudit;
    const groundedReqRows = (state.reqRows || []).map((r) => ({
      id: r.id,
      status: r.status,
      codePaths: r.codePaths,
    }));
    const groundedCoverage =
      typeof state.eligibleCount === "number" &&
      state.eligibleCount > 0 &&
      typeof state.codeBackedCount === "number"
        ? {
            coverageRatio:
              typeof state.reqCoverage === "number" ? state.reqCoverage : 0,
            codeBackedCount: state.codeBackedCount,
            eligibleCount: state.eligibleCount,
          }
        : null;
    const residual = sanitizeDraftClaims(
      strategyText,
      targetRepo,
      currency,
      groundedReqRows,
      extractAuditorIssues(state.auditReport || ""),
      groundedCoverage
    );
    if (residual.needsRewrite || residual.invalid.length) {
      logModelClaimErrors(
        residual.modelErrors.map((e) => ({ ...e, loop: loopNo })),
        runId
      );
      const cleaned = finalizeClaimsClean(
        strategyText,
        targetRepo,
        currency,
        groundedReqRows,
        groundedCoverage
      );
      strategyText = cleaned.text;
      try {
        fs.writeFileSync("ceo-draft.md", strategyText, "utf-8");
        fs.writeFileSync(
          path.join(state.loopDir, `strategy-v${loopNo}-sanitized.md`),
          strategyText,
          "utf-8"
        );
      } catch {
        /* ignore */
      }
      if (cleaned.modelErrors.length) {
        logModelClaimErrors(
          cleaned.modelErrors.map((e) => ({ ...e, loop: loopNo })),
          runId
        );
      }
    }
    // Keep structure clean before grounded gates / auditor persistence
    strategyText = normalizeMarkdownStructure(strategyText);
    if (
      !/##\s*Key Findings\b/i.test(strategyText) ||
      !/##\s*Requirements traceability \(deterministic\)/i.test(strategyText)
    ) {
      strategyText = injectGroundedStrategyBlocks(strategyText, {
        checklistFindings: findingsAsChecklist(state.findings || []),
        reqRows: (state.reqRows || []).map((r) => ({
          id: r.id,
          text: r.text || "",
          status: r.status,
          codePaths: r.codePaths || [],
        })),
        coverageRatio: state.reqCoverage,
        eligibleCount: state.eligibleCount,
        codeBackedCount: state.codeBackedCount,
        groundedCurrency: currency,
      });
      strategyText = normalizeMarkdownStructure(strategyText);
    }

    const cites = verifyCitationsAgainstRepo(strategyText, targetRepo);
    if (llmApproved && !cites.ok) {
      rejectReasons.push(cites.reason);
      llmApproved = false;
      goalPassed = false;
    }
    if (llmApproved && residual.removedCurrencies.length) {
      rejectReasons.push(
        `Invalid currency claims detected (${residual.removedCurrencies
          .slice(0, 4)
          .join(",")}) — must use ${currency}; never auto-substitute`
      );
      llmApproved = false;
      goalPassed = false;
    }

    // Pack-level assertion: 0 wrong-currency / packages/ / apps/web / [REMOVED]
    const packAssert = assertCleanPackClaims(strategyText, currency);
    if (!packAssert.ok) {
      rejectReasons.push(
        `Pack claim assertion FAIL: forbidden residues ${packAssert.violations.join(", ")}`
      );
      llmApproved = false;
      goalPassed = false;
      warn(
        "Auditor",
        `Pack claim assertion FAIL — ${packAssert.violations.join(", ")}`
      );
    }

    // Repetition / degeneration on strategy
    const rep = detectRepetition(strategyText);
    if (llmApproved && !rep.ok) {
      rejectReasons.push(`Strategy degeneration: ${rep.reason}`);
      llmApproved = false;
      goalPassed = false;
    }

    // Stall early-stop note in audit
    if ((state.stallCount || 0) >= MAX_CONSECUTIVE_STALLS) {
      rejectReasons.push(
        `Remediation stalled (${state.stallCount} consecutive identical/near-identical drafts)`
      );
      llmApproved = false;
      goalPassed = false;
    }

    if (rejectReasons.length) {
      auditReport = [
        `[REJECTED]`,
        ``,
        ...rejectReasons.map(
          (r, i) =>
            `### Issue ${i + 1}\n- Rejection reason: ${r}\n- Severity: Critical\n- How to fix: Ground claims in evidence-pack.md / evidence.json; cite only real paths; raise REQ coverage; never use erasure placeholders or invent wrong currencies/paths.\nFIX ${i + 1}: ${r}`
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

    // Per-run gates.json (keyed by runId — never append prior-run loops)
    try {
      appendGateEntry(
        {
          at: new Date().toISOString(),
          loop: loopNo,
          gate: gateOpen ? "OPEN" : "CLOSED",
          auditPassed,
          goalPassed,
          goalFidelityScore: rubric.score,
          keywordHitRatio: keywordInfo.ratio,
          keywordHits: { hit: keywordInfo.hit, total: keywordInfo.total },
          rubricItems: rubric.items.map((i) => ({
            id: i.id,
            passed: i.passed,
            applicable: i.applicable,
          })),
          reqCoverage,
          missingCitations: cites.missing.map((m) => m.raw),
          rejectReasons,
          packClaimViolations: packAssert.ok ? [] : packAssert.violations,
        },
        runId
      );
    } catch {
      /* ignore */
    }

    const auditDoc = [
      `# Audit v${loopNo}/${MAX_LOOPS}`,
      `Result: ${auditPassed ? "[APPROVED]" : "[REJECTED]"}`,
      `gate: ${gateOpen ? "OPEN" : "CLOSED"}`,
      `goalPassed: ${goalPassed}`,
      `goalFidelityScore: ${rubric.score.toFixed(3)} (rubric threshold ${GROUNDED_FIDELITY_THRESHOLD})`,
      `goalFidelityReason: ${rubric.reason}`,
      `keywordHits (informational): ${keywordInfo.hit}/${keywordInfo.total} ratio=${keywordInfo.ratio.toFixed(3)}`,
      `reqCoverage: ${reqCoverage.toFixed(3)} (min ${MIN_REQ_COVERAGE})`,
      `citationsOk: ${cites.ok}`,
      `packClaimsOk: ${packAssert.ok}`,
      `repetitionOk: ${rep.ok}`,
      ``,
      auditReport,
    ].join("\n");
    // Scrub instructional residues before persisting — pack must not contain erasure placeholders
    const cleanAudit = scrubPackMarkdown(auditDoc).text;
    fs.writeFileSync(path.join(state.loopDir, `audit-v${loopNo}.md`), cleanAudit, "utf-8");
    fs.writeFileSync("audit-report.md", cleanAudit, "utf-8");
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
      goalFidelityScore: rubric.score,
      strategy: strategyText,
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
  eligibleCount?: number;
  codeBackedCount?: number;
  groundedCurrency?: string;
  /** Spec files ingested — rubric specs_read. */
  specsReadCount?: number;
  reqRows?: Array<{
    id: string;
    status: string;
    codePaths?: string[];
    text?: string;
  }>;
  findings?: Array<{
    id?: string;
    severity?: string;
    summary?: string;
    category?: string;
    paths?: string[];
    detail?: string;
  }>;
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
  stallCount?: number;
}> {
  fs.mkdirSync(input.loopDir, { recursive: true });
  getPersistence();
  const graph = getCompiled();
  const userGoal = input.userGoal || extractUserGoal(input.brief);
  const runId = input.runId || currentRunId();
  const threadId =
    input.threadId ||
    process.env.SAM_HARNESS_RUN_ID ||
    runId ||
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

  // Per-run gates.json — reset when runId changes (never leak prior pack loops)
  if (!input.resume) {
    ensureGatesForRun(runId);
  } else {
    ensureGatesForRun(runId);
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
          eligibleCount:
            typeof input.eligibleCount === "number" ? input.eligibleCount : 0,
          codeBackedCount:
            typeof input.codeBackedCount === "number"
              ? input.codeBackedCount
              : 0,
          groundedCurrency: input.groundedCurrency || "EGP",
          runId,
          specsReadCount: input.specsReadCount || 0,
          reqRows: input.reqRows || [],
          findings: input.findings || [],
          strategy: "",
          auditReport: "",
          loop: 0,
          auditPassed: false,
          goalPassed: false,
          goalFidelityScore: 0,
          stallCount: 0,
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
    stallCount: Number(out.stallCount) || 0,
  };
}

export { MAX_LOOPS };
