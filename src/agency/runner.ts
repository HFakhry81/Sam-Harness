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
import { scanRepoEvidence } from "./evidence.js";
import { MAX_LOOPS, runReviewGraph } from "./reviewGraph.js";
import { syncDeliveryBoardFromBacklog } from "./delivery/sync.js";
import { writeGoNoGoTemplate } from "./delivery/goNoGo.js";
import {
  extractUserGoal,
  goalWantsBookingBlueprint,
  isSamHarnessSelfGoal,
} from "./goalFidelity.js";
import { learningContextBlock } from "../controlplane/projectMemory.js";
import type { AgencyRunResult, Engagement } from "./types.js";

function clip(text: string, max = 6000): string {
  if (!text) return "";
  return text.length <= max ? text : text.slice(0, max) + "\n...(truncated)";
}

async function invoke(
  model: ReturnType<typeof makeCeoModel>,
  prompt: string
): Promise<string> {
  const res = await model.invoke(prompt);
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
  let targetRepoAbs = resolveTargetRepoPath(taskConfig.targetRepo);
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
  const engagement: Engagement = {
    id: `eng-${Date.now().toString(36)}`,
    clientName: "UpNexa",
    projectName: path.basename(targetRepoAbs) || "client-project",
    targetRepo: targetRepoAbs,
    docsRoot: defaultProjectDocsRoot(targetRepoAbs),
    goal: taskConfig.title,
    route: "architecture",
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync("engagement.json", JSON.stringify(engagement, null, 2), "utf-8");
  ok("Intake", `engagement ${engagement.id} → ${engagement.targetRepo}`);

  const userGoal = extractUserGoal(task) || userGoalEarly;

  // Evidence scout (local, $0) — goal-aware for Control Plane / memory / UI asks
  live("Evidence Scout", "Scanning target repo for citable paths...");
  const evidence = scanRepoEvidence(engagement.targetRepo, { goal: userGoal });
  fs.writeFileSync("evidence-pack.md", evidence.summaryMarkdown, "utf-8");
  ok("Evidence Scout", `${evidence.hits.length} hits → evidence-pack.md`);

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

  const architect = makeSpecialistModel({
    cloudModel: "gemma4:cloud",
    localModel: "qwen2.5:1.5b",
    temperature: 0.2,
    numPredict: 1400,
    role: "architect",
  });
  const helpAgent = makeSpecialistModel({
    cloudModel: "gemma4:cloud",
    localModel: "qwen2.5:1.5b",
    temperature: 0.3,
    numPredict: 1000,
    role: "help",
  });
  const marketer = makeSpecialistModel({
    cloudModel: "gemma4:cloud",
    localModel: "qwen2.5:1.5b",
    temperature: 0.7,
    numPredict: 900,
    role: "marketer",
  });
  const ceo = makeCeoModel();
  const strategist = makeSpecialistModel({
    cloudModel: "gemma4:cloud",
    localModel: process.env.CEO_MODEL || "qwen2.5-coder:1.5b",
    temperature: 0.15,
    numPredict: 1200,
    role: "strategist",
  });

  if (!review.auditPassed) {
    warn("Gate", "Auditor never APPROVED — Architect/Help/Marketer SKIPPED");
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
    live(
      `Architect (${specialistLabel("gemma4:cloud", "qwen2.5:1.5b")})`,
      "Blueprint from APPROVED strategy + evidence..."
    );
    layeredBlueprint = await invoke(
      architect,
      `N-tier production blueprint for the client project.
Cite evidence paths when claiming existing code; mark gaps honestly.
APPROVED strategy:
${clip(review.strategy, 8000)}
EVIDENCE:
${clip(evidence.summaryMarkdown, 4000)}
BRIEF:
${clip(brief, 4000)}`
    );
    fs.writeFileSync("execution-plan.md", layeredBlueprint, "utf-8");
    ok("Architect", "execution-plan.md");

    live(`Help (${specialistLabel("gemma4:cloud", "qwen2.5:1.5b")})`, "Help spec...");
    helpSystemSpec = await invoke(
      helpAgent,
      `In-app help for multi-purpose ops desk + customer (not clinic-only).\nArchitecture:\n${clip(layeredBlueprint, 7000)}`
    );
    fs.writeFileSync("help-system-spec.md", helpSystemSpec, "utf-8");

    live(`Marketer (${specialistLabel("gemma4:cloud", "qwen2.5:1.5b")})`, "GTM...");
    marketingCampaign = await invoke(
      marketer,
      `Honest GTM + short video script. No over-claim.\n${clip(layeredBlueprint, 5000)}\n${clip(task, 2000)}`
    );
    fs.writeFileSync("marketing-campaign.md", marketingCampaign, "utf-8");

    live("CEO Verifier", "Verify deliverables...");
    finalReport = await invoke(
      ceo,
      `Verify agency pack vs task. Audit gate=APPROVED.
Task: ${clip(task, 2500)}
Strategy: ${clip(review.strategy, 1000)}
Audit: ${clip(review.auditReport, 600)}
Blueprint: ${clip(layeredBlueprint, 1000)}
Reply [VERIFIED] or [GAPS] + checklist.`
    );
    fs.writeFileSync("final-report.md", finalReport, "utf-8");

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
    fs.writeFileSync(
      "execution-result.md",
      `# Agency Result\n- engine: LangGraph\n- auditPassed: true\n- goalPassed: ${review.goalPassed}\n- goalFidelityScore: ${review.goalFidelityScore.toFixed(3)}\n- gate: OPEN\n- loops: ${review.loop}\n`,
      "utf-8"
    );
    ok("Architect", "gap matrix + backlog saved");

    // P3 Delivery OS — living board from backlog
    syncDeliveryBoardFromBacklog({
      engagementId: engagement.id,
      targetRepo: engagement.targetRepo,
    });
    writeGoNoGoTemplate();
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
