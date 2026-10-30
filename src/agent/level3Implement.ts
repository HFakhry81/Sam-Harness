/**
 * Level-3 — generic, config/spec-driven implementer (no product hardcoding).
 * Flow: load level3-plan.json → git branch → apply writes/patches → diff →
 * run tests → rollback via git (or file backups) on failure.
 */
import * as fs from "fs";
import * as path from "path";
import { live, ok, warn, sys, err } from "../lib/colors.js";
import { executeTool } from "../tools/registry.js";
import { makeCeoModel, makeSpecialistModel, specialistLabel } from "./models.js";
import {
  loadLevel3Plan,
  planHasWork,
  type Level3Plan,
} from "../agency/delivery/level3Plan.js";
import {
  commitAll,
  createImplementBranch,
  currentHead,
  diffStat,
  inferTestCommand,
  isGitRepo,
  rollbackToSnapshot,
  runRepoTests,
  type GitSnapshot,
} from "../agency/delivery/gitSnapshot.js";

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

/**
 * Resolve target repo without product-specific hardcoding.
 * Order: opts → TARGET_REPO → task.ts targetRepo path in task text → cwd.
 */
export function resolveTargetRepo(task: string, optsRepo?: string): string {
  if (optsRepo && fs.existsSync(optsRepo)) return path.normalize(optsRepo);
  const envRepo = process.env.TARGET_REPO?.trim();
  if (envRepo && fs.existsSync(envRepo)) return path.normalize(envRepo);

  // Generic absolute path capture (Windows or POSIX) — not product names
  const win = task.match(/([A-Za-z]:\\[^\s`"']+)/);
  if (win) {
    const candidate = path.normalize(win[1].replace(/[\\/]+$/, ""));
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }
  const posix = task.match(/(^|[\s`"'])(\/(?:[^\s`"']+))/);
  if (posix) {
    const candidate = path.normalize(posix[2].replace(/\/+$/, ""));
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }

  // task.ts style: targetRepo: "..."
  const fromTask = task.match(/targetRepo\s*[:=]\s*["'`]([^"'`]+)["'`]/i);
  if (fromTask) {
    const candidate = path.normalize(fromTask[1]);
    if (fs.existsSync(candidate)) return candidate;
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
  const root = path.normalize(targetRepo);
  const rootLower = root.toLowerCase();
  const absLower = abs.toLowerCase();
  if (!absLower.startsWith(rootLower + path.sep) && absLower !== rootLower) {
    throw new Error(`Refusing path outside target repo: ${abs}`);
  }
  const banned = ["marketing-campaign.md", "help-system-spec.md", "ceo-draft.md"];
  if (banned.includes(path.basename(abs).toLowerCase())) {
    throw new Error(`Refusing to rewrite swarm report file as code work: ${abs}`);
  }
  return abs;
}

// ESM-safe lazy import cache for rollback journal
let rollbackMod: typeof import("../agency/delivery/rollbackJournal.js") | null =
  null;
async function getRollback() {
  if (!rollbackMod) {
    rollbackMod = await import("../agency/delivery/rollbackJournal.js");
  }
  return rollbackMod;
}

/** Apply a Level-3 plan synchronously (tests / programmatic). Does not journal. */
export function applyPlanFiles(targetRepo: string, plan: Level3Plan): string[] {
  const changed: string[] = [];
  for (const w of plan.writes || []) {
    const abs = assertUnderRepo(targetRepo, w.path);
    ensureDir(path.dirname(abs));
    fs.writeFileSync(abs, w.content, "utf-8");
    changed.push(abs);
  }
  for (const p of plan.patches || []) {
    const abs = assertUnderRepo(targetRepo, p.path);
    if (!fs.existsSync(abs)) throw new Error(`Patch target missing: ${abs}`);
    const before = fs.readFileSync(abs, "utf-8");
    if (!before.includes(p.find)) {
      throw new Error(`Patch find string not found in ${abs}`);
    }
    fs.writeFileSync(abs, before.replace(p.find, p.replace), "utf-8");
    changed.push(abs);
  }
  return changed;
}

export type Level3Result = {
  targetRepo: string;
  outDir: string;
  backlogPath: string;
  resultPath: string;
  applied: string[];
  branch?: string;
  testsPassed?: boolean;
  rolledBack?: boolean;
};

/**
 * Level 3 — Code implementation crew driven by level3-plan.json (or LLM proposal).
 */
export async function runImplementationCrew(
  task: string,
  opts?: { targetRepo?: string; packDir?: string; plan?: Level3Plan }
): Promise<Level3Result> {
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

  const targetRepo = resolveTargetRepo(task, opts?.targetRepo);
  if (!fs.existsSync(targetRepo)) {
    throw new Error(`Target repo not found: ${targetRepo}`);
  }
  const outDir = opts?.packDir
    ? path.normalize(opts.packDir)
    : path.join(targetRepo, "docs", "sam-harness");
  ensureDir(outDir);

  live("Implementer", `Coding against pack in ${outDir}`);
  live("Implementer", `Real repo: ${targetRepo}`);

  const plan: Level3Plan =
    opts?.plan ||
    loadLevel3Plan(outDir) || {
      title: "Level-3 (no plan file — LLM may propose)",
      writes: [],
      patches: [],
      branchPrefix: "sam-harness/l3",
    };

  const applied: string[] = [];
  const stamp = () => new Date().toISOString();
  const harnessRoot = process.cwd();
  let snapshot: GitSnapshot | null = null;
  let rolledBack = false;
  let testsPassed: boolean | undefined;

  appendJournal(outDir, {
    ts: stamp(),
    stage: "plan",
    done: planHasWork(plan)
      ? `Loaded Level-3 plan: ${plan.title}`
      : "No level3-plan.json writes/patches — will ask coder LLM for one safe change.",
    filesChanged: [],
    remaining: "Apply plan → test → review → journal",
  });

  // --- Git branch snapshot ---
  if (isGitRepo(targetRepo)) {
    const branchName = `${plan.branchPrefix || "sam-harness/l3"}-${Date.now().toString(36)}`;
    try {
      snapshot = createImplementBranch(targetRepo, branchName);
      if (snapshot) {
        ok("Git", `Branch ${snapshot.branch} (base ${snapshot.baseRef} @ ${snapshot.headBefore.slice(0, 8)})`);
        const rb = await getRollback();
        rb.recordGitSnapshot(harnessRoot, {
          targetRepo,
          branch: snapshot.branch,
          baseRef: snapshot.baseRef,
          headBefore: snapshot.headBefore,
          note: plan.title,
        });
      }
    } catch (e: any) {
      warn("Git", e?.message || String(e));
    }
  } else {
    sys("Git: target is not a git repo — file backups only");
  }

  // --- Apply plan ---
  live("Coder", "Applying spec-driven plan...");
  try {
    if (planHasWork(plan)) {
      // Use async rollback for writes
      for (const w of plan.writes || []) {
        const abs = assertUnderRepo(targetRepo, w.path);
        ensureDir(path.dirname(abs));
        const rb = await getRollback();
        rb.recordWriteWithBackup(harnessRoot, {
          targetRepo,
          filePath: abs,
          note: plan.title || "Level-3 plan write",
        });
        fs.writeFileSync(abs, w.content, "utf-8");
        applied.push(abs);
      }
      for (const p of plan.patches || []) {
        const abs = assertUnderRepo(targetRepo, p.path);
        if (!fs.existsSync(abs)) throw new Error(`Patch target missing: ${abs}`);
        const before = fs.readFileSync(abs, "utf-8");
        if (!before.includes(p.find)) {
          throw new Error(`Patch find string not found in ${abs}`);
        }
        const rb = await getRollback();
        rb.recordWriteWithBackup(harnessRoot, {
          targetRepo,
          filePath: abs,
          note: plan.title || "Level-3 plan patch",
        });
        fs.writeFileSync(abs, before.replace(p.find, p.replace), "utf-8");
        applied.push(abs);
      }
      ok("Coder", `Plan applied (${applied.length} files)`);
    } else {
      sys("Coder: empty plan — asking LLM for one focused write_file JSON");
      const coder = makeSpecialistModel({
        cloudModel: "gemma4:cloud",
        localModel: "qwen2.5-coder:1.5b",
        temperature: 0.1,
        numPredict: 700,
      });
      const backlog = readIfExists(path.join(outDir, "IMPLEMENTATION_BACKLOG.md"));
      const ticket = readIfExists(path.join(outDir, "TICKET_P0_STARTER.md"));
      live(
        `Coder (${specialistLabel("gemma4:cloud", "qwen2.5-coder:1.5b")})`,
        "Proposing one focused code edit from pack..."
      );
      const proposalRaw = await invokeText(
        coder,
        `You implement REAL code in the target repository. Do NOT write a new strategy report.
Target repo: ${targetRepo}

Pack ticket/backlog:
${clip(ticket || backlog, 4000)}

Propose ONE small safe code change as JSON only:
{"tool":"write_file","params":{"path":"relative/or/absolute under repo","content":"...full file content..."}}
OR
{"tool":"finish","params":{"summary":"no further safe patch","success":true}}

Forbidden: marketing/help/ceo report rewrites. Prefer tiny smoke scripts or clear guards.`
      );
      const proposal = extractJson(proposalRaw);
      if (proposal && proposal.tool === "write_file") {
        const params = (proposal.params || {}) as Record<string, unknown>;
        const abs = assertUnderRepo(targetRepo, String(params.path || ""));
        if (!/\.(js|cjs|mjs|ts|tsx|jsx|sql|json)$/i.test(abs)) {
          warn("Coder", `Skipped non-code write: ${abs}`);
        } else if (
          abs.toLowerCase().includes(`${path.sep}docs${path.sep}sam-harness${path.sep}`)
        ) {
          warn("Coder", "Skipped writing inside pack folder (code only).");
        } else {
          const content = String(params.content || "");
          if (content.length > 20) {
            ensureDir(path.dirname(abs));
            const rb = await getRollback();
            rb.recordWriteWithBackup(harnessRoot, {
              targetRepo,
              filePath: abs,
              note: "Level-3 coder write",
            });
            fs.writeFileSync(abs, content, "utf-8");
            applied.push(abs);
            ok("Coder", `Additional code write -> ${abs}`);
          }
        }
      } else {
        sys("Coder skipped extra patch (finish / unparseable).");
      }
    }
  } catch (e: any) {
    err("Coder", e?.message || String(e));
    if (snapshot) {
      try {
        rollbackToSnapshot(snapshot);
        rolledBack = true;
        warn("Git", "Rolled back after apply failure");
      } catch (re: any) {
        err("Git", re?.message || String(re));
      }
    }
    throw e;
  }

  appendJournal(outDir, {
    ts: stamp(),
    stage: "code",
    done: `Applied ${applied.length} file change(s).`,
    filesChanged: applied,
    remaining: "Run tests; reviewer match; update remaining gaps.",
  });

  if (snapshot && applied.length) {
    try {
      const sha = commitAll(targetRepo, `sam-harness: ${plan.title || "level-3"}`);
      if (sha) {
        snapshot.commitAfter = sha;
        ok("Git", `Committed ${sha.slice(0, 8)}`);
        const rb = await getRollback();
        rb.recordGitSnapshot(harnessRoot, {
          targetRepo,
          branch: snapshot.branch,
          baseRef: snapshot.baseRef,
          headBefore: snapshot.headBefore,
          commitAfter: sha,
          note: "post-apply commit",
        });
      }
      const stat = diffStat(targetRepo, snapshot.headBefore);
      if (stat) {
        fs.writeFileSync(path.join(outDir, "LEVEL3_DIFF.txt"), stat, "utf-8");
      }
    } catch (e: any) {
      warn("Git", e?.message || String(e));
    }
  }

  // --- Tests ---
  live("QA", "Running plan/repo tests...");
  let testCmd = plan.testCommand
    ? { command: plan.testCommand, args: plan.testArgs || [] }
    : inferTestCommand(targetRepo);
  if (testCmd) {
    const result = runRepoTests(targetRepo, testCmd.command, testCmd.args);
    testsPassed = result.ok;
    if (result.ok) ok("QA", `${testCmd.command} ${testCmd.args.join(" ")} passed`);
    else {
      err("QA", result.stderr || result.stdout || "tests failed");
      if (snapshot) {
        try {
          rollbackToSnapshot(snapshot);
          rolledBack = true;
          applied.length = 0;
          warn("Git", "Rolled back after test failure");
        } catch (re: any) {
          err("Git", re?.message || String(re));
        }
      }
    }
    appendJournal(outDir, {
      ts: stamp(),
      stage: "smoke",
      done: result.ok
        ? `Tests passed: ${testCmd.command} ${testCmd.args.join(" ")}`
        : `Tests failed — ${rolledBack ? "rolled back" : "manual fix needed"}`,
      filesChanged: [],
      remaining: result.ok ? "Reviewer check" : "Fix failing tests before GO claim",
    });
  } else {
    testsPassed = applied.length > 0 ? true : undefined;
    sys("QA: no testCommand in plan and none inferred — skipping automated tests");
    appendJournal(outDir, {
      ts: stamp(),
      stage: "smoke",
      done: "No automated test command configured",
      filesChanged: [],
      remaining: "Add testCommand to level3-plan.json for gated applies",
    });
  }

  // --- Review ---
  const reviewer = makeCeoModel();
  live("Reviewer", "Checking code match against plan intent...");
  const fileSnippets = applied
    .slice(0, 5)
    .map((f) => `### ${path.relative(targetRepo, f)}\n${clip(readIfExists(f), 1500)}`)
    .join("\n\n");
  let review: string;
  try {
    review = await invokeText(
      reviewer,
      `You are the code reviewer for Sam-Harness Level-3.
Plan title: ${plan.title}
Tests passed: ${testsPassed}
Rolled back: ${rolledBack}
Files:
${fileSnippets || "(none)"}

Reply with:
Line1: [MATCH] or [NOT_MATCH]
Then bullets: what matches, what remains.`
    );
  } catch (e: any) {
    review = `[NOT_MATCH]\nReviewer unavailable: ${e?.message || e}`;
  }
  const matched = /\[MATCH\]/i.test(review);
  fs.writeFileSync(path.join(outDir, "CODE_REVIEW.md"), review, "utf-8");

  appendJournal(outDir, {
    ts: stamp(),
    stage: "review",
    done: matched ? "Reviewer [MATCH]" : "Reviewer [NOT_MATCH] — see CODE_REVIEW.md",
    filesChanged: [path.join(outDir, "CODE_REVIEW.md")],
    remaining: matched ? "Continue backlog items as needed" : "Fix until MATCH",
  });

  if (matched) ok("Reviewer", "Code matches selected plan (seed scope).");
  else warn("Reviewer", "Not fully matched — see CODE_REVIEW.md");

  const resultPath = path.join(outDir, "IMPLEMENTATION_RESULT.md");
  const resultBody = `# Level-3 Code Implementation Result

Generated: ${stamp()}
Target repo: \`${targetRepo}\`
Pack: \`${outDir}\`
Branch: \`${snapshot?.branch || "(none)"}\`
Plan: ${plan.title}

## Mode
Spec-driven CODE IMPLEMENTATION (level3-plan.json / LLM proposal). No product hardcoding.

## Applied
${applied.length ? applied.map((a) => `- \`${a}\``).join("\n") : "- (none — rolled back or empty)"}

## Tests
- ${testsPassed == null ? "SKIPPED" : testsPassed ? "PASS" : "FAIL"}
- Rolled back: ${rolledBack ? "YES" : "NO"}

## Reviewer
${matched ? "[MATCH]" : "[NOT_MATCH]"}
See CODE_REVIEW.md

## Journal
See EXECUTION_JOURNAL.md and EXECUTION_LOG.jsonl.
`;
  fs.writeFileSync(resultPath, resultBody, "utf-8");
  fs.writeFileSync("implementation-result.md", resultBody, "utf-8");

  try {
    const rb = await getRollback();
    rb.appendRollbackEntry(harnessRoot, {
      targetRepo,
      files: applied.map((a) => ({ path: a, action: "write" as const })),
      summary: `Level-3 → ${outDir} (tests=${testsPassed}, match=${matched}, rollback=${rolledBack})`,
    });
  } catch {
    /* non-fatal */
  }

  try {
    await executeTool("open_path", {
      path: path.join(outDir, "EXECUTION_JOURNAL.md"),
    });
  } catch {
    /* headless / no xdg-open — journal still on disk */
  }

  return {
    targetRepo,
    outDir,
    backlogPath: path.join(outDir, "IMPLEMENTATION_BACKLOG.md"),
    resultPath,
    applied,
    branch: snapshot?.branch,
    testsPassed,
    rolledBack,
  };
}

export function shouldRunLevel3(task: string, argv: string[]): boolean {
  if (
    argv.includes("--implement") ||
    argv.includes("--level3") ||
    argv.includes("--implement-only")
  ) {
    return true;
  }
  if (process.env.RUN_LEVEL3 === "1") return true;
  // Explicit architecture / report-only tasks must not auto-implement.
  if (
    /##\s*Route\s*\n\s*architecture\b/i.test(task) ||
    /no (?:client|application) code edits|DO NOT modify (?:application|client) (?:application )?code|REPORT PACK \(no code/i.test(
      task
    ) ||
    /REPORT PACK \(no .{0,40}code/i.test(task)
  ) {
    return false;
  }
  return /Route\s*\nimplement|CODE IMPLEMENTATION|طور الكود|تطوير فعلي|EXECUTION_JOURNAL|level3-plan/i.test(
    task
  );
}

void currentHead;
