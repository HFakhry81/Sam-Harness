import "./src/lib/loadEnv.js";
import * as fs from "fs";
import * as readline from "readline";
import { ChatOllama } from "@langchain/ollama";
import { colors, live, ok, sys, warn } from "./src/lib/colors.js";
import { runOperationalCeoLoop, verifyAgainstTask } from "./src/agent/ceoLoop.js";
import { runArchitectureSwarm } from "./src/agent/level2Swarm.js";
import { runAgencyArchitecture } from "./src/agency/runner.js";
import { resolveImplementAuthorization } from "./src/agency/delivery/goNoGo.js";
import {
  runImplementationCrew,
  shouldRunLevel3,
} from "./src/agent/level3Implement.js";
import { getTaskMarkdown, taskConfig } from "./task.js";
import { useOllamaCloudNow } from "./src/agent/models.js";
import {
  beginOutputRun,
  cleanOutputTemp,
  endOutputRun,
  ensureOutputHome,
  getOutputHome,
  mirrorRunArtifacts,
} from "./src/lib/outputHome.js";
import { beginCostRun, endCostRun } from "./src/lib/costLedger.js";

/** Default ON — LangGraph agency runtime. Set AGENCY_MODE=0 for legacy linear swarm. */
function useAgencyRuntime(): boolean {
  const v = String(process.env.AGENCY_MODE ?? "1").trim();
  return v !== "0" && v.toLowerCase() !== "false";
}

const router = new ChatOllama({
  baseUrl: "http://localhost:11434",
  model: process.env.CEO_MODEL || "qwen2.5-coder:1.5b",
  temperature: 0,
  think: false,
  numPredict: 80,
  numCtx: 2048,
});

type Route = "operational" | "architecture";

function heuristicRoute(task: string): Route | null {
  if (
    /saas|architecture|blueprint|N-tier|database schema|multi-tenant|Fanni|Maw3ed|موعد|فني|مواصفات|توصيف|product spec|help system|marketing campaign|استكمل|implement/i.test(
      task
    )
  ) {
    return "architecture";
  }
  if (
    /create|write|move|copy|open|play|file|Desktop|سطح|انقل|شيل|ملف|شغل|screen\s*shot|screenshot|لقطة/i.test(
      task
    )
  ) {
    return "operational";
  }
  return null;
}

async function classifyTask(task: string): Promise<Route> {
  live("CEO Router", "Classifying task intent...");
  const quick = heuristicRoute(task);
  if (quick) {
    ok("Router", `Fast route -> ${quick}`);
    return quick;
  }

  const prompt = `Classify this user task as ONE word only: operational OR architecture.

operational = file move/copy/edit/open, play media, screenshot, shell/desktop actions on this PC
architecture = design SaaS/products (Fanni, Maw3ed), blueprints, specs, help/marketing packs, multi-layer planning, continue implementation

Task:
${task}

Reply with exactly: operational
or exactly: architecture`;

  const res = await router.invoke(prompt);
  const text = String(res.content || "").toLowerCase();
  if (text.includes("architecture")) return "architecture";
  return "operational";
}

function isCliNoise(a: string): boolean {
  return (
    a === "--" ||
    a === "--yes" ||
    a === "--implement" ||
    a === "--level3" ||
    a === "--implement-only" ||
    a === "--go" ||
    a === "--no-go" ||
    a === "--approve-implement" ||
    a === "--deny-implement" ||
    a.startsWith("--")
  );
}

function loadTask(): string {
  const args = process.argv.slice(2).filter((a) => !isCliNoise(a));
  const rawArgs = process.argv.slice(2);
  const taskFlag = rawArgs.findIndex((a) => a === "--task");
  if (taskFlag >= 0 && rawArgs[taskFlag + 1]) {
    const file = rawArgs[taskFlag + 1];
    if (fs.existsSync(file)) {
      sys(`Loaded task from ${file}`);
      return fs.readFileSync(file, "utf-8").trim();
    }
  }

  const fileArg = args.find((a) => a.endsWith(".md") && fs.existsSync(a));
  if (fileArg) {
    sys(`Loaded task from ${fileArg}`);
    return fs.readFileSync(fileArg, "utf-8").trim();
  }

  // Only treat remaining argv as the task if it looks like real user text (not flags/noise)
  const fromArgv = args.filter((a) => a !== "--task").join(" ").trim();
  if (
    fromArgv &&
    fromArgv.length > 2 &&
    !fromArgv.endsWith(".md") &&
    !fromArgv.endsWith(".ts") &&
    !/^-+$/.test(fromArgv)
  ) {
    return fromArgv;
  }

  // Canonical source: task.ts (also refresh task.md for humans/bat users)
  try {
    const md = getTaskMarkdown();
    fs.writeFileSync("task.md", md + "\n", "utf-8");
    sys(`Loaded canonical task from task.ts (${taskConfig.id})`);
    return md;
  } catch {
    /* fall through */
  }

  if (fs.existsSync("task.md")) {
    sys("Loaded task from task.md");
    return fs.readFileSync("task.md", "utf-8").trim();
  }

  return "Review Maw3ed production plan vs current code; emit fresh report pack under docs/sam-harness (no Maw3ed code edits).";
}

async function pauseIfNeeded() {
  if (process.argv.includes("--yes") || process.env.SKIP_PAUSE === "1") return;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise<void>((resolve) => {
    rl.question(
      `${colors.yellow}[?] Done. Press [Enter] to exit...${colors.reset}`,
      () => {
        rl.close();
        resolve();
      }
    );
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const task = loadTask();
  const implementOnly = argv.includes("--implement-only");

  const layout = ensureOutputHome();
  cleanOutputTemp();
  const runId = beginCostRun(process.env.SAM_HARNESS_RUN_ID);
  const outputRun = beginOutputRun(runId);
  process.env.SAM_OUTPUT_HOME = getOutputHome();
  sys(`Output home → ${layout.home}`);
  sys(`Run dir → ${outputRun.runDir}`);

  if (useOllamaCloudNow()) {
    sys("OLLAMA_API_KEY loaded — Level-2 specialists will use Ollama Cloud");
  } else {
    warn("Models", "OLLAMA_API_KEY missing — Level-2 specialists fall back to local models");
  }

  console.log(
    `\n${colors.magenta}${colors.bright}Sam-Harness — L1 Tools + L2 Architecture + L3 Real Implementer${colors.reset}`
  );
  console.log(`${colors.yellow}[Target Task]${colors.reset} ${task.slice(0, 220)}\n`);

  if (implementOnly) {
    ok("Router", "Route selected -> implement-only (Level 3)");
    const auth = resolveImplementAuthorization(argv);
    if (!auth.allowed) {
      warn("Go/No-Go", auth.reason);
      warn(
        "Level-3",
        "Refused. Authorize with --go or IMPLEMENT_GO=1 or go-nogo.json decision=GO"
      );
    } else {
      const l3 = await runImplementationCrew(task, {
        targetRepo: taskConfig.targetRepo,
      });
      console.log(`\n${colors.cyan}Level-3 target:${colors.reset} ${l3.targetRepo}`);
      console.log(`${colors.cyan}Pack folder:${colors.reset} ${l3.outDir}`);
    }
  } else {
    // Prefer explicit route from task.ts when present (owner-controlled).
    const configured =
      taskConfig.route === "architecture" || taskConfig.route === "operational"
        ? taskConfig.route
        : null;
    const route = configured ?? (await classifyTask(task));
    ok("Router", `Route selected -> ${route}${configured ? " (task.ts)" : ""}`);

    if (route === "architecture") {
      const agency = useAgencyRuntime();
      sys(
        agency
          ? "Runtime → LangGraph Agency (intake→evidence→review→gate→pack)"
          : "Runtime → legacy Level-2 swarm (AGENCY_MODE=0)"
      );

      const result = agency
        ? await runAgencyArchitecture(task)
        : await runArchitectureSwarm(task);

      const goalPassed =
        "goalPassed" in result ? Boolean((result as { goalPassed?: boolean }).goalPassed) : null;
      const goalScore =
        "goalFidelityScore" in result
          ? Number((result as { goalFidelityScore?: number }).goalFidelityScore || 0)
          : null;

      if (!result.auditPassed) {
        warn(
          "Gate",
          `Audit/goal not approved after ${result.revisionCount} loops — downstream previews skipped.` +
            (goalPassed != null
              ? ` goalPassed=${goalPassed} score=${(goalScore ?? 0).toFixed(2)}`
              : "")
        );
        console.log(`\n${colors.yellow}--- Final (FAILED_AUDIT_GATE) ---${colors.reset}`);
        console.log(result.finalReport.slice(0, 500) + "\n...");
        process.exitCode = 1;
      } else {
        if (goalPassed === false) {
          warn("Gate", "auditPassed without goalPassed — treating as failure");
          process.exitCode = 1;
        }
        console.log(`\n${colors.cyan}--- Architectural Summary (preview) ---${colors.reset}`);
        console.log(result.layeredBlueprint.slice(0, 400) + "\n...");
        console.log(`\n${colors.cyan}--- Help Spec (preview) ---${colors.reset}`);
        console.log(result.helpSystemSpec.slice(0, 300) + "\n...");
        console.log(`\n${colors.cyan}--- Marketing (preview) ---${colors.reset}`);
        console.log(result.marketingCampaign.slice(0, 300) + "\n...");
      }

      if ("packDir" in result && result.packDir) {
        const reviewNo =
          "reviewNo" in result && typeof (result as { reviewNo?: unknown }).reviewNo === "number"
            ? (result as { reviewNo: number }).reviewNo
            : "?";
        ok("Pack", `Sam-Harness no.${reviewNo} → ${result.packDir}`);
      }

      if (result.auditPassed && shouldRunLevel3(task, argv)) {
        const auth = resolveImplementAuthorization(argv);
        if (!auth.allowed) {
          warn("Go/No-Go", auth.reason);
          warn(
            "Level-3",
            "Blocked by Delivery OS. Use --go | IMPLEMENT_GO=1 | go-nogo.json after reviewing DELIVERY_BOARD.md"
          );
        } else {
          live("CEO Router", "GO received — starting Level-3 implementation crew...");
          const l3 = await runImplementationCrew(task, {
            targetRepo: taskConfig.targetRepo,
          });
          console.log(`\n${colors.green}[OK] Level-3 handoff landed in:${colors.reset} ${l3.outDir}`);
        }
      } else {
        warn(
          "Level-3",
          "Skipped (report pack only). Review DELIVERY_BOARD.md then authorize with --go when ready."
        );
      }
    } else {
      const report = await runOperationalCeoLoop(task, 8);
      const summary = `${report.summary}\nTools:\n${report.tools
        .map((t) => `${t.tool}: ${t.message}`)
        .join("\n")}`;
      const verdict = await verifyAgainstTask(task, summary);
      fs.appendFileSync(
        "final-report.md",
        `\n\n## Verification\nverified=${verdict.verified}\n${verdict.reason}\n`,
        "utf-8"
      );
      const opsOk = report.success !== false && verdict.verified;
      if (opsOk) ok("Sam-Harness", "Task verified against intent.");
      else {
        warn("Sam-Harness", "Verification failed or uncertain — check final-report.md");
        process.exitCode = 1;
      }
    }
  }

  try {
    mirrorRunArtifacts(process.cwd());
  } catch {
    /* ignore */
  }
  endCostRun();
  endOutputRun();

  console.log(`\n${colors.bright}================================================================${colors.reset}`);
  console.log(
    `${colors.cyan} L2 outputs: ceo-draft / audit / execution-plan / help / marketing / final-report${colors.reset}`
  );
  console.log(
    `${colors.cyan} Packs (self): ${layout.reports} · Run: ${outputRun.runDir}${colors.reset}`
  );
  console.log(
    `${colors.cyan} L3 outputs: <repo>/docs/sam-harness/* + implementation-result.md${colors.reset}`
  );
  console.log(`${colors.bright}================================================================${colors.reset}\n`);

  await pauseIfNeeded();
}

main().catch(async (e) => {
  console.error(`${colors.red}[Error] Fatal:${colors.reset}`, e);
  process.exitCode = 1;
  try {
    mirrorRunArtifacts(process.cwd());
  } catch {
    /* ignore */
  }
  endCostRun();
  endOutputRun();
  await pauseIfNeeded();
});
