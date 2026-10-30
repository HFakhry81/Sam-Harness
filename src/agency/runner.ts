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
import { scanRepoEvidence, scanRepoEvidenceAsync } from "./evidence.js";
import { MAX_LOOPS, runReviewGraph } from "./reviewGraph.js";
import { syncDeliveryBoardFromBacklog } from "./delivery/sync.js";
import { writeGoNoGoTemplate } from "./delivery/goNoGo.js";
import {
  extractUserGoal,
  goalWantsBookingBlueprint,
  isSamHarnessSelfGoal,
} from "./goalFidelity.js";
import {
  extractGoalPaths,
  primarySpecRoot,
  primaryTargetRepo,
} from "./pathExtract.js";
import { chooseNonDegenerateDraft } from "./repetitionGuard.js";
import { learningContextBlock } from "../controlplane/projectMemory.js";
import { withLanguageDirective } from "../lib/i18n/index.js";
import type { AgencyRunResult, Engagement } from "./types.js";

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
  fs.writeFileSync("engagement.json", JSON.stringify(engagement, null, 2), "utf-8");
  ok(
    "Intake",
    `engagement ${engagement.id} → repo=${engagement.targetRepo}` +
      (specRoot ? ` spec=${specRoot}` : "")
  );

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
    fs.writeFileSync("engagement.json", JSON.stringify(engagement, null, 2), "utf-8");
  }
  fs.writeFileSync("evidence-pack.md", evidence.summaryMarkdown, "utf-8");
  fs.writeFileSync("evidence.json", JSON.stringify(evidence.json, null, 2), "utf-8");
  if (evidence.reqMatrix) {
    fs.writeFileSync(
      "REQ_TRACEABILITY.md",
      evidence.reqMatrix.markdown,
      "utf-8"
    );
  }
  ok(
    "Evidence Scout",
    `${evidence.hits.length} hits · REQs=${evidence.spec?.requirements.length || 0} · currency=${evidence.localeCurrency?.currency || "?"} → evidence-pack.md + evidence.json`
  );

  const brief = `${task}\n${loadBriefExtras(task)}`;
  const loopDir = path.join(process.cwd(), "review-loop");
  // Fresh loop dir — avoid stale strategy-v1 from prior runs leaking into the next task
  try {
    fs.rmSync(loopDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  fs.mkdirSync(loopDir, { recursive: true });

  const review = await runReviewGraph({
    brief,
    evidenceMarkdown: evidence.summaryMarkdown,
    loopDir,
    userGoal,
    targetRepo: engagement.targetRepo,
    reqCoverage: evidence.reqMatrix?.coverageRatio ?? 1,
  });

  fs.writeFileSync(
    "audit-history.md",
    [
      `# Audit History (LangGraph, max ${MAX_LOOPS})`,
      `Final: ${review.auditPassed ? "[APPROVED]" : "[REJECTED] — gate CLOSED"}`,
      `goalPassed: ${review.goalPassed}`,
      `goalFidelityScore: ${review.goalFidelityScore.toFixed(3)}`,
      ``,
      ...review.history.map((h, i) => `---\n## Loop ${i + 1}\n\n${h}`),
    ].join("\n"),
    "utf-8"
  );
  fs.writeFileSync(
    path.join(loopDir, "LOOP_SUMMARY.md"),
    [
      `# Review loop summary`,
      `- engine: LangGraph StateGraph`,
      `- loops_run: ${review.loop}`,
      `- max: ${MAX_LOOPS}`,
      `- auditPassed: ${review.auditPassed}`,
      `- goalPassed: ${review.goalPassed}`,
      `- goalFidelityScore: ${review.goalFidelityScore.toFixed(3)}`,
      `- gate: ${review.auditPassed ? "OPEN" : "CLOSED"}`,
      `- evidence_hits: ${evidence.hits.length}`,
    ].join("\n"),
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
      fs.writeFileSync("execution-plan.md", ctx.layeredBlueprint, "utf-8");
      ok("Architect", "execution-plan.md");
      return ctx;
    }
    if (role.id === "help") {
      live(`Help (${labelForRole("help")})`, "Help spec...");
      ctx.helpSystemSpec = await invoke(
        model,
        `In-app help for multi-purpose ops desk + customer (not clinic-only).\nArchitecture:\n${clip(ctx.layeredBlueprint, 7000)}`
      );
      fs.writeFileSync("help-system-spec.md", ctx.helpSystemSpec, "utf-8");
      return ctx;
    }
    if (role.id === "marketer") {
      live(`Marketer (${labelForRole("marketer")})`, "GTM...");
      ctx.marketingCampaign = await invoke(
        model,
        `Honest GTM + short video script. No over-claim.\n${clip(ctx.layeredBlueprint, 5000)}\n${clip(task, 2000)}`
      );
      fs.writeFileSync("marketing-campaign.md", ctx.marketingCampaign, "utf-8");
      return ctx;
    }
    if (role.id === "verifier") {
      live("CEO Verifier", "Verify deliverables...");
      const draft = await invoke(
        ceo,
        `Verify agency pack vs task. Audit gate=APPROVED.
Task: ${clip(task, 2500)}
Strategy: ${clip(review.strategy, 1000)}
Audit: ${clip(review.auditReport, 600)}
Blueprint: ${clip(ctx.layeredBlueprint, 1000)}
Reply [VERIFIED] or [GAPS] + checklist. Be concise — no repeated lines.`
      );
      const picked = chooseNonDegenerateDraft(draft, review.strategy);
      ctx.finalReport = picked.usedFallback
        ? `${draft}\n\n---\n[DEGENERATION_GUARD] Regenerated text was repetitive; kept prior strategy excerpt + flag.\n\n${picked.text.slice(0, 2000)}`
        : picked.text;
      if (!picked.report.ok) {
        warn("Verifier", `final-report degeneration: ${picked.report.reason}`);
        ctx.finalReport += `\n\n[DEGENERATION_FLAG] ${picked.report.reason}\n`;
      }
      fs.writeFileSync("final-report.md", ctx.finalReport, "utf-8");
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
    fs.writeFileSync(outName, text, "utf-8");
    ok(role.title, outName);
    return ctx;
  }

  if (!review.auditPassed) {
    warn("Gate", "Auditor never APPROVED — downstream specialists SKIPPED");
    finalReport = [
      `# Final report — AUDIT GATE FAILED`,
      `[FAILED_AUDIT_GATE]`,
      `loops=${review.loop}/${MAX_LOOPS}`,
      ``,
      clip(review.auditReport, 2500),
    ].join("\n");
    fs.writeFileSync("final-report.md", finalReport, "utf-8");
    fs.writeFileSync(
      "execution-result.md",
      `# Agency Result\n- engine: LangGraph\n- auditPassed: false\n- goalPassed: ${review.goalPassed}\n- goalFidelityScore: ${review.goalFidelityScore.toFixed(3)}\n- gate: CLOSED\n- loops: ${review.loop}\n`,
      "utf-8"
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
      fs.writeFileSync("CODE_VS_PLAN_GAP_MATRIX.md", gapMatrix, "utf-8");
      const backlog = await invoke(
        architect,
        `IMPLEMENTATION_BACKLOG.md P0 then P1 from:\n${clip(gapMatrix, 6000)}\nReal paths under ${engagement.targetRepo}`
      );
      fs.writeFileSync("IMPLEMENTATION_BACKLOG.md", backlog, "utf-8");
      const nextSprint = await invoke(
        strategist,
        `NEXT_SPRINT.md short from:\n${clip(gapMatrix, 2500)}`
      );
      fs.writeFileSync("NEXT_SPRINT.md", nextSprint, "utf-8");
      const ticket = await invoke(
        architect,
        `TICKET_P0_STARTER.md for first P0:\n${clip(backlog, 5000)}`
      );
      fs.writeFileSync("TICKET_P0_STARTER.md", ticket, "utf-8");
      ok("Architect", "gap matrix + backlog saved");

      syncDeliveryBoardFromBacklog({
        engagementId: engagement.id,
        targetRepo: engagement.targetRepo,
      });
      writeGoNoGoTemplate();
    }

    if (!finalReport) {
      finalReport = [
        `# Final report`,
        `Audit gate OPEN. Downstream steps: ${downstream.map((r) => r.id).join(", ")}`,
        ``,
        clip(layeredBlueprint, 2000),
      ].join("\n");
      fs.writeFileSync("final-report.md", finalReport, "utf-8");
    }

    fs.writeFileSync(
      "execution-result.md",
      `# Agency Result\n- engine: LangGraph\n- auditPassed: true\n- goalPassed: ${review.goalPassed}\n- goalFidelityScore: ${review.goalFidelityScore.toFixed(3)}\n- gate: OPEN\n- loops: ${review.loop}\n- downstream: ${downstream.map((r) => r.id).join(",")}\n`,
      "utf-8"
    );
  }

  let packDir: string | undefined;
  let reviewNo: number | undefined;
  try {
    const { dir, reviewNo: n } = resolveNextSamHarnessReviewDir(engagement.docsRoot);
    packDir = dir;
    reviewNo = n;
    // Refresh board with packDir once known
    if (review.auditPassed) {
      syncDeliveryBoardFromBacklog({
        engagementId: engagement.id,
        targetRepo: engagement.targetRepo,
        packDir: dir,
      });
    }

    const packFiles = [
      "engagement.json",
      "evidence-pack.md",
      "ceo-draft.md",
      "audit-report.md",
      "audit-history.md",
      "execution-plan.md",
      "help-system-spec.md",
      "marketing-campaign.md",
      "final-report.md",
      "execution-result.md",
      "CODE_VS_PLAN_GAP_MATRIX.md",
      "IMPLEMENTATION_BACKLOG.md",
      "NEXT_SPRINT.md",
      "TICKET_P0_STARTER.md",
      "delivery-board.json",
      "DELIVERY_BOARD.md",
      "go-nogo.json",
      "go-nogo.example.json",
    ];
    for (const name of packFiles) {
      if (fs.existsSync(name)) fs.copyFileSync(name, path.join(dir, name));
    }
    const loopArchive = path.join(dir, "review-loop");
    fs.mkdirSync(loopArchive, { recursive: true });
    if (fs.existsSync(loopDir)) {
      for (const name of fs.readdirSync(loopDir)) {
        fs.copyFileSync(path.join(loopDir, name), path.join(loopArchive, name));
      }
    }
    fs.writeFileSync(
      path.join(dir, "PACK_HANDOFF.md"),
      `# Pack — Sam-Harness no.${n}\n\nengine: LangGraph agency\nauditPassed: ${review.auditPassed}\ngoalPassed: ${review.goalPassed}\ngoalFidelityScore: ${review.goalFidelityScore.toFixed(3)}\nloops: ${review.loop}/${MAX_LOOPS}\nevidence_hits: ${evidence.hits.length}\n`,
      "utf-8"
    );
    fs.writeFileSync(
      "pack-location.md",
      `# Latest pack\n\nSam-Harness no.${n}\n\n\`${dir}\`\n`,
      "utf-8"
    );
    ok("Pack", `Archived → Sam-Harness no.${n}`);
  } catch (e) {
    warn("Pack", String(e));
  }

  return {
    engagement,
    auditPassed: review.auditPassed,
    goalPassed: review.goalPassed,
    goalFidelityScore: review.goalFidelityScore,
    revisionCount: review.loop,
    strategyPlan: review.strategy,
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
