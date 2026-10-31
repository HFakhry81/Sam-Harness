/**
 * Agency runner — portable hybrid team for any target project.
 * Flow: intake → evidence → LangGraph review → (gate) architect/help/marketer → pack.
 */
import * as fs from "fs";
import * as path from "path";
import { live, ok, sys, warn } from "../lib/colors.js";
import {
  defaultProjectDocsRoot,
  resolveNextSamHarnessReviewDir,
  resolveTargetRepoPath,
} from "../lib/reviewPackDir.js";
import {
  makeCeoModel,
  makeSpecialistModel,
  specialistLabel,
  useOllamaCloudNow,
} from "../agent/models.js";
import { taskConfig } from "../../task.js";
import { AGENCY_ROLES } from "./roles.js";
import {
  resolveDownstreamPipeline,
  resolveRoleModels,
  type TeamRoleConfig,
} from "./teamConfig.js";
import {
  formatReadStatsConsole,
  scanRepoEvidence,
  scanRepoEvidenceAsync,
} from "./evidence.js";
import { MAX_LOOPS, runReviewGraph } from "./reviewGraph.js";
import { syncDeliveryBoardFromBacklog } from "./delivery/sync.js";
import { writeGoNoGoTemplate } from "./delivery/goNoGo.js";
import {
  extractUserGoal,
  goalWantsBookingBlueprint,
  isSamHarnessSelfGoal,
} from "./goalFidelity.js";
import { classifyRouteIntent } from "./routeIntent.js";
import { toAsciiDashes } from "./asciiText.js";
import {
  assertCleanPackClaims,
  enforcePackResiduesAfterWrite,
  scoreGroundedAuditRubric,
  scrubPackFiles,
  scrubPackMarkdown,
} from "./fidelityRubric.js";
import {
  appendGateEntry,
  resetGatesForRun,
} from "./gatesStore.js";
import {
  buildAgencyVerdict,
  verdictConsoleLine,
  verdictMarkdown,
  type AgencyVerdict,
} from "./agencyVerdict.js";
import { composeFinalReport } from "./finalReport.js";
import {
  extractGoalPaths,
  primarySpecRoot,
  primaryTargetRepo,
} from "./pathExtract.js";
import { chooseNonDegenerateDraft } from "./repetitionGuard.js";
import { learningContextBlock } from "../controlplane/projectMemory.js";
import { withLanguageDirective } from "../lib/i18n/index.js";
import { beginOutputRun } from "../lib/outputHome.js";
import {
  assertNoPackFilesInCwd,
  copyPackArtifactsTo,
  getPackWriteRoot,
  packArtifactExists,
  packArtifactPath,
  PACK_ARTIFACT_NAMES,
  PACK_CWD_FORBIDDEN,
  readPackArtifact,
  writePackArtifact,
} from "../lib/packWorkspace.js";
import type { AgencyRunResult, Engagement } from "./types.js";

/** Stale pack artifacts from a prior pack must not poison this run's assertions. */
const STALE_RUN_ARTIFACTS = [
  "ceo-draft.md",
  "audit-report.md",
  "final-report.md",
  "audit-history.md",
  "execution-result.md",
  "PACK_CLAIM_ASSERTION.md",
  "agency-verdict.md",
  ...PACK_CWD_FORBIDDEN,
];

function writePack(name: string, content: string): void {
  writePackArtifact(name, content, { bom: /\.md$/i.test(name) });
}

function readPackOrEmpty(name: string): string {
  return readPackArtifact(name) || "";
}

function labelForRole(roleId: string): string {
  const m = resolveRoleModels(roleId);
  return specialistLabel(m.cloud, m.local);
}

function clip(text: string, max = 6000): string {
  if (!text) return "";
  return text.length <= max ? text : text.slice(0, max) + "\n...(truncated)";
}

async function invoke(
  model: ReturnType<typeof makeCeoModel>,
  prompt: string,
  userText?: string
): Promise<string> {
  const res = await model.invoke(
    withLanguageDirective(prompt, { locale: "auto", userText })
  );
  return String(res.content || "");
}

function loadBriefExtras(task: string): string {
  const goal = extractUserGoal(task);
  const booking = goalWantsBookingBlueprint(goal);
  const files = [
    ...(booking ? ["docs/project-spec.md"] : []),
    "docs/AGENCY_PLATFORM_ROADMAP.md",
    "docs/WORKFLOW_REVIEW_LOOP.md",
    "docs/PRODUCTION_HARDENING_P0.md",
    // Prefer Control Plane sources when goal is ops/memory/UI
    ...(!booking
      ? [
          "src/controlplane/projectMemory.ts",
          "src/controlplane/dailyOps.ts",
          "src/controlplane/artifacts.ts",
        ]
      : []),
    "ceo-draft.md",
    "audit-report.md",
    "execution-plan.md",
    "CODE_VS_PLAN_GAP_MATRIX.md",
  ];
  const chunks: string[] = [];
  const learned = learningContextBlock(process.cwd(), 10, 5);
  if (learned) {
    chunks.push(`\n### Project memory / lessons (obey when relevant)\n${learned}`);
  }
  for (const f of files) {
    if (fs.existsSync(f)) {
      chunks.push(`\n### ${f}\n${clip(fs.readFileSync(f, "utf-8"), 6000)}`);
      sys(`Loaded: ${f}`);
    }
  }
  const mentioned =
    task.match(/(?:[A-Za-z]:\\)?(?:[\w .{}()[\]@+-]+[\\/])*[\w .{}()[\]@+-]+\.md/gi) ||
    [];
  for (const raw of mentioned) {
    const m = raw.replace(/^[`'"\s]+|[`'"\s]+$/g, "").trim();
    if (m && fs.existsSync(m) && !files.includes(m)) {
      chunks.push(`\n### ${m}\n${clip(fs.readFileSync(m, "utf-8"), 5000)}`);
    }
  }
  return chunks.join("\n");
}

export async function runAgencyArchitecture(task: string): Promise<AgencyRunResult> {
  sys(
    useOllamaCloudNow()
      ? "Agency specialists → Ollama Cloud (+ local router)"
      : "Agency specialists → local fallback (set OLLAMA_API_KEY for cloud)"
  );
  sys(`Agency roster: ${AGENCY_ROLES.map((r) => r.id).join(", ")}`);

  // Fresh gates.json for this pack/run — never append prior-run loops
  const packRunId =
    process.env.SAM_HARNESS_RUN_ID ||
    process.env.SAM_RUN_ID ||
    `run-${Date.now().toString(36)}`;
  // Stage all pack output under SAM_OUTPUT_HOME (never the Sam-Harness repo cwd)
  beginOutputRun(packRunId);
  const packWriteRoot = getPackWriteRoot(packRunId);
  resetGatesForRun(packRunId);

  // Drop stale pack + accidental cwd leftovers so prior [REMOVED]/SAR cannot poison assertions
  for (const name of STALE_RUN_ARTIFACTS) {
    try {
      const staged = packArtifactPath(name);
      if (fs.existsSync(staged)) fs.unlinkSync(staged);
    } catch {
      /* ignore */
    }
    try {
      if (fs.existsSync(name)) fs.unlinkSync(name);
    } catch {
      /* ignore */
    }
  }

  const userGoalEarly = extractUserGoal(
    typeof taskConfig.body === "string" && taskConfig.body.trim()
      ? taskConfig.body
      : ""
  );
  const fullGoalText =
    (typeof taskConfig.body === "string" && taskConfig.body.trim()
      ? taskConfig.body
      : "") || task;
  const goalPaths = extractGoalPaths(fullGoalText || userGoalEarly || task);
  let targetRepoAbs = resolveTargetRepoPath(
    primaryTargetRepo(goalPaths, taskConfig.targetRepo) || taskConfig.targetRepo
  );
  const specRoot = primarySpecRoot(goalPaths);
  // Hard guard: self-goals never archive under a foreign client docs tree
  if (
    isSamHarnessSelfGoal(userGoalEarly || taskConfig.title || "") &&
    !goalWantsBookingBlueprint(userGoalEarly || taskConfig.title || "")
  ) {
    const foreign =
      /maw3ed|\\fanni\\|\/fanni\//i.test(targetRepoAbs) ||
      (!/sam-harness/i.test(targetRepoAbs) &&
        path.normalize(targetRepoAbs).toLowerCase() !==
          path.normalize(process.cwd()).toLowerCase());
    if (foreign) {
      warn(
        "Intake",
        `Self-goal pack redirect: ${targetRepoAbs} → ${process.cwd()} (refuse foreign docsRoot)`
      );
      targetRepoAbs = process.cwd();
    }
  }
  const userGoal =
    extractUserGoal(task) ||
    userGoalEarly ||
    goalPaths.goalText ||
    taskConfig.title;

  const engagement: Engagement = {
    id: `eng-${Date.now().toString(36)}`,
    clientName: "UpNexa",
    projectName: path.basename(targetRepoAbs) || "client-project",
    targetRepo: targetRepoAbs,
    docsRoot: specRoot || defaultProjectDocsRoot(targetRepoAbs),
    goal: userGoal.slice(0, 2000),
    route: "architecture",
    createdAt: new Date().toISOString(),
    goalPaths: {
      targetRepos: goalPaths.targetRepos.map((p) => p.normalized),
      specRoots: goalPaths.specRoots.map((p) => p.normalized),
      other: goalPaths.other.map((p) => p.normalized),
    },
    specRoot: specRoot || undefined,
  };
  writePack("engagement.json", JSON.stringify(engagement, null, 2));
  ok(
    "Intake",
    `engagement ${engagement.id} → repo=${engagement.targetRepo}` +
      (specRoot ? ` spec=${specRoot}` : "")
  );

  // Tool-layer write policy: prompt paths are READ-ONLY; shell off for analysis
  try {
    const { registerSourceRoots, registerWriteRoots, setDisableShell, setStrictWriteRoots } =
      await import("../lib/writePolicy.js");
    const { getOutputHome } = await import("../lib/outputHome.js");
    registerSourceRoots([
      engagement.targetRepo,
      ...(specRoot ? [specRoot] : []),
      ...(engagement.goalPaths?.targetRepos || []),
      ...(engagement.goalPaths?.specRoots || []),
    ]);
    // Pack/docs under client tree may equal specRoot — never treat spec as writable.
    registerWriteRoots([getOutputHome()]);
    setStrictWriteRoots(true);
    setDisableShell(true);
  } catch {
    /* ignore */
  }

  // Evidence scout v2 (local) — repo index + spec REQs + locale/currency
  live("Evidence Scout", "Indexing repo + ingesting spec (grounded v2)...");
  let evidence = await scanRepoEvidenceAsync(engagement.targetRepo, {
    goal: userGoal,
    specRoot: specRoot || undefined,
  });
  // Fallback to sync if async somehow empty
  if (!evidence.hits.length && !evidence.spec?.requirements.length) {
    evidence = scanRepoEvidence(engagement.targetRepo, {
      goal: userGoal,
      specRoot: specRoot || undefined,
    });
  }
  if (evidence.localeCurrency) {
    engagement.locale = evidence.localeCurrency.locale;
    engagement.currency = evidence.localeCurrency.currency;
    writePack("engagement.json", JSON.stringify(engagement, null, 2));
  }
  writePack("evidence-pack.md", evidence.summaryMarkdown);
  writePack("evidence.json", JSON.stringify(evidence.json, null, 2));
  if (evidence.reqMatrix) {
    writePack("REQ_TRACEABILITY.md", evidence.reqMatrix.markdown);
  }
  const readStats = evidence.readStats;
  if (readStats) {
    ok("Evidence Scout", formatReadStatsConsole(readStats));
    sys(
      `Evidence read detail: specs=${readStats.specs
        .slice(0, 6)
        .map((s) => `${s.path}(${s.bytes}b)`)
        .join(", ") || "none"}; sources=${readStats.sources
        .slice(0, 6)
        .map((s) => `${s.path}(${s.bytes}b)`)
        .join(", ") || "none"}`
    );
  }
  ok(
    "Evidence Scout",
    `${evidence.hits.length} hits · REQs=${evidence.spec?.requirements.length || 0} · currency=${evidence.localeCurrency?.currency || "?"} → evidence-pack.md + evidence.json`
  );

  const brief = `${task}\n${loadBriefExtras(task)}`;
  const loopDir = path.join(packWriteRoot, "review-loop");
  // Fresh loop dir — avoid stale strategy-v1 from prior runs leaking into the next task
  try {
    fs.rmSync(loopDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  fs.mkdirSync(loopDir, { recursive: true });

  // Always persist checklist markdown for the pack (including on rejection)
  if (evidence.checklist) {
    try {
      writePack("AUDIT_CHECKLIST.md", evidence.checklist.markdown);
    } catch {
      /* ignore */
    }
  }

  const review = await runReviewGraph({
    brief,
    evidenceMarkdown: evidence.summaryMarkdown,
    loopDir,
    userGoal,
    targetRepo: engagement.targetRepo,
    specRoot: engagement.specRoot || specRoot || "",
    // Gate metric: audit intent uses assessed traceability; build uses implementation
    reqCoverage:
      (classifyRouteIntent(userGoal).kind === "audit" ||
      classifyRouteIntent(userGoal).kind === "unknown"
        ? evidence.reqMatrix?.assessedCoverageRatio
        : evidence.reqMatrix?.coverageRatio) ?? 1,
    implementationCoverage: evidence.reqMatrix?.coverageRatio ?? 1,
    assessedCoverage: evidence.reqMatrix?.assessedCoverageRatio ?? 1,
    taskIntent: classifyRouteIntent(userGoal).kind,
    eligibleCount: evidence.reqMatrix?.eligibleCount ?? 0,
    codeBackedCount: evidence.reqMatrix?.codeBackedCount ?? 0,
    groundedCurrency: evidence.localeCurrency?.currency || "EGP",
    specsReadCount: evidence.spec?.filesRead?.length || 0,
    reqRows: (evidence.reqMatrix?.rows || []).map((r) => ({
      id: r.id,
      status: r.status,
      codePaths: r.codePaths,
      text: r.text,
    })),
    findings: (evidence.checklist?.findings || []).map((f) => ({
      id: f.id,
      severity: f.severity,
      summary: f.summary,
      category: f.category,
      paths: f.paths,
      detail: f.detail,
    })),
    runId: packRunId,
  });

  const groundedCurrency = evidence.localeCurrency?.currency || "EGP";

  // Residue check on THIS run's strategy (sanitizer already ran before audit).
  // Do NOT inspect stale final-report.md from a prior pack here — final-report
  // is re-checked AFTER the last write via enforcePackResiduesAfterWrite.
  const strategyScrub = scrubPackMarkdown(review.strategy || "", [], groundedCurrency);
  if (strategyScrub.text !== review.strategy) {
    try {
      writePack("ceo-draft.md", strategyScrub.text);
    } catch {
      /* ignore */
    }
  }
  const draftCheck = assertCleanPackClaims(strategyScrub.text, groundedCurrency);
  const packRejectReasons: string[] = [];
  let packClaimsOk = draftCheck.ok;
  if (!draftCheck.ok) {
    packRejectReasons.push(
      `Pack claim assertion FAIL: forbidden residues ${draftCheck.violations.join(", ")} in strategy`
    );
    packClaimsOk = false;
    warn("Pack", packRejectReasons[0]);
  }

  // Single-sourced verdict — console / final-report / gates.json must agree.
  // May be revised after final-report residue enforcement below.
  let verdict = buildAgencyVerdict({
    auditPassed: review.auditPassed,
    goalPassed: review.goalPassed,
    goalFidelityScore: review.goalFidelityScore,
    loop: review.loop,
    maxLoops: MAX_LOOPS,
    packClaimsOk,
    rejectReasons: packRejectReasons,
  });
  let auditPassed = verdict.auditPassed;
  let goalPassed = verdict.goalPassed;

  function persistVerdict(v: AgencyVerdict): void {
    writePack("agency-verdict.md", verdictMarkdown(v));
    try {
      appendGateEntry(
        {
          at: new Date().toISOString(),
          loop: review.loop,
          gate: v.gate,
          auditPassed: v.auditPassed,
          goalPassed: v.goalPassed,
          goalFidelityScore: v.goalFidelityScore,
          rejectReasons: v.rejectReasons,
          packClaimsOk: v.packClaimsOk,
          reason: v.reason,
        },
        packRunId
      );
    } catch {
      /* ignore */
    }
  }

  const finalReportEvidence = {
    verdict,
    checklistFindings: evidence.checklist?.findings || [],
    reqRows: (evidence.reqMatrix?.rows || []).map((r) => ({
      id: r.id,
      text: r.text,
      status: r.status,
      codePaths: r.codePaths,
      evidenceNotes: r.evidenceNotes,
    })),
    groundedCurrency,
    targetRepo: engagement.targetRepo,
  };

  function writeComposedFinalReport(modelProse?: string): string {
    // Refresh verdict snapshot inside deterministic sections
    const body = composeFinalReport({
      evidence: { ...finalReportEvidence, verdict },
      modelProse,
    });
    writePack("final-report.md", body);
    return body;
  }
  persistVerdict(verdict);
  if (verdict.gate === "OPEN") {
    ok("Gate", verdictConsoleLine(verdict));
  } else {
    warn("Gate", verdictConsoleLine(verdict));
  }

  writePack(
    "audit-history.md",
    toAsciiDashes(
      scrubPackMarkdown(
        [
          `# Audit History (LangGraph, max ${MAX_LOOPS})`,
          verdictMarkdown(verdict),
          ``,
          ...review.history.map((h, i) => `---\n## Loop ${i + 1}\n\n${h}`),
        ].join("\n"),
        [],
        groundedCurrency
      ).text
    )
  );
  fs.writeFileSync(
    path.join(loopDir, "LOOP_SUMMARY.md"),
    [
      `# Review loop summary`,
      `- engine: LangGraph StateGraph`,
      `- loops_run: ${review.loop}`,
      `- max: ${MAX_LOOPS}`,
      `- auditPassed: ${verdict.auditPassed}`,
      `- goalPassed: ${verdict.goalPassed}`,
      `- goalFidelityScore: ${verdict.goalFidelityScore.toFixed(3)}`,
      `- gate: ${verdict.gate}`,
      `- reason: ${verdict.reason}`,
      `- evidence_hits: ${evidence.hits.length}`,
      readStats
        ? `- read_stats: specs=${readStats.specFilesRead}/${readStats.specBytes}b sources=${readStats.sourceFilesRead}/${readStats.sourceBytes}b`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
    "utf-8"
  );

  let layeredBlueprint = "(skipped — audit gate closed)";
  let helpSystemSpec = "(skipped — audit gate closed)";
  let marketingCampaign = "(skipped — audit gate closed)";
  let finalReport = "";

  /** Phase 8 — specialist factory from team.json (defaults match prior hardcodes). */
  function specialist(role: string, temperature: number, numPredict: number) {
    return makeSpecialistModel({ role, temperature, numPredict });
  }

  const ceo = makeCeoModel();
  const strategist = specialist("strategist", 0.15, 1200);
  const downstream = resolveDownstreamPipeline(process.cwd());
  sys(
    `Downstream pipeline: ${downstream.map((r) => r.id).join(" → ") || "(none enabled)"}`
  );

  async function runDownstreamStep(
    role: TeamRoleConfig,
    ctx: {
      layeredBlueprint: string;
      helpSystemSpec: string;
      marketingCampaign: string;
      finalReport: string;
    }
  ): Promise<typeof ctx> {
    const model = makeSpecialistModel({
      role: role.id,
      temperature: role.temperature ?? 0.3,
      numPredict: role.numPredict ?? 1000,
    });
    const outName = (role.outputs && role.outputs[0]) || `${role.id}-output.md`;

    if (role.id === "architect") {
      live(`Architect (${labelForRole("architect")})`, "Blueprint from APPROVED strategy + evidence...");
      ctx.layeredBlueprint = await invoke(
        model,
        `N-tier production blueprint for the client project.
Cite evidence paths when claiming existing code; mark gaps honestly.
APPROVED strategy:
${clip(review.strategy, 8000)}
EVIDENCE:
${clip(evidence.summaryMarkdown, 4000)}
BRIEF:
${clip(brief, 4000)}`,
        task
      );
      writePack("execution-plan.md", ctx.layeredBlueprint);
      ok("Architect", "execution-plan.md");
      return ctx;
    }
    if (role.id === "help") {
      live(`Help (${labelForRole("help")})`, "Help spec...");
      ctx.helpSystemSpec = await invoke(
        model,
        `In-app help for multi-purpose ops desk + customer (not clinic-only).\nArchitecture:\n${clip(ctx.layeredBlueprint, 7000)}`
      );
      writePack("help-system-spec.md", ctx.helpSystemSpec);
      return ctx;
    }
    if (role.id === "marketer") {
      live(`Marketer (${labelForRole("marketer")})`, "GTM...");
      ctx.marketingCampaign = await invoke(
        model,
        `Honest GTM + short video script. No over-claim.\n${clip(ctx.layeredBlueprint, 5000)}\n${clip(task, 2000)}`
      );
      writePack("marketing-campaign.md", ctx.marketingCampaign);
      return ctx;
    }
    if (role.id === "verifier") {
      live("CEO Verifier", "Verify deliverables...");
      const draft = await invoke(
        ceo,
        `Verify agency pack vs task. Audit gate=APPROVED.
Task: ${clip(task, 2500)}
Strategy: ${clip(review.strategy, 1000).replace(/\n\.\.\.\(truncated\)\s*$/, "\n...(truncated narrative)")}
Audit: ${clip(review.auditReport, 600)}
Blueprint: ${clip(ctx.layeredBlueprint, 1000)}
Reply [VERIFIED] or [GAPS] + checklist. Be concise — no repeated lines.
Deterministic Key Findings / RTM are already in final-report.md — do not drop them.`
      );
      const picked = chooseNonDegenerateDraft(draft, review.strategy);
      const modelProse = picked.usedFallback
        ? `${draft}\n\n---\n[DEGENERATION_GUARD] Regenerated text was repetitive; kept prior strategy excerpt + flag.\n\n${picked.text.slice(0, 2000)}`
        : picked.text;
      let prose = modelProse;
      if (!picked.report.ok) {
        warn("Verifier", `final-report degeneration: ${picked.report.reason}`);
        prose += `\n\n[DEGENERATION_FLAG] ${picked.report.reason}\n`;
      }
      // Deterministic Executive summary / Key Findings / Recommendations cannot be dropped
      ctx.finalReport = writeComposedFinalReport(prose);
      return ctx;
    }

    // Custom specialist step
    const prompt =
      role.prompt ||
      `You are ${role.title}. ${role.mission || ""}\nProduce the deliverable for this engagement.`;
    live(`${role.title} (${labelForRole(role.id)})`, `Custom specialist → ${outName}`);
    const text = await invoke(
      model,
      `${prompt}

APPROVED strategy:
${clip(review.strategy, 5000)}
Architecture (if any):
${clip(ctx.layeredBlueprint, 4000)}
BRIEF:
${clip(brief, 3000)}`,
      task
    );
    writePack(outName, text);
    ok(role.title, outName);
    return ctx;
  }

  if (!auditPassed) {
    warn("Gate", `Downstream specialists SKIPPED — ${verdict.reason}`);
    // Still emit deterministic Key Findings so rejected packs are not brief
    finalReport = writeComposedFinalReport(
      [`[FAILED_AUDIT_GATE]`, clip(review.auditReport, 2500)].join("\n")
    );
    writePack(
      "execution-result.md",
      scrubPackMarkdown(
        `# Agency Result\n- engine: LangGraph\n${verdictMarkdown(verdict)}\n- loops: ${review.loop}\n`,
        [],
        groundedCurrency
      ).text
    );
  } else {
    let ctx = {
      layeredBlueprint,
      helpSystemSpec,
      marketingCampaign,
      finalReport,
    };
    for (const step of downstream) {
      ctx = await runDownstreamStep(step, ctx);
    }
    layeredBlueprint = ctx.layeredBlueprint;
    helpSystemSpec = ctx.helpSystemSpec;
    marketingCampaign = ctx.marketingCampaign;
    finalReport = ctx.finalReport;

    // Gap matrix + backlog when architect ran (still part of delivery OS after GO gate)
    const architectEnabled = downstream.some((r) => r.id === "architect");
    if (architectEnabled) {
      const architect = specialist("architect", 0.2, 1400);
      live("Architect", "Gap matrix + backlog...");
      const gapMatrix = await invoke(
        architect,
        `CODE_VS_PLAN_GAP_MATRIX.md
Table: Requirement | Evidence path (from pack or "not found") | Gap | Severity | Ticket
ONLY cite paths from EVIDENCE or mark not found. Do not invent Nest/Prisma paths.
EVIDENCE:
${clip(evidence.summaryMarkdown, 5000)}
Strategy:
${clip(review.strategy, 3000)}
Blueprint:
${clip(layeredBlueprint, 3000)}`
      );
      writePack("CODE_VS_PLAN_GAP_MATRIX.md", gapMatrix);
      const backlog = await invoke(
        architect,
        `IMPLEMENTATION_BACKLOG.md P0 then P1 from:\n${clip(gapMatrix, 6000)}\nReal paths under ${engagement.targetRepo}`
      );
      writePack("IMPLEMENTATION_BACKLOG.md", backlog);
      const nextSprint = await invoke(
        strategist,
        `NEXT_SPRINT.md short from:\n${clip(gapMatrix, 2500)}`
      );
      writePack("NEXT_SPRINT.md", nextSprint);
      const ticket = await invoke(
        architect,
        `TICKET_P0_STARTER.md for first P0:\n${clip(backlog, 5000)}`
      );
      writePack("TICKET_P0_STARTER.md", ticket);
      ok("Architect", "gap matrix + backlog saved");

      syncDeliveryBoardFromBacklog({
        engagementId: engagement.id,
        targetRepo: engagement.targetRepo,
      });
      writeGoNoGoTemplate();
    }

    if (!finalReport) {
      finalReport = writeComposedFinalReport(
        [
          `Downstream steps: ${downstream.map((r) => r.id).join(", ")}`,
          ``,
          clip(layeredBlueprint, 2000),
        ].join("\n")
      );
    } else {
      // Re-compose so deterministic Key Findings survive verifier/model prose
      finalReport = writeComposedFinalReport(finalReport);
    }

    writePack(
      "execution-result.md",
      scrubPackMarkdown(
        `# Agency Result\n- engine: LangGraph\n${verdictMarkdown(verdict)}\n- loops: ${review.loop}\n- downstream: ${downstream.map((r) => r.id).join(",")}\n`,
        [],
        groundedCurrency
      ).text
    );
  }

  // AFTER the last final-report rewrite: remediate residues across every pack file
  // (rewrite max 2 → clean sentence delete). Gate MUST close if anything remains.
  {
    const enforcement = await enforcePackResiduesAfterWrite({
      cwd: packWriteRoot,
      targetRepo: engagement.targetRepo,
      groundedCurrency,
      rewriteFn: async (prompt) => invoke(strategist, prompt, task),
    });
    if (enforcement.remediations.length) {
      sys(
        `Pack residue remediation: ${enforcement.remediations
          .map((r) => r.file)
          .join(", ")}`
      );
    }
    if (!enforcement.ok) {
      const residueMsg = `Pack claim assertion FAIL: forbidden residues ${enforcement.stillDirty
        .map((d) => `${d.file}[${d.violations.join(",")}]`)
        .join("; ")} after final rewrite/delete`;
      packClaimsOk = false;
      packRejectReasons.push(residueMsg);
      warn("Pack", residueMsg);
      verdict = buildAgencyVerdict({
        auditPassed: review.auditPassed,
        goalPassed: review.goalPassed,
        goalFidelityScore: review.goalFidelityScore,
        loop: review.loop,
        maxLoops: MAX_LOOPS,
        packClaimsOk: false,
        rejectReasons: packRejectReasons,
      });
      auditPassed = verdict.auditPassed;
      goalPassed = verdict.goalPassed;
      persistVerdict(verdict);
      // Refresh final-report with CLOSED verdict + deterministic findings
      finalReport = writeComposedFinalReport(
        packArtifactExists("final-report.md")
          ? readPackOrEmpty("final-report.md")
          : undefined
      );
      warn("Gate", verdictConsoleLine(verdict));
    } else if (packArtifactExists("final-report.md")) {
      finalReport = readPackOrEmpty("final-report.md");
    }
  }

  // Fidelity: final-report must cover structured findings
  if (packArtifactExists("final-report.md")) {
    const fr = readPackOrEmpty("final-report.md");
    const coverageRubric = scoreGroundedAuditRubric({
      strategy: review.strategy || "",
      evidenceMarkdown: evidence.summaryMarkdown,
      specsReadCount: evidence.spec?.filesRead?.length || 0,
      reqRows: finalReportEvidence.reqRows,
      findings: (evidence.checklist?.findings || []).map((f) => ({
        id: f.id,
        severity: f.severity,
        summary: f.summary,
        category: f.category,
      })),
      cwd: packWriteRoot,
      finalReport: fr,
      groundedCurrency,
    });
    const cov = coverageRubric.items.find((i) => i.id === "findings_coverage");
    if (cov?.applicable && !cov.passed) {
      // Re-inject deterministic sections — model must not be able to drop them
      finalReport = writeComposedFinalReport(fr);
      sys("Final report: reinjected deterministic Key Findings for fidelity coverage");
    }
  }

  // Placeholder scrub only — currency/path residues already remediated above.
  // Scrub must NOT be the sole gate for wrong-currency tokens.
  {
    const { scrubbed, stillDirty } = scrubPackFiles(
      packWriteRoot,
      undefined,
      groundedCurrency
    );
    if (scrubbed.length) {
      sys(`Pack scrub: cleaned ${scrubbed.join(", ")}`);
    }
    if (stillDirty.length) {
      const residueMsg = `Pack claim assertion FAIL: forbidden residues ${stillDirty
        .map((d) => `${d.file}[${d.violations.join(",")}]`)
        .join("; ")} remain after scrub`;
      packClaimsOk = false;
      packRejectReasons.push(residueMsg);
      warn("Pack", residueMsg);
      verdict = buildAgencyVerdict({
        auditPassed: review.auditPassed,
        goalPassed: review.goalPassed,
        goalFidelityScore: review.goalFidelityScore,
        loop: review.loop,
        maxLoops: MAX_LOOPS,
        packClaimsOk: false,
        rejectReasons: packRejectReasons,
      });
      auditPassed = verdict.auditPassed;
      goalPassed = verdict.goalPassed;
      persistVerdict(verdict);
      finalReport = writeComposedFinalReport(
        packArtifactExists("final-report.md")
          ? readPackOrEmpty("final-report.md")
          : undefined
      );
      warn("Gate", verdictConsoleLine(verdict));
    } else if (packArtifactExists("final-report.md")) {
      finalReport = readPackOrEmpty("final-report.md");
    }
  }

  let packDir: string | undefined;
  let reviewNo: number | undefined;
  try {
    const { dir, reviewNo: n } = resolveNextSamHarnessReviewDir(engagement.docsRoot);
    packDir = dir;
    reviewNo = n;
    // Refresh board with packDir once known
    if (auditPassed) {
      syncDeliveryBoardFromBacklog({
        engagementId: engagement.id,
        targetRepo: engagement.targetRepo,
        packDir: dir,
      });
    }

    // Archive from SAM_OUTPUT_HOME pack workspace — never rely on cwd copies
    copyPackArtifactsTo(dir, PACK_ARTIFACT_NAMES, packRunId);
    // Ensure gates.json exists in pack even if empty snapshot was never refreshed
    const packGates = path.join(dir, "gates.json");
    if (!fs.existsSync(packGates) && packArtifactExists("gates.json")) {
      fs.copyFileSync(packArtifactPath("gates.json"), packGates);
    } else if (!fs.existsSync(packGates)) {
      fs.writeFileSync(
        packGates,
        JSON.stringify(
          {
            runId: packRunId,
            gates: [],
            latest: {
              gate: verdict.gate,
              auditPassed: verdict.auditPassed,
              goalPassed: verdict.goalPassed,
              reason: verdict.reason,
              at: new Date().toISOString(),
            },
            modelErrors: [],
          },
          null,
          2
        ),
        "utf-8"
      );
    }
    if (packArtifactExists("agency-verdict.md")) {
      fs.copyFileSync(
        packArtifactPath("agency-verdict.md"),
        path.join(dir, "agency-verdict.md")
      );
    }
    const loopArchive = path.join(dir, "review-loop");
    fs.mkdirSync(loopArchive, { recursive: true });
    if (fs.existsSync(loopDir)) {
      for (const name of fs.readdirSync(loopDir)) {
        fs.copyFileSync(path.join(loopDir, name), path.join(loopArchive, name));
      }
    }
    const handoff = scrubPackMarkdown(
      [
        `# Pack — Sam-Harness no.${n}`,
        ``,
        `engine: LangGraph agency`,
        verdictMarkdown(verdict),
        `evidence_hits: ${evidence.hits.length}`,
        readStats
          ? `read_stats: specs=${readStats.specFilesRead} (${readStats.specBytes} bytes); sources=${readStats.sourceFilesRead} (${readStats.sourceBytes} bytes)`
          : "",
      ]
        .filter(Boolean)
        .join("\n") + "\n"
    ).text;
    fs.writeFileSync(path.join(dir, "PACK_HANDOFF.md"), handoff, "utf-8");
    writePack(
      "pack-location.md",
      `# Latest pack\n\nSam-Harness no.${n}\n\n\`${dir}\`\n`
    );
    // Defensive: never leave pack files in the Sam-Harness repo root
    const stray = assertNoPackFilesInCwd(process.cwd());
    if (!stray.ok) {
      for (const name of stray.found) {
        try {
          fs.unlinkSync(path.join(process.cwd(), name));
        } catch {
          /* ignore */
        }
      }
      warn(
        "Pack",
        `Removed stray cwd pack files: ${stray.found.join(", ")} (output home only)`
      );
    }
    ok("Pack", `Archived → Sam-Harness no.${n}`);
  } catch (e) {
    warn("Pack", String(e));
  }

  return {
    engagement,
    auditPassed: verdict.auditPassed,
    goalPassed: verdict.goalPassed,
    goalFidelityScore: verdict.goalFidelityScore,
    verdict: {
      auditPassed: verdict.auditPassed,
      goalPassed: verdict.goalPassed,
      gate: verdict.gate,
      reason: verdict.reason,
      packClaimsOk: verdict.packClaimsOk,
    },
    revisionCount: review.loop,
    strategyPlan: strategyScrub.text || review.strategy,
    auditReport: review.auditReport,
    layeredBlueprint,
    helpSystemSpec,
    marketingCampaign,
    finalReport,
    evidenceSummary: evidence.summaryMarkdown,
    packDir,
    reviewNo,
  };
}
