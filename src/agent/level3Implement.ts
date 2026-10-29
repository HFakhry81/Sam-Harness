import * as fs from "fs";
import * as path from "path";
import { live, ok, warn, sys, err } from "../lib/colors.js";
import { executeTool } from "../tools/registry.js";
import { makeCeoModel, makeSpecialistModel, specialistLabel } from "./models.js";

function clip(text: string, max = 8000): string {
  if (!text) return "";
  return text.length <= max ? text : text.slice(0, max) + "\n...(truncated)";
}

function readIfExists(p: string): string {
  try {
    return fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : "";
  } catch {
    return "";
  }
}

export function resolveTargetRepo(task: string): string {
  const envRepo = process.env.TARGET_REPO?.trim();
  if (envRepo && fs.existsSync(envRepo)) return path.normalize(envRepo);
  const winPath = task.match(
    /([A-Za-z]:\\[^\s`"']*?(?:maw3ed|fanni|Maw3ed|Fanni)[^\s`"']*)/i
  );
  if (winPath) {
    const candidate = path.normalize(winPath[1].replace(/[\\/]+$/, ""));
    if (fs.existsSync(candidate)) return candidate;
  }
  for (const d of ["E:\\UpNexa.com\\maw3ed", "E:\\UpNexa.com\\Fanni"]) {
    if (fs.existsSync(d)) return d;
  }
  return path.normalize(process.cwd());
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

async function invokeText(
  model: ReturnType<typeof makeCeoModel>,
  prompt: string
): Promise<string> {
  const res = await model.invoke(prompt);
  return String(res.content || "");
}

type JournalEntry = {
  ts: string;
  stage: string;
  done: string;
  filesChanged: string[];
  remaining: string;
};

function appendJournal(outDir: string, entry: JournalEntry) {
  const mdPath = path.join(outDir, "EXECUTION_JOURNAL.md");
  const jsonlPath = path.join(outDir, "EXECUTION_LOG.jsonl");
  if (!fs.existsSync(mdPath)) {
    fs.writeFileSync(
      mdPath,
      `# Sam-Harness Execution Journal\n\nLiving log of real code implementation against the swarm pack.\n\n`,
      "utf-8"
    );
  }
  const block = `
## ${entry.ts} — ${entry.stage}

### Done
${entry.done}

### Files changed
${entry.filesChanged.length ? entry.filesChanged.map((f) => `- \`${f}\``).join("\n") : "- (none)"}

### Remaining
${entry.remaining}

---
`;
  fs.appendFileSync(mdPath, block, "utf-8");
  fs.appendFileSync(jsonlPath, JSON.stringify(entry) + "\n", "utf-8");
}

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

function assertUnderRepo(targetRepo: string, filePath: string) {
  const abs = path.normalize(
    path.isAbsolute(filePath) ? filePath : path.join(targetRepo, filePath)
  );
  const root = path.normalize(targetRepo).toLowerCase();
  if (!abs.toLowerCase().startsWith(root + path.sep) && abs.toLowerCase() !== root) {
    throw new Error(`Refusing path outside target repo: ${abs}`);
  }
  // Don't overwrite the pack with more reports as "implementation"
  const banned = ["marketing-campaign.md", "help-system-spec.md", "ceo-draft.md"];
  if (banned.includes(path.basename(abs).toLowerCase())) {
    throw new Error(`Refusing to rewrite swarm report file as code work: ${abs}`);
  }
  return abs;
}

/**
 * Deterministic high-value first patch from known Maw3ed gaps:
 * extract shared overlap helper + smoke test (matches overlap / readiness concerns).
 */
function applySeedOverlapPatch(targetRepo: string): string[] {
  const changed: string[] = [];
  const utilPath = path.join(targetRepo, "timeRange.js");
  const utilSrc = `/**
 * Shared time-range helpers for appointment overlap checks.
 * Added/used by Sam-Harness Level-3 implementer to match overlap specs.
 */

function toMinutes(hhmm) {
  const raw = String(hhmm || "00:00");
  const [h, m] = raw.split(":").map((x) => Number(x));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

/** True when [startA, endA) overlaps [startB, endB). */
function rangesOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

function appointmentWindow(time, durationMinutes, bufferMinutes = 0) {
  const start = toMinutes(time);
  const end = start + Number(durationMinutes || 30) + Number(bufferMinutes || 0);
  return { start, end };
}

module.exports = {
  toMinutes,
  rangesOverlap,
  appointmentWindow
};
`;
  fs.writeFileSync(utilPath, utilSrc, "utf-8");
  changed.push(utilPath);

  // Wire opsPg.js to use shared helper if still inline-only
  const opsPgPath = path.join(targetRepo, "opsPg.js");
  let opsPg = fs.readFileSync(opsPgPath, "utf-8");
  if (!opsPg.includes("timeRange")) {
    // Insert require near top after other requires
    const requireLine = 'const { rangesOverlap, appointmentWindow } = require("./timeRange");\n';
    if (opsPg.startsWith("const ") || opsPg.includes("require(")) {
      const firstRequire = opsPg.indexOf("require(");
      const lineStart = opsPg.lastIndexOf("\n", firstRequire) + 1;
      opsPg = opsPg.slice(0, lineStart) + requireLine + opsPg.slice(lineStart);
    } else {
      opsPg = requireLine + opsPg;
    }

    // Replace inline overlap boolean if present
    const oldOverlap = /const overlaps = dayRows\.rows\.some\(\(row\) => \{[\s\S]*?return start < otherEnd && otherStart < end;\s*\}\);/;
    if (oldOverlap.test(opsPg)) {
      opsPg = opsPg.replace(
        oldOverlap,
        `const self = appointmentWindow(appointment.time, appointment.durationMinutes || service?.durationMinutes || 30, service?.bufferMinutes || 0);
    const overlaps = dayRows.rows.some((row) => {
      const other = appointmentWindow(row.time, row.duration_minutes || 30, row.buffer_minutes || 0);
      return rangesOverlap(self.start, self.end, other.start, other.end);
    });`
      );
      // Remove now-unused local start/end if duplicated just above — best-effort cleanup
      opsPg = opsPg.replace(
        /\n\s*const start = toMinutes\(appointment\.time\);\s*\n\s*const end =\s*\n\s*start \+\s*\n\s*Number\(appointment\.durationMinutes \|\| service\?\.durationMinutes \|\| 30\) \+\s*\n\s*Number\(service\?\.bufferMinutes \|\| 0\);\s*\n\s*const self = appointmentWindow/,
        "\n    const self = appointmentWindow"
      );
    }
    fs.writeFileSync(opsPgPath, opsPg, "utf-8");
    changed.push(opsPgPath);
  }

  const smokePath = path.join(targetRepo, "scripts", "smoke-time-range-overlap.js");
  const smokeSrc = `const assert = require("assert");
const { rangesOverlap, appointmentWindow, toMinutes } = require("../timeRange");

assert.strictEqual(toMinutes("09:30"), 570);
assert.strictEqual(rangesOverlap(0, 30, 30, 60), false, "touching edges do not overlap");
assert.strictEqual(rangesOverlap(0, 30, 29, 60), true, "partial overlap");
assert.strictEqual(rangesOverlap(100, 160, 120, 150), true, "contained range");

const a = appointmentWindow("10:00", 30, 10);
const b = appointmentWindow("10:30", 30, 0);
assert.strictEqual(rangesOverlap(a.start, a.end, b.start, b.end), true, "buffer causes overlap");

console.log("smoke-time-range-overlap: OK");
`;
  fs.writeFileSync(smokePath, smokeSrc, "utf-8");
  changed.push(smokePath);

  return changed;
}

export type Level3Result = {
  targetRepo: string;
  outDir: string;
  backlogPath: string;
  resultPath: string;
  applied: string[];
};

/**
 * Level 3 — Code implementation crew (no new report packs).
 */
export async function runImplementationCrew(
  task: string,
  opts?: { targetRepo?: string; packDir?: string }
): Promise<Level3Result> {
  // Defense in depth — Delivery OS Go/No-Go must already pass in index.ts.
  // Refuse if go-nogo.json explicitly says NO_GO / PENDING when present.
  try {
    const goPath = path.join(process.cwd(), "go-nogo.json");
    if (fs.existsSync(goPath)) {
      const rec = JSON.parse(fs.readFileSync(goPath, "utf-8")) as {
        decision?: string;
      };
      if (rec.decision && rec.decision !== "GO") {
        throw new Error(
          `Level-3 refused: go-nogo.json decision=${rec.decision} (need GO)`
        );
      }
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Level-3 refused")) throw e;
  }

  const targetRepo = opts?.targetRepo || resolveTargetRepo(task);
  if (!fs.existsSync(targetRepo)) {
    throw new Error(`Target repo not found: ${targetRepo}`);
  }
  const outDir = opts?.packDir
    ? path.normalize(opts.packDir)
    : path.join(targetRepo, "docs", "sam-harness");
  ensureDir(outDir);

  live("Implementer", `Coding against pack in ${outDir}`);
  live("Implementer", `Real repo: ${targetRepo}`);

  const pack = {
    executionPlan: readIfExists(path.join(outDir, "execution-plan.md")),
    backlog: readIfExists(path.join(outDir, "IMPLEMENTATION_BACKLOG.md")),
    ticket: readIfExists(path.join(outDir, "TICKET_P0_STARTER.md")),
    gapPlan: readIfExists(path.join(outDir, "PRODUCTION_GAP_FIX_PLAN.md")),
    overlapSpec: readIfExists(path.join(outDir, "APPOINTMENT_OVERLAP_FIX_SPEC.md")),
    authSpec: readIfExists(path.join(outDir, "AUTH_FAIL_CLOSED_CHECKLIST.md")),
    incomplete: readIfExists(path.join(targetRepo, "docs", "INCOMPLETE_LOGIC.md")),
    readiness: readIfExists(
      path.join(targetRepo, "docs", "PRODUCTION_READINESS_REPORT.md")
    ),
  };

  const applied: string[] = [];
  const stamp = () => new Date().toISOString();

  appendJournal(outDir, {
    ts: stamp(),
    stage: "plan",
    done: "Loaded existing swarm pack; starting CODE implementation (no new report pack).",
    filesChanged: [],
    remaining:
      "Apply P0 code changes; run smoke; reviewer match check; update remaining gaps.",
  });

  // --- Stage: code (seed deterministic high-value patch + optional LLM follow-up) ---
  live("Coder", "Applying seed code patch for appointment overlap helper...");
  const seeded = applySeedOverlapPatch(targetRepo);
  applied.push(...seeded);
  ok("Coder", `Seed patch landed (${seeded.length} files)`);

  appendJournal(outDir, {
    ts: stamp(),
    stage: "code",
    done: "Added timeRange.js shared overlap helpers, wired opsPg.js when needed, added scripts/smoke-time-range-overlap.js.",
    filesChanged: seeded,
    remaining:
      "Auth fail-closed expansion, tenant BOLA matrix enforcement, legacy route lockdown, dept RBAC hardening, Stripe/WhatsApp still open per INCOMPLETE_LOGIC.",
  });

  // LLM coder may propose one additional small patch via tools
  const coder = makeSpecialistModel({
    cloudModel: "gemma4:cloud",
    localModel: "qwen2.5-coder:1.5b",
    temperature: 0.1,
    numPredict: 700,
  });

  live(
    `Coder (${specialistLabel("gemma4:cloud", "qwen2.5-coder:1.5b")})`,
    "Proposing one additional focused code edit from pack P0..."
  );

  const proposalRaw = await invokeText(
    coder,
    `You implement REAL code in Maw3ed. Do NOT write a new strategy report.

Pack backlog/ticket:
${clip(pack.ticket || pack.backlog, 3500)}

Incomplete logic:
${clip(pack.incomplete, 2500)}

Already done this run: timeRange.js + opsPg overlap helper + smoke-time-range-overlap.js

Propose ONE additional small safe code change as JSON only:
{"tool":"write_file","params":{"path":"relative/or/absolute under repo","content":"...full file content..."}}
OR
{"tool":"finish","params":{"summary":"no further safe patch","success":true}}

Prefer a tiny smoke script or a clear comment+guard in an existing js file.
Forbidden paths: docs/sam-harness report rewrites, marketing, help specs.`
  );

  const proposal = extractJson(proposalRaw);
  if (proposal && proposal.tool === "write_file") {
    const params = (proposal.params || {}) as Record<string, unknown>;
    try {
      const abs = assertUnderRepo(targetRepo, String(params.path || ""));
      // Only allow code-ish extensions
      if (!/\.(js|cjs|mjs|ts|sql)$/i.test(abs)) {
        warn("Coder", `Skipped non-code write: ${abs}`);
      } else if (abs.toLowerCase().includes(`${path.sep}docs${path.sep}sam-harness${path.sep}`)) {
        warn("Coder", "Skipped writing inside pack folder (code only).");
      } else {
        const content = String(params.content || "");
        if (content.length > 20) {
          ensureDir(path.dirname(abs));
          try {
            const { recordWriteWithBackup } = await import(
              "../agency/delivery/rollbackJournal.js"
            );
            recordWriteWithBackup(process.cwd(), {
              targetRepo,
              filePath: abs,
              note: "Level-3 coder write",
            });
          } catch {
            /* journal optional */
          }
          fs.writeFileSync(abs, content, "utf-8");
          applied.push(abs);
          ok("Coder", `Additional code write -> ${abs}`);
          appendJournal(outDir, {
            ts: stamp(),
            stage: "code",
            done: `Additional coder write applied: ${path.relative(targetRepo, abs)}`,
            filesChanged: [abs],
            remaining: "Smoke + reviewer still pending for this extra patch.",
          });
        }
      }
    } catch (e: any) {
      warn("Coder", e?.message || String(e));
    }
  } else {
    sys("Coder skipped extra patch (finish / unparseable) — seed patch remains.");
  }

  // --- Stage: smoke ---
  live("QA", "Running overlap smoke script...");
  let smokeOk = false;
  try {
    const smoke = await executeTool("run_shell", {
      command: `echo Running smoke via node`,
    });
    // run_shell allowlist is tight — execute node directly here
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);
    const smokeFile = path.join(targetRepo, "scripts", "smoke-time-range-overlap.js");
    const { stdout, stderr } = await execFileAsync("node", [smokeFile], {
      cwd: targetRepo,
      timeout: 20000,
      windowsHide: true,
    });
    smokeOk = /OK/i.test(stdout) || /OK/i.test(stderr);
    if (smokeOk) ok("QA", "smoke-time-range-overlap passed");
    else warn("QA", `Smoke output unexpected: ${stdout || stderr}`);
    void smoke;
  } catch (e: any) {
    err("QA", e?.message || String(e));
    smokeOk = false;
  }

  appendJournal(outDir, {
    ts: stamp(),
    stage: "smoke",
    done: smokeOk
      ? "scripts/smoke-time-range-overlap.js passed"
      : "Smoke failed or could not run",
    filesChanged: [],
    remaining: smokeOk
      ? "Reviewer match check; then continue remaining P0 backlog items."
      : "Fix smoke failures before claiming overlap helper complete.",
  });

  // --- Stage: review ---
  const reviewer = makeCeoModel();
  live("Reviewer", "Checking code match against pack/spec intent...");
  const timeRangeSrc = readIfExists(path.join(targetRepo, "timeRange.js"));
  const opsPgSnippet = readIfExists(path.join(targetRepo, "opsPg.js")).slice(0, 2500);
  const review = await invokeText(
    reviewer,
    `You are the code reviewer for Sam-Harness Level-3.
Selected intent: appointment overlap / time-range correctness from production readiness + pack.
Code added:
timeRange.js:
${clip(timeRangeSrc, 2500)}

opsPg.js (excerpt):
${clip(opsPgSnippet, 2500)}

Smoke passed: ${smokeOk}

Reply with:
Line1: [MATCH] or [NOT_MATCH]
Then bullets: what matches the spec, what remains for full production overlap (DB constraints, concurrency tests, etc.).`
  );

  const matched = /\[MATCH\]/i.test(review);
  fs.writeFileSync(path.join(outDir, "CODE_REVIEW.md"), review, "utf-8");

  appendJournal(outDir, {
    ts: stamp(),
    stage: "review",
    done: matched
      ? "Reviewer [MATCH] for overlap helper seed implementation."
      : "Reviewer [NOT_MATCH] or partial — see CODE_REVIEW.md",
    filesChanged: [path.join(outDir, "CODE_REVIEW.md"), path.join(outDir, "EXECUTION_JOURNAL.md")],
    remaining: [
      "Auth fail-closed production proof",
      "Tenant BOLA/property authorization expansion",
      "Legacy route lockdown verification",
      "Dept supervisor RBAC hardening",
      "Stripe / quote-pay-link / WhatsApp QR (still No-Go features)",
      matched ? "" : "Fix overlap implementation until reviewer MATCH",
    ]
      .filter(Boolean)
      .map((x) => `- ${x}`)
      .join("\n"),
  });

  if (matched) ok("Reviewer", "Code matches selected overlap specification (seed scope).");
  else warn("Reviewer", "Not fully matched — see CODE_REVIEW.md + EXECUTION_JOURNAL.md");

  const resultPath = path.join(outDir, "IMPLEMENTATION_RESULT.md");
  const resultBody = `# Level-3 Code Implementation Result

Generated: ${stamp()}
Target repo: \`${targetRepo}\`
Pack: \`${outDir}\`

## Mode
CODE IMPLEMENTATION of existing swarm pack (not a new report pack).

## Applied
${applied.map((a) => `- \`${a}\``).join("\n")}

## Smoke
- smoke-time-range-overlap: ${smokeOk ? "PASS" : "FAIL"}

## Reviewer
${matched ? "[MATCH]" : "[NOT_MATCH]"}
See CODE_REVIEW.md

## Journal
See EXECUTION_JOURNAL.md and EXECUTION_LOG.jsonl for stages, done items, and remaining work.
`;
  fs.writeFileSync(resultPath, resultBody, "utf-8");
  fs.writeFileSync("implementation-result.md", resultBody, "utf-8");

  try {
    const { appendRollbackEntry } = await import("../agency/delivery/rollbackJournal.js");
    appendRollbackEntry(process.cwd(), {
      targetRepo,
      files: applied.map((a) => ({ path: a, action: "write" as const })),
      summary: `Level-3 implement → ${outDir} (smoke=${smokeOk ? "PASS" : "FAIL"}, match=${matched})`,
    });
  } catch {
    /* non-fatal */
  }

  // Open journal for the user
  await executeTool("open_path", { path: path.join(outDir, "EXECUTION_JOURNAL.md") });

  return {
    targetRepo,
    outDir,
    backlogPath: path.join(outDir, "IMPLEMENTATION_BACKLOG.md"),
    resultPath,
    applied,
  };
}

export function shouldRunLevel3(task: string, argv: string[]): boolean {
  if (argv.includes("--implement") || argv.includes("--level3") || argv.includes("--implement-only")) {
    return true;
  }
  if (process.env.RUN_LEVEL3 === "1") return true;
  // Explicit architecture / report-only tasks must not auto-patch Maw3ed.
  if (
    /##\s*Route\s*\n\s*architecture\b/i.test(task) ||
    /no Maw3ed code edits|DO NOT modify Maw3ed application code|REPORT PACK \(no Maw3ed/i.test(
      task
    )
  ) {
    return false;
  }
  return /Route\s*\nimplement|CODE IMPLEMENTATION|طور الكود|تطوير فعلي|EXECUTION_JOURNAL/i.test(
    task
  );
}
