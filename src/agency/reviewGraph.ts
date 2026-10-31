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
  formatCompactRtmSummary,
  injectGroundedStrategyBlocks,
  stripRtmSectionsForPrompt,
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
import { asciiGateReason, toAsciiDashes } from "./asciiText.js";
import { classifyRouteIntent } from "./routeIntent.js";
import { writePackArtifact } from "../lib/packWorkspace.js";
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
/**
 * Min share of REQs for the coverage gate.
 * Audit intent: assessed traceability (missing counts when searched).
 * Build/implement intent: implementation coverage (code-backed).
 */
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

/**
 * Authoritative target/spec paths for strategist + auditor prompts.
 * The harness cwd (Sam-Harness) must NEVER be presented as the audited project.
 */
export function formatTargetRepoPromptBlock(input: {
  targetRepo: string;
  specRoot?: string;
  harnessCwd?: string;
}): string {
  const target = path.normalize(input.targetRepo || "");
  const spec = input.specRoot ? path.normalize(input.specRoot) : "";
  const harness = path.normalize(input.harnessCwd || process.cwd());
  const lines = [
    `TARGET REPO (authoritative — cite THIS project; never substitute the Sam-Harness harness cwd):`,
    `\`${target}\``,
  ];
  if (spec) {
    lines.push(`SPEC ROOT (read-only docs/specs):`);
    lines.push(`\`${spec}\``);
  }
  if (
    harness &&
    target &&
    harness.toLowerCase() !== target.toLowerCase()
  ) {
    lines.push(
      `HARNESS CWD (internal only — NOT the audited target): \`${harness}\``
    );
  }
  return lines.join("\n");
}

/** Drop accidental harness-cwd citations when they are not the target repo. */
export function scrubHarnessCwdLeak(
  text: string,
  targetRepo: string,
  harnessCwd: string = process.cwd()
): string {
  const target = path.normalize(targetRepo || "");
  const harness = path.normalize(harnessCwd || "");
  if (!harness || !target) return String(text || "");
  if (harness.toLowerCase() === target.toLowerCase()) return String(text || "");
  const variants = [
    harness,
    harness.replace(/\\/g, "/"),
    harness.replace(/\//g, "\\"),
  ];
  let out = String(text || "");
  for (const v of variants) {
    if (!v || v.length < 4) continue;
    const re = new RegExp(
      v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "gi"
    );
    out = out.replace(re, target);
  }
  return out;
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
  /** Spec/docs root from the owner goal (read-only; may contain Arabic/spaces). */
  specRoot: Annotation<string>,
  /**
   * Gate coverage metric (0..1). For audit intent this is assessed
   * traceability; for build/implement it is implementation coverage.
   */
  reqCoverage: Annotation<number>,
  /** Implementation coverage (code-backed) - reported metric always. */
  implementationCoverage: Annotation<number>,
  /** Audit assessed-traceability coverage. */
  assessedCoverage: Annotation<number>,
  /** audit | ops | quick | unknown - selects which coverage the gate uses. */
  taskIntent: Annotation<string>,
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
    const specRoot = state.specRoot || "";
    const targetBlock = formatTargetRepoPromptBlock({
      targetRepo,
      specRoot: specRoot || undefined,
      harnessCwd: process.cwd(),
    });
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
Cite ONLY paths that appear in EVIDENCE under the TARGET REPO below. Currency=${currency}.
NEVER cite the Sam-Harness harness cwd as the audited project.
Obey PROJECT MEMORY lessons when they apply (do not repeat known failures).

${sections}

${targetBlock}

ORIGINAL USER GOAL (authoritative — fail if ignored):
${clip(userGoal, 2500)}

${learned ? `${clip(learned, 2500)}\n` : ""}EVIDENCE:
${clip(stripRtmSectionsForPrompt(state.evidenceMarkdown), 5000)}

BRIEF:
${clip(state.brief, 8000)}`
      );
      strategy = scrubHarnessCwdLeak(strategy, targetRepo);
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
      const remClipOpts = {
        reqRows: (state.reqRows || []).map((r) => ({
          id: r.id,
          status: r.status,
        })),
        reqRowCount: (state.reqRows || []).length,
        coverageRatio:
          typeof state.implementationCoverage === "number"
            ? state.implementationCoverage
            : undefined,
        assessedCoverageRatio:
          typeof state.assessedCoverage === "number"
            ? state.assessedCoverage
            : undefined,
        eligibleCount: state.eligibleCount,
        codeBackedCount: state.codeBackedCount,
        assessedCount:
          typeof state.eligibleCount === "number" &&
          typeof state.assessedCoverage === "number"
            ? Math.round(state.assessedCoverage * state.eligibleCount)
            : undefined,
      };
      const briefRem = [
        `REMEDIATION CHECKLIST for strategy-v${loopNo} (item-by-item — do not skip):`,
        ...checklistItems,
        ``,
        targetBlock,
        ``,
        `ORIGINAL USER GOAL:`,
        clip(userGoal, 2000),
        learned ? `PROJECT MEMORY / LESSONS:\n${clip(learned, 2000)}` : "",
        ``,
        `FULL REJECTION REPORT:`,
        clip(state.auditReport, 4000),
        ``,
        `PRIOR STRATEGY (do not reproduce unchanged; deterministic RTM/Key Findings are summarized — full blocks stay in the written file):`,
        clipStrategyForPrompt(state.strategy || "", 4500, remClipOpts),
        ``,
        `EVIDENCE (cite only these real paths under TARGET REPO):`,
        clip(stripRtmSectionsForPrompt(state.evidenceMarkdown), 4000),
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
      strategy = scrubHarnessCwdLeak(strategy, targetRepo);
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
    const implCoverageForRtm =
      typeof state.implementationCoverage === "number" &&
      !Number.isNaN(state.implementationCoverage)
        ? state.implementationCoverage
        : typeof state.reqCoverage === "number"
          ? state.reqCoverage
          : 0;
    const assessedCoverageForRtm =
      typeof state.assessedCoverage === "number" &&
      !Number.isNaN(state.assessedCoverage)
        ? state.assessedCoverage
        : 1;
    const groundedCoverage =
      typeof state.eligibleCount === "number" &&
      state.eligibleCount > 0 &&
      typeof state.codeBackedCount === "number"
        ? {
            // Always implementation coverage for claim checks / RTM reported metric
            coverageRatio: implCoverageForRtm,
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
      coverageRatio: implCoverageForRtm,
      assessedCoverageRatio: assessedCoverageForRtm,
      assessedCount:
        typeof state.eligibleCount === "number"
          ? Math.round(assessedCoverageForRtm * state.eligibleCount)
          : undefined,
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

    strategy = scrubHarnessCwdLeak(strategy, targetRepo);
    strategy = normalizeMarkdownStructure(strategy);
    fs.writeFileSync(path.join(state.loopDir, `strategy-v${loopNo}.md`), strategy, "utf-8");
    writePackArtifact("ceo-draft.md", strategy, { bom: true });
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

    const implCoverageForConsistency =
      typeof state.implementationCoverage === "number" &&
      !Number.isNaN(state.implementationCoverage)
        ? state.implementationCoverage
        : typeof state.reqCoverage === "number"
          ? state.reqCoverage
          : 0;
    const consistencyGrounding: ConsistencyGrounding = {
      reqRows: (state.reqRows || []).map((r) => ({
        id: r.id,
        text: r.text,
        status: r.status,
        codePaths: r.codePaths,
      })),
      checklistFindings: findingsAsChecklist(state.findings || []),
      // Consistency / RTM reported metric is always implementation coverage
      coverageRatio: implCoverageForConsistency,
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
        writePackArtifact("ceo-draft.md", strategyForAudit, { bom: true });
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
      reqRows: (state.reqRows || []).map((r) => ({
        id: r.id,
        status: r.status,
      })),
      coverageRatio:
        typeof state.implementationCoverage === "number"
          ? state.implementationCoverage
          : undefined,
      assessedCoverageRatio:
        typeof state.assessedCoverage === "number"
          ? state.assessedCoverage
          : undefined,
      eligibleCount: state.eligibleCount,
      codeBackedCount: state.codeBackedCount,
      assessedCount:
        typeof state.eligibleCount === "number" &&
        typeof state.assessedCoverage === "number"
          ? Math.round(state.assessedCoverage * state.eligibleCount)
          : undefined,
    };
    const compactRtm = formatCompactRtmSummary({
      reqRows: clipOpts.reqRows,
      coverageRatio: clipOpts.coverageRatio,
      assessedCoverageRatio: clipOpts.assessedCoverageRatio,
      eligibleCount: clipOpts.eligibleCount,
      codeBackedCount: clipOpts.codeBackedCount,
      assessedCount: clipOpts.assessedCount,
    });
    const auditTargetBlock = formatTargetRepoPromptBlock({
      targetRepo,
      specRoot: state.specRoot || undefined,
      harnessCwd: process.cwd(),
    });

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
REJECT rubber-stamp checklists. Prefer citing EVIDENCE paths under TARGET REPO.
REJECT invented files not in evidence.
REJECT drafts that contain erasure placeholders or invent wrong currencies / nonexistent monorepo roots.
REJECT citing the Sam-Harness harness cwd as the audited target.
Do NOT invent per-REQ statuses, coverage percentages, counts, or dependency lists — use the DETERMINISTIC RTM SUMMARY below (complete id:status list).
Never treat a truncated evidence-pack table as incomplete coverage when the DETERMINISTIC RTM SUMMARY lists all REQs.
${bookingRules}

APPROVE only if strategy is concrete, consistent with evidence (or honestly marks gaps),
AND clearly answers ORIGINAL USER GOAL (specs cited, REQ statuses from RTM, stack conflict, P0/P1 findings, recommendations).

${auditTargetBlock}

ORIGINAL USER GOAL:
${clip(userGoal, 2000)}

Rubric hint (gate): ${rubricPre.reason}
Keyword hits (informational only, not a gate): ${keywordInfo.hit}/${keywordInfo.total} (${keywordFidelity.reason})

${compactRtm}

EVIDENCE PACK (RTM table omitted here — use DETERMINISTIC RTM SUMMARY above for all REQ statuses):
${clip(stripRtmSectionsForPrompt(state.evidenceMarkdown), 5000)}

STRATEGY-v${loopNo} (deterministic RTM/Key Findings summarized here with COMPLETE id:status list; full blocks are in ceo-draft.md — never reject solely for prompt truncation):
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

    // Hard gate: REQ coverage — audit uses assessed traceability; build uses implementation
    const intentKind =
      state.taskIntent ||
      classifyRouteIntent(state.userGoal || state.brief || "").kind;
    const isAuditIntent = intentKind === "audit" || intentKind === "unknown";
    const implementationCoverage =
      typeof state.implementationCoverage === "number" &&
      !Number.isNaN(state.implementationCoverage)
        ? state.implementationCoverage
        : typeof state.reqCoverage === "number"
          ? state.reqCoverage
          : 1;
    const assessedCoverage =
      typeof state.assessedCoverage === "number" &&
      !Number.isNaN(state.assessedCoverage)
        ? state.assessedCoverage
        : 1;
    const reqCoverage = isAuditIntent ? assessedCoverage : implementationCoverage;
    if (llmApproved && reqCoverage < MIN_REQ_COVERAGE) {
      rejectReasons.push(
        asciiGateReason(
          isAuditIntent
            ? `Audit traceability ${(reqCoverage * 100).toFixed(1)}% < ${MIN_REQ_COVERAGE * 100}% - too many REQs lack an assessed search/status trace`
            : `Implementation coverage ${(reqCoverage * 100).toFixed(1)}% < ${MIN_REQ_COVERAGE * 100}% - too many REQs still missing`
        )
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
            coverageRatio: implementationCoverage,
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
        writePackArtifact("ceo-draft.md", strategyText, { bom: true });
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
        coverageRatio: implementationCoverage,
        assessedCoverageRatio: assessedCoverage,
        assessedCount:
          typeof state.eligibleCount === "number"
            ? Math.round(assessedCoverage * state.eligibleCount)
            : undefined,
        eligibleCount: state.eligibleCount,
        codeBackedCount: state.codeBackedCount,
        groundedCurrency: currency,
      });
      strategyText = normalizeMarkdownStructure(strategyText);
    }

    strategyText = scrubHarnessCwdLeak(strategyText, targetRepo);
    const cites = verifyCitationsAgainstRepo(strategyText, targetRepo, {
      specRoot: state.specRoot || undefined,
    });
    if (llmApproved && !cites.ok) {
      rejectReasons.push(cites.reason);
      llmApproved = false;
      goalPassed = false;
    }
    if (llmApproved && residual.removedCurrencies.length) {
      rejectReasons.push(
        `Invalid currency claims detected (${residual.removedCurrencies
          .slice(0, 4)
          .join(",")}) - must use ${currency}; never auto-substitute`
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
        `Pack claim assertion FAIL - ${packAssert.violations.join(", ")}`
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

    // Windows-safe ASCII for every written gate reason (no em-dash mojibake)
    const asciiRejectReasons = rejectReasons.map(asciiGateReason);

    if (asciiRejectReasons.length) {
      auditReport = [
        `[REJECTED]`,
        ``,
        ...asciiRejectReasons.map(
          (r, i) =>
            `### Issue ${i + 1}\n- Rejection reason: ${r}\n- Severity: Critical\n- How to fix: Ground claims in evidence-pack.md / evidence.json; cite only real paths; raise REQ coverage; never use erasure placeholders or invent wrong currencies/paths.\nFIX ${i + 1}: ${r}`
        ),
        ``,
        `--- LLM draft (overridden by grounded gates) ---`,
        auditReport,
      ].join("\n");
      warn(
        "Auditor",
        `Grounded gates FAIL - ${asciiRejectReasons.length} issue(s); forcing REJECT`
      );
    }

    const auditPassed = llmApproved && goalPassed;
    // Empty / failed gates => CLOSED (never OPEN without APPROVED)
    const gateOpen = auditPassed === true;

    // Per-run gates.json (keyed by runId - never append prior-run loops)
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
          implementationCoverage,
          assessedCoverage,
          taskIntent: intentKind,
          missingCitations: cites.missing.map((m) => m.raw),
          rejectReasons: asciiRejectReasons,
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
      `reqCoverage: ${reqCoverage.toFixed(3)} (min ${MIN_REQ_COVERAGE}; intent=${intentKind}; gateMetric=${isAuditIntent ? "assessed-traceability" : "implementation"})`,
      `implementationCoverage: ${implementationCoverage.toFixed(3)} (reported)`,
      `assessedCoverage: ${assessedCoverage.toFixed(3)} (audit traceability)`,
      `citationsOk: ${cites.ok}`,
      `packClaimsOk: ${packAssert.ok}`,
      `repetitionOk: ${rep.ok}`,
      ``,
      auditReport,
    ].join("\n");
    // Scrub instructional residues before persisting - pack must not contain erasure placeholders
    const cleanAudit = scrubPackMarkdown(toAsciiDashes(auditDoc)).text;
    fs.writeFileSync(path.join(state.loopDir, `audit-v${loopNo}.md`), cleanAudit, "utf-8");
    writePackArtifact("audit-report.md", cleanAudit, { bom: true });
    if (!auditPassed) {
      fs.writeFileSync(
        path.join(state.loopDir, `rejection-v${loopNo}.md`),
        toAsciiDashes(
          `# Rejection v${loopNo}\n\ngate=CLOSED\ngoalPassed=${goalPassed}\n${auditReport}\n`
        ),
        "utf-8"
      );
      warn("Auditor", `[REJECTED] loop v${loopNo} -> gate CLOSED`);
    } else {
      ok("Auditor", `[APPROVED] loop v${loopNo} - gate OPEN (grounded OK)`);
    }
    return {
      auditReport: cleanAudit,
      auditPassed,
      goalPassed,
      goalFidelityScore: rubric.score,
      strategy: strategyText,
      history: [cleanAudit],
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
  /** Spec/docs root from the owner goal (may include spaces/Arabic). */
  specRoot?: string;
  /**
   * Gate coverage metric. Prefer assessedCoverage for audit intent;
   * implementationCoverage for build/implement. If only reqCoverage is
   * provided it is used as the gate metric.
   */
  reqCoverage?: number;
  implementationCoverage?: number;
  assessedCoverage?: number;
  taskIntent?: string;
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
          specRoot: input.specRoot || "",
          reqCoverage:
            typeof input.reqCoverage === "number" ? input.reqCoverage : 1,
          implementationCoverage:
            typeof input.implementationCoverage === "number"
              ? input.implementationCoverage
              : typeof input.reqCoverage === "number"
                ? input.reqCoverage
                : 1,
          assessedCoverage:
            typeof input.assessedCoverage === "number"
              ? input.assessedCoverage
              : 1,
          taskIntent:
            input.taskIntent ||
            classifyRouteIntent(userGoal || input.brief || "").kind,
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
