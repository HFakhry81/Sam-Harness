import * as fs from "fs";
import * as path from "path";
import { live, ok, warn, sys } from "../lib/colors.js";
import {
  defaultProjectDocsRoot,
  resolveNextSamHarnessReviewDir,
} from "../lib/reviewPackDir.js";
import { taskConfig } from "../../task.js";
import {
  makeCeoModel,
  makeSpecialistModel,
  specialistLabel,
  useOllamaCloudNow,
} from "./models.js";

const REJECTION_FORMAT = `
If [REJECTED], then for EACH issue write a block in this exact shape:

### Issue N
- أسباب الرفض / Rejection reason: <clear reason>
- درجة الخطورة / Severity: Critical | High | Medium | Low
- طريقة الحل / How to fix: <concrete actionable steps>

Also list numbered FIX lines for the Strategist:
1. FIX 1: <concrete change>
2. FIX 2: <concrete change>
`.trim();

function clip(text: string, max = 6000): string {
  if (!text) return "";
  return text.length <= max ? text : text.slice(0, max) + "\n...(truncated)";
}

function loadOptionalSpecs(task: string): string {
  const extras: string[] = [];
  const candidates = [
    "docs/project-spec.md",
    "docs/WORKFLOW_REVIEW_LOOP.md",
    "ceo-draft.md",
    "audit-report.md",
    "audit-history.md",
    "execution-plan.md",
    "help-system-spec.md",
    "marketing-campaign.md",
    "final-report.md",
    "CODE_VS_PLAN_GAP_MATRIX.md",
    "IMPLEMENTATION_BACKLOG.md",
    "specs.md",
    "project-spec.md",
    "fanni-spec.md",
    "maw3ed-spec.md",
  ];

  const mentioned =
    task.match(/(?:[A-Za-z]:\\)?(?:[\w .{}()[\]@+-]+[\\/])*[\w .{}()[\]@+-]+\.md/gi) ||
    [];
  for (const raw of mentioned) {
    const m = raw.replace(/^[`'"\s]+|[`'"\s]+$/g, "").trim();
    if (m && fs.existsSync(m)) candidates.unshift(m);
  }

  const seen = new Set<string>();
  for (const file of candidates) {
    const key = file.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (fs.existsSync(file)) {
      extras.push(
        `\n\n### Spec file: ${file}\n${clip(fs.readFileSync(file, "utf-8"), 8000)}`
      );
      sys(`Loaded project spec: ${file}`);
    }
  }
  return extras.join("\n");
}

async function invokeText(
  model: ReturnType<typeof makeCeoModel>,
  prompt: string
): Promise<string> {
  const res = await model.invoke(prompt);
  return String(res.content || "");
}

function extractFixList(report: string): string[] {
  const lines = report.split(/\r?\n/);
  const fixes: string[] = [];
  for (const line of lines) {
    const m = line.match(/^\s*(?:[-*]|\d+[.)]|FIX\s*\d+\s*:)\s*(.+)$/i);
    if (m && m[1].trim().length > 8) fixes.push(m[1].trim());
    const how = line.match(/طريقة الحل\s*\/\s*How to fix:\s*(.+)$/i);
    if (how && how[1].trim().length > 8) fixes.push(how[1].trim());
  }
  if (fixes.length === 0) {
    const after = report.split(/\[REJECTED\]/i)[1] || report;
    for (const chunk of after.split(/[.\n]/)) {
      const t = chunk.trim();
      if (
        t.length > 20 &&
        /missing|must|should|add|define|implement|risk|gap|secur|auth|tenant|bookingtype|status/i.test(
          t
        )
      ) {
        fixes.push(t);
      }
      if (fixes.length >= 12) break;
    }
  }
  return [...new Set(fixes)].slice(0, 14);
}

function parseAuditPassed(report: string): boolean {
  if (/^\s*\[REJECTED\]/m.test(report) || /\n\[REJECTED\]/.test(report)) return false;
  if (/^\s*\[APPROVED\]/m.test(report) || /\n\[APPROVED\]/.test(report)) return true;
  return false;
}

export type Level2Result = {
  strategyPlan: string;
  auditReport: string;
  auditPassed: boolean;
  revisionCount: number;
  layeredBlueprint: string;
  helpSystemSpec: string;
  marketingCampaign: string;
  finalReport: string;
  packDir?: string;
  reviewNo?: number;
};

/**
 * Level 2 Architecture Swarm — critique → remediate → re-audit (max 5).
 * Architect/Help/Marketer run ONLY after Auditor [APPROVED].
 */
export async function runArchitectureSwarm(task: string): Promise<Level2Result> {
  const specContext = loadOptionalSpecs(task);
  const fullBrief = `${task}${specContext}`;

  const ceo = makeCeoModel();
  const strategist = makeSpecialistModel({
    temperature: 0.15,
    numPredict: 1600,
    role: "strategist",
  });
  const auditor = makeSpecialistModel({
    temperature: 0,
    numPredict: 1200,
    role: "auditor",
  });
  const architect = makeSpecialistModel({
    temperature: 0.2,
    numPredict: 1400,
    role: "architect",
  });
  const helpAgent = makeSpecialistModel({
    temperature: 0.3,
    numPredict: 1000,
    role: "help",
  });
  const marketer = makeSpecialistModel({
    temperature: 0.7,
    numPredict: 900,
    role: "marketer",
  });

  sys(
    useOllamaCloudNow()
      ? "Level-2 specialists -> Ollama Cloud"
      : "Level-2 specialists -> local fallback models (set OLLAMA_API_KEY for cloud)"
  );
  sys("Review loop: strategy↔audit up to 5; Architect gate requires [APPROVED]");

  const loopDir = path.join(process.cwd(), "review-loop");
  fs.mkdirSync(loopDir, { recursive: true });

  let strategyPlan = "";
  let auditReport = "";
  let auditPassed = false;
  let revisionCount = 0;
  const maxRevisions = 5;
  const auditHistory: string[] = [];

  function buildRemediationBrief(prevLoop: number, report: string): string {
    const fixes = extractFixList(report);
    const numbered =
      fixes.length > 0
        ? fixes.map((f, i) => `${i + 1}. ${f}`).join("\n")
        : `1. Address every Issue block in the rejection report.\n${clip(report, 2000)}`;

    return `
════════════════════════════════════════
REMEDIATION LOOP v${prevLoop} → produce strategy-v${prevLoop + 1}
════════════════════════════════════════
STATUS: [REJECTED]
You MUST produce a FULL new strategy document that:
1) Keeps everything valid from strategy-v${prevLoop}
2) Merges solutions for EVERY rejection issue (أسباب الرفض / درجة الخطورة / طريقة الحل)
3) Adds section "Merged fixes from rejection-v${prevLoop}" with Fix N: Done — how
4) Defines concrete BookingType enums + status transitions (not "will include later")
5) Defines token/session lifecycle, tenant isolation, QR→session→invoice paths
Do NOT write meta-promises. WRITE the actual content.

MUST-FIX LIST:
${numbered}

FULL REJECTION REPORT:
${clip(report, 3500)}
════════════════════════════════════════
`.trim();
  }

  while (revisionCount < maxRevisions && !auditPassed) {
    revisionCount += 1;
    const loopNo = revisionCount;

    live(
      `Strategist (${specialistLabel("gemma4:cloud", "local-ceo")})`,
      `Review loop v${loopNo}/${maxRevisions} — writing strategy-v${loopNo}...`
    );

    if (loopNo === 1) {
      strategyPlan = await invokeText(
        strategist,
        `You are Enterprise Architect for UpNexa / Maw3ed.
Write a COMPLETE production strategy in English (concrete, not intentions). Max 1400 words.
Maw3ed = MULTI-PURPOSE booking & ops SaaS (NOT clinic-only).

REQUIRED SECTIONS (write real content for each):
## 1. Product truth & BookingType
Define enum APPOINTMENT | RESOURCE_RENTAL | BATCH_SCHEDULE and occupancy_mode mapping with examples.
## 2. Status machines
For each BookingType list states + allowed transitions (service, booking/session, resource, attendance, staff-branch).
## 3. End-to-end lifecycle
service+staff/resources → book → QR/check-in → session/attendance → invoice/settlement
## 4. N-tier sketch
UI / API / Business / Data — bullet each
## 5. Security
tenant isolation, auth/RBAC, token/session lifecycle (issue/expire/revoke), audit log, data protection
## 6. Delivery phases
Handoff for later execution — do NOT claim this swarm already shipped code

Project brief:
${clip(fullBrief, 12000)}`
      );
    } else {
      const brief = buildRemediationBrief(loopNo - 1, auditReport);
      fs.writeFileSync(
        path.join(loopDir, `remediation-brief-v${loopNo - 1}.md`),
        brief,
        "utf-8"
      );
      strategyPlan = await invokeText(
        strategist,
        `You are the REMEDIATION strategist for Sam-Harness review loop v${loopNo}.
Merge the previous plan with ALL rejection fixes into one NEW full strategy.
Output complete Markdown strategy-v${loopNo}, not a patch note alone.

PREVIOUS STRATEGY (strategy-v${loopNo - 1}):
${clip(strategyPlan, 7000)}

${brief}

Also keep alignment with project brief:
${clip(fullBrief, 6000)}`
      );
    }

    fs.writeFileSync(path.join(loopDir, `strategy-v${loopNo}.md`), strategyPlan, "utf-8");
    fs.writeFileSync("ceo-draft.md", strategyPlan, "utf-8");
    fs.writeFileSync(`ceo-draft-attempt-${loopNo}.md`, strategyPlan, "utf-8");
    ok("Strategist", `strategy-v${loopNo}.md saved (loop ${loopNo}/${maxRevisions})`);

    live(
      `Auditor (${specialistLabel("gemma4:cloud", "gemma3:1b")})`,
      `Review loop v${loopNo}/${maxRevisions} — auditing strategy-v${loopNo}...`
    );

    auditReport = await invokeText(
      auditor,
      `You are a strict Enterprise Security & Logic Auditor for Maw3ed/UpNexa (review loop v${loopNo}).

Review strategy-v${loopNo} for real technical content (not vague intentions).
REJECT if: clinic-only framing; missing BookingType definitions; missing concrete status transitions;
missing QR/session/invoice path; missing token/session lifecycle; claims production-complete without evidence;
or says "will include" instead of defining.

APPROVE only if ALL are present with concrete bullets:
- Multi-purpose BookingType APPOINTMENT / RESOURCE_RENTAL / BATCH_SCHEDULE
- Status machines / operational flows per type
- Multi-tenant isolation + auth/RBAC + staff-branch active/suspended
- QR / check-in / session or attendance / invoice path
- Token/session lifecycle (issue, expire, revoke)
- Audit logging + data protection basics
- Clear later-execution handoff steps

Strategy-v${loopNo}:
${clip(strategyPlan, 8000)}

OUTPUT FORMAT (mandatory):
Line 1 must be exactly [APPROVED] or [REJECTED].

${REJECTION_FORMAT}

If [APPROVED], write a short checklist of what passed.`
    );

    auditPassed = parseAuditPassed(auditReport);
    const fixList = extractFixList(auditReport);
    const auditDoc = [
      `# Audit v${loopNo}/${maxRevisions}`,
      ``,
      `Result: ${auditPassed ? "[APPROVED]" : "[REJECTED]"}`,
      `Strategy under review: strategy-v${loopNo}.md`,
      ``,
      `## Extracted fixes`,
      ...(fixList.length
        ? fixList.map((f, i) => `${i + 1}. ${f}`)
        : ["(No structured fixes parsed — see full notes)"]),
      ``,
      `## Full auditor output`,
      auditReport,
      ``,
    ].join("\n");

    fs.writeFileSync(path.join(loopDir, `audit-v${loopNo}.md`), auditDoc, "utf-8");
    fs.writeFileSync(`audit-attempt-${loopNo}.md`, auditDoc, "utf-8");
    fs.writeFileSync("audit-report.md", auditDoc, "utf-8");
    auditHistory.push(auditDoc);

    if (auditPassed) {
      ok("Auditor", `[APPROVED] on review loop v${loopNo} — gate OPEN for Architect`);
    } else {
      const rejectionDoc = [
        `# Rejection v${loopNo}`,
        ``,
        `Returned to Strategist for remediation → strategy-v${loopNo + 1}`,
        ``,
        auditReport,
        ``,
      ].join("\n");
      fs.writeFileSync(path.join(loopDir, `rejection-v${loopNo}.md`), rejectionDoc, "utf-8");
      warn(
        "Auditor",
        `[REJECTED] loop v${loopNo}. rejection-v${loopNo}.md → Strategist merge (not skipped)`
      );
      if (fixList.length) {
        console.log(
          fixList
            .slice(0, 5)
            .map((f, i) => `   FIX ${i + 1}: ${f.slice(0, 120)}`)
            .join("\n")
        );
      }
    }
  }

  fs.writeFileSync(
    "audit-history.md",
    [
      `# Audit History (${auditHistory.length} loops, max ${maxRevisions})`,
      ``,
      `Final status: ${auditPassed ? "[APPROVED]" : "[REJECTED] — gate CLOSED"}`,
      `See also: review-loop/strategy-v*, audit-v*, rejection-v*, remediation-brief-v*`,
      ``,
      ...auditHistory.map((h, i) => `---\n## Loop ${i + 1}\n\n${h}`),
    ].join("\n"),
    "utf-8"
  );
  fs.writeFileSync(
    path.join(loopDir, "LOOP_SUMMARY.md"),
    [
      `# Review loop summary`,
      `- loops_run: ${revisionCount}`,
      `- max: ${maxRevisions}`,
      `- auditPassed: ${auditPassed}`,
      `- gate: ${auditPassed ? "OPEN" : "CLOSED"}`,
    ].join("\n"),
    "utf-8"
  );

  let layeredBlueprint = "";
  let helpSystemSpec = "";
  let marketingCampaign = "";
  let finalReport = "";
  let verified = false;

  if (!auditPassed) {
    warn(
      "Gate",
      `Auditor never APPROVED after ${maxRevisions} loops — STOP. Architect/Help/Marketer skipped.`
    );
    finalReport = [
      `# Final report — AUDIT GATE FAILED`,
      ``,
      `[FAILED_AUDIT_GATE]`,
      ``,
      `The strategy was rejected through review loops 1..${revisionCount}.`,
      `Downstream agents were NOT authorized to treat this as an approved plan.`,
      `See review-loop/rejection-v*.md and audit-history.md.`,
      ``,
      `Last audit excerpt:`,
      clip(auditReport, 2000),
    ].join("\n");
    fs.writeFileSync("final-report.md", finalReport, "utf-8");
    fs.writeFileSync(
      "execution-result.md",
      [
        `# Level-2 Swarm Result`,
        `- revisions: ${revisionCount}`,
        `- auditPassed: false`,
        `- gate: CLOSED`,
        `- downstream: SKIPPED`,
      ].join("\n"),
      "utf-8"
    );
    layeredBlueprint = "(skipped — audit gate closed)";
    helpSystemSpec = "(skipped — audit gate closed)";
    marketingCampaign = "(skipped — audit gate closed)";
  } else {
    live(
      `Architect (${specialistLabel("gemma4:cloud", "qwen2.5:1.5b")})`,
      "Building N-tier blueprint from APPROVED strategy..."
    );
    layeredBlueprint = await invokeText(
      architect,
      `Create a comprehensive production completion / N-tier technical document in Markdown for Maw3ed.
Include: UI, API, Business, Data/DB, status machines for APPOINTMENT / RESOURCE_RENTAL / BATCH_SCHEDULE,
QR→session→invoice lifecycle, security notes, implementation checklist for LATER execution.
Base ONLY on this APPROVED strategy:

${clip(strategyPlan, 8000)}

Original brief:
${clip(fullBrief, 5000)}`
    );
    fs.writeFileSync("execution-plan.md", layeredBlueprint, "utf-8");
    ok("Architect", "Blueprint saved -> execution-plan.md");

    live(
      `Help Agent (${specialistLabel("gemma4:cloud", "qwen2.5:1.5b")})`,
      "Designing in-app help & support specification..."
    );
    helpSystemSpec = await invokeText(
      helpAgent,
      `Design a complete In-App Help & Support module in clear English (Arabic UI labels where useful).
Multi-purpose (not patient-only). FAQ, screen help, empty/error states, escalation.
Architecture:
${clip(layeredBlueprint, 7000)}`
    );
    fs.writeFileSync("help-system-spec.md", helpSystemSpec, "utf-8");
    ok("Help Agent", "Help spec saved -> help-system-spec.md");

    live(
      `Marketer (${specialistLabel("gemma4:cloud", "qwen2.5:1.5b")})`,
      "Drafting GTM campaign and video ad script..."
    );
    marketingCampaign = await invokeText(
      marketer,
      `Write a high-converting promotional campaign and short video ad script in clear English
(optional Arabic slogans). Do not over-claim Stripe/WhatsApp/unfinished verticals.
Architecture:
${clip(layeredBlueprint, 5000)}
Brief:
${clip(task, 2000)}`
    );
    fs.writeFileSync("marketing-campaign.md", marketingCampaign, "utf-8");
    ok("Marketer", "Campaign saved -> marketing-campaign.md");

    live("CEO Verifier", "Checking Level-2 deliverables against original intent...");
    finalReport = await invokeText(
      ceo,
      `You are the CEO verifier for Sam-Harness Level-2.
Audit gate status: APPROVED (required).
Original task:
${clip(task, 3000)}

Deliverables:
- Strategy: ${clip(strategyPlan, 1200)}
- Audit: ${clip(auditReport, 800)}
- Blueprint: ${clip(layeredBlueprint, 1200)}
- Help: ${clip(helpSystemSpec, 800)}
- Marketing: ${clip(marketingCampaign, 800)}

Reply with:
1) [VERIFIED] or [GAPS]
2) Checklist per agent
3) Missing items vs task`
    );
    verified = finalReport.includes("[VERIFIED]");
    fs.writeFileSync("final-report.md", finalReport, "utf-8");
    fs.writeFileSync(
      "execution-result.md",
      [
        `# Level-2 Swarm Result`,
        `- revisions: ${revisionCount}`,
        `- auditPassed: true`,
        `- gate: OPEN`,
        `- ceoVerified: ${verified}`,
      ].join("\n"),
      "utf-8"
    );
    if (verified) ok("CEO Verifier", "Level-2 pack VERIFIED against intent.");
    else warn("CEO Verifier", "Gaps noted — see final-report.md");

    live(
      `Architect (${specialistLabel("gemma4:cloud", "qwen2.5:1.5b")})`,
      "Writing CODE_VS_PLAN_GAP_MATRIX + backlog handoff..."
    );
    const gapMatrix = await invokeText(
      architect,
      `Produce CODE_VS_PLAN_GAP_MATRIX.md for Maw3ed.
Table: Requirement | Evidence in current code (path or "not found") | Gap | Severity (P0/P1/P2) | Ticket hint.
Honest; do not invent files. Paths under E:\\UpNexa.com\\maw3ed when known.

Brief:
${clip(fullBrief, 6000)}
Approved strategy:
${clip(strategyPlan, 3000)}
Blueprint:
${clip(layeredBlueprint, 3000)}`
    );
    fs.writeFileSync("CODE_VS_PLAN_GAP_MATRIX.md", gapMatrix, "utf-8");

    const backlog = await invokeText(
      architect,
      `Produce IMPLEMENTATION_BACKLOG.md (P0 then P1) from this gap matrix:
${clip(gapMatrix, 6000)}
Real Maw3ed paths. Multi-purpose only.`
    );
    fs.writeFileSync("IMPLEMENTATION_BACKLOG.md", backlog, "utf-8");

    const nextSprint = await invokeText(
      strategist,
      `Write NEXT_SPRINT.md (short) from backlog/gaps:
${clip(gapMatrix, 2500)}`
    );
    fs.writeFileSync("NEXT_SPRINT.md", nextSprint, "utf-8");

    const ticket = await invokeText(
      architect,
      `Write TICKET_P0_STARTER.md for the FIRST P0 in:
${clip(backlog, 5000)}`
    );
    fs.writeFileSync("TICKET_P0_STARTER.md", ticket, "utf-8");
    ok("Architect", "Gap matrix + backlog + sprint + P0 ticket saved");
  }

  let archivedPackDir: string | undefined;
  let archivedReviewNo: number | undefined;
  try {
    const docsRoot = defaultProjectDocsRoot(taskConfig.targetRepo);
    const { dir: packDir, reviewNo } = resolveNextSamHarnessReviewDir(docsRoot);
    archivedPackDir = packDir;
    archivedReviewNo = reviewNo;
    const packFiles = [
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
    ];
    for (const name of packFiles) {
      if (!fs.existsSync(name)) continue;
      fs.copyFileSync(name, path.join(packDir, name));
    }
    for (const name of fs.readdirSync(process.cwd())) {
      if (/^(ceo-draft-attempt-|audit-attempt-)/i.test(name) && name.endsWith(".md")) {
        fs.copyFileSync(name, path.join(packDir, name));
      }
    }
    const loopArchive = path.join(packDir, "review-loop");
    fs.mkdirSync(loopArchive, { recursive: true });
    for (const name of fs.readdirSync(loopDir)) {
      fs.copyFileSync(path.join(loopDir, name), path.join(loopArchive, name));
    }
    const handoff = `# Pack handoff — Sam-Harness no.${reviewNo}

Generated: ${new Date().toISOString()}
auditPassed: ${auditPassed}
review_loops: ${revisionCount}/${maxRevisions}
gate: ${auditPassed ? "OPEN" : "CLOSED — downstream skipped"}
Review folder: \`${packDir}\`
Target repo: \`${taskConfig.targetRepo}\`
`;
    fs.writeFileSync(path.join(packDir, "PACK_HANDOFF.md"), handoff, "utf-8");
    fs.writeFileSync(
      "pack-location.md",
      `# Latest pack location\n\nSam-Harness no.${reviewNo}\n\n\`${packDir}\`\n\ngate=${auditPassed ? "OPEN" : "CLOSED"}\n`,
      "utf-8"
    );
    ok(
      "Pack",
      `Archived -> Sam-Harness no.${reviewNo} (${auditPassed ? "SUCCESS pack" : "FAILED_AUDIT pack"})`
    );
  } catch (e) {
    warn("Pack", `Could not archive pack under project docs: ${String(e)}`);
  }

  try {
    fs.appendFileSync(
      "agent-memory.md",
      `\n- [Level2 ${new Date().toISOString()}] Task: "${task.slice(0, 80)}..." revisions=${revisionCount} audit=${auditPassed} verified=${verified}\n`,
      "utf-8"
    );
  } catch {
    /* ignore */
  }

  return {
    strategyPlan,
    auditReport,
    auditPassed,
    revisionCount,
    layeredBlueprint,
    helpSystemSpec,
    marketingCampaign,
    finalReport,
    packDir: archivedPackDir,
    reviewNo: archivedReviewNo,
  };
}
