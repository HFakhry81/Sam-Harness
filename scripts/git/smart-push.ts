import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const allowedBranch =
  /^(feat|fix|chore|docs|feature|hotfix|refactor|test|ci|build|perf|style|cursor|sync|dependabot)\/.+$/;

type PullRequestTemplateOptions = {
  summary: string;
  testPlan: string;
  release?: boolean;
  localChecksPassed?: boolean;
};

type BranchProtectionSnapshot = {
  strict: boolean;
  checks: string[];
  enforceAdmins: boolean;
  allowForcePushes: boolean;
  allowDeletions: boolean;
};

const requiredChecks = [
  "quality (ubuntu-latest)",
  "quality (windows-latest)",
  "branch-flow",
];

function execute(
  command: string,
  args: string[],
  capture = false
): string {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with code ${result.status}.`);
  }
  return capture ? String(result.stdout || "").trim() : "";
}

function git(...args: string[]): string {
  return execute("git", args, true);
}

function isAncestor(ancestor: string, descendant: string): boolean {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
    cwd: root,
    stdio: "ignore",
  });
  if (result.error) throw result.error;
  return result.status === 0;
}

function fetchOrigin(...refs: string[]): void {
  const args = ["fetch", "--prune", "origin", ...refs];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      execute("git", args);
      return;
    } catch (error) {
      if (attempt === 3) {
        throw new Error(
          `Could not fetch origin after ${attempt} attempts: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
      console.warn(`[smart-push] Fetch failed (attempt ${attempt}/3); retrying in 2 seconds.`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
    }
  }
}

function github(...args: string[]): string {
  return execute("gh", args, true);
}

export function validateBranchProtection(
  branch: string,
  protection: BranchProtectionSnapshot
): void {
  const missingChecks = requiredChecks.filter((check) => !protection.checks.includes(check));
  if (
    !protection.strict ||
    !protection.enforceAdmins ||
    protection.allowForcePushes ||
    protection.allowDeletions ||
    missingChecks.length > 0
  ) {
    throw new Error(
      `Refusing auto-merge: ${branch} protection must require strict ${requiredChecks.join(
        ", "
      )}, enforce rules for admins, and block force-pushes/deletions.`
    );
  }
}

export function hasSharedGitHistory(
  repository: string,
  baseRef: string,
  headRef: string
): boolean {
  const result = spawnSync("git", ["merge-base", baseRef, headRef], {
    cwd: repository,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.error) throw result.error;
  return result.status === 0 && Boolean(String(result.stdout || "").trim());
}

function ensureBranchProtection(branch: "main" | "staging"): void {
  const repository = github("repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner");
  const protection = JSON.parse(
    github(
      "api",
      `repos/${repository}/branches/${branch}/protection`,
      "--jq",
      "{strict: .required_status_checks.strict, checks: (.required_status_checks.contexts // []), enforceAdmins: .enforce_admins.enabled, allowForcePushes: .allow_force_pushes.enabled, allowDeletions: .allow_deletions.enabled}"
    )
  ) as BranchProtectionSnapshot;
  validateBranchProtection(branch, protection);
}

function runPnpm(script: "secrets:check" | "typecheck" | "test"): void {
  if (process.platform === "win32") {
    execute(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `pnpm run ${script}`]);
    return;
  }
  execute("pnpm", ["run", script]);
}

export function fillPullRequestTemplate(
  source: string,
  options: PullRequestTemplateOptions
): string {
  let body = source.replace(/\r\n/g, "\n");
  const summaryPattern = /^## Summary\n\n- *$/m;
  const testPlanPattern = /^## Test plan\n\n- \[ \] *$/m;

  if (!summaryPattern.test(body)) {
    throw new Error("The pull request template is missing its Summary placeholder.");
  }
  if (!testPlanPattern.test(body)) {
    throw new Error("The pull request template is missing its Test plan placeholder.");
  }

  body = body.replace(summaryPattern, `## Summary\n\n- ${options.summary}`);
  const testCheck = options.localChecksPassed ? "[x]" : "[ ]";
  body = body.replace(
    testPlanPattern,
    `## Test plan\n\n- ${testCheck} ${options.testPlan}`
  );

  const branchLine = /^- \[ \] Branch name matches .+$/m;
  if (options.release) {
    body = body.replace(
      branchLine,
      (line) =>
        `${line.replace("[ ]", "[x]")} (release exception: \`staging\` is the required head)`
    );
  } else {
    body = body.replace(branchLine, (line) => line.replace("[ ]", "[x]"));
  }

  const checklist = [
    /^- \[ \] Branched from latest /m,
    /^- \[ \] This PR targets /m,
    /^- \[ \] Title uses Conventional Commits/m,
  ];
  for (const item of checklist) {
    if (!item.test(body)) throw new Error("The pull request template checklist changed unexpectedly.");
    body = body.replace(item, (line) => line.replace("[ ]", "[x]"));
  }

  if (!/^- \[ \] CI green:/m.test(body)) {
    throw new Error("The pull request template is missing its CI checklist item.");
  }
  return body;
}

export function markPullRequestChecksGreen(body: string): string {
  const ciLine = /^- \[[ x]\] CI green:.*$/m;
  if (!ciLine.test(body)) throw new Error("The pull request body has no CI checklist item.");
  let updated = body.replace(ciLine, (line) => line.replace("[ ]", "[x]"));
  updated = updated.replace(
    /^- \[[ x]\] (Required GitHub checks:.*)$/m,
    "- [x] $1"
  );
  return updated;
}

function assertCleanWorktree(): void {
  if (git("status", "--porcelain")) {
    throw new Error("Working tree is not clean. Commit or stash changes before smart push.");
  }
}

function ensureAutoMergeSettings(): void {
  execute("gh", ["repo", "edit", "--enable-auto-merge", "--delete-branch-on-merge"]);
  const enabled = github(
    "api",
    "repos/HFakhry81/Sam-Harness",
    "--jq",
    "[.allow_auto_merge, .delete_branch_on_merge] | @tsv"
  );
  if (enabled !== "true\ttrue") {
    throw new Error("GitHub auto-merge and delete-branch-on-merge settings were not enabled.");
  }
}

function readTemplate(): string {
  const templatePath = path.join(root, ".github", "PULL_REQUEST_TEMPLATE.md");
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Required pull request template is missing: ${templatePath}`);
  }
  return fs.readFileSync(templatePath, "utf8");
}

function createOrFindPullRequest(
  head: string,
  base: string,
  title: string,
  options: PullRequestTemplateOptions
): string {
  const existing = github(
    "pr",
    "list",
    "--head",
    head,
    "--base",
    base,
    "--state",
    "open",
    "--json",
    "number",
    "--jq",
    ".[0].number // empty"
  );
  if (existing) {
    console.log(`[smart-push] Reusing open PR #${existing} (${head} -> ${base}).`);
    return existing;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sam-smart-push-"));
  const bodyPath = path.join(tempDir, "pull-request-body.md");
  try {
    const body = fillPullRequestTemplate(readTemplate(), options);
    fs.writeFileSync(bodyPath, body, "utf8");
    execute("gh", [
      "pr",
      "create",
      "--base",
      base,
      "--head",
      head,
      "--title",
      title,
      "--body-file",
      bodyPath,
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  const created = github(
    "pr",
    "list",
    "--head",
    head,
    "--base",
    base,
    "--state",
    "open",
    "--json",
    "number",
    "--jq",
    ".[0].number // empty"
  );
  if (!created) throw new Error(`Could not find the newly created PR (${head} -> ${base}).`);
  console.log(`[smart-push] Created PR #${created} (${head} -> ${base}).`);
  return created;
}

function updateChecksInPullRequest(number: string): void {
  const currentBody = github("pr", "view", number, "--json", "body", "--jq", ".body");
  const updatedBody = markPullRequestChecksGreen(currentBody);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sam-smart-push-"));
  const bodyPath = path.join(tempDir, "pull-request-body.md");
  try {
    fs.writeFileSync(bodyPath, updatedBody, "utf8");
    execute("gh", ["pr", "edit", number, "--body-file", bodyPath]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function waitForRequiredChecks(number: string): void {
  console.log(`[smart-push] Tracking required GitHub checks for PR #${number}...`);
  execute("gh", ["pr", "checks", number, "--required", "--watch", "--interval", "10"]);
  updateChecksInPullRequest(number);
  console.log(`[smart-push] Required checks passed for PR #${number}.`);
}

function waitForMerge(number: string): boolean {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const details = JSON.parse(
      github(
        "pr",
        "view",
        number,
        "--json",
        "state,mergedAt,mergeStateStatus,reviewDecision"
      )
    ) as {
      state: string;
      mergedAt: string | null;
      mergeStateStatus: string;
      reviewDecision: string;
    };

    if (details.mergedAt) {
      console.log(`[smart-push] PR #${number} merged at ${details.mergedAt}.`);
      return true;
    }
    if (details.state === "CLOSED") {
      throw new Error(`PR #${number} was closed without being merged.`);
    }
    if (attempt === 0 || attempt % 6 === 0) {
      console.log(
        `[smart-push] Auto-merge pending: state=${details.mergeStateStatus}, review=${details.reviewDecision}.`
      );
    }
    if (attempt < 59) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
  }

  console.log(
    `[smart-push] PR #${number} remains open with auto-merge enabled; GitHub is waiting for remaining branch protections.`
  );
  return false;
}

function syncAndDeleteMergedFeatureBranch(branch: string): void {
  if (git("status", "--porcelain")) {
    throw new Error("The worktree changed during checks; refusing to switch branches or delete the feature branch.");
  }
  if (git("branch", "--show-current") !== branch) {
    throw new Error(`Current branch changed during checks; refusing to delete '${branch}'.`);
  }
  fetchOrigin();
  execute("git", ["switch", "staging"]);
  execute("git", ["merge", "--ff-only", "origin/staging"]);
  // Squash merges do not preserve feature commit ancestry in the target branch.
  execute("git", ["branch", "-D", branch]);
}

function syncLocalProtectedBranches(): void {
  if (git("status", "--porcelain")) {
    throw new Error("The worktree changed during release checks; refusing to update local protected branches.");
  }
  fetchOrigin("main", "staging");
  execute("git", ["switch", "main"]);
  execute("git", ["merge", "--ff-only", "origin/main"]);
  execute("git", ["switch", "staging"]);
  execute("git", ["merge", "--ff-only", "origin/staging"]);
}

function createFeaturePullRequest(): void {
  assertCleanWorktree();
  const branch = git("branch", "--show-current");
  if (branch === "main" || branch === "staging" || !allowedBranch.test(branch)) {
    throw new Error(`Refusing smart push from unsupported branch '${branch}'.`);
  }

  fetchOrigin("staging");
  if (!isAncestor("origin/staging", "HEAD")) {
    throw new Error("Feature branch is not based on the latest origin/staging; update it before pushing.");
  }
  ensureBranchProtection("staging");

  console.log("[smart-push] Running local protection checks...");
  runPnpm("secrets:check");
  runPnpm("typecheck");
  runPnpm("test");

  ensureAutoMergeSettings();
  execute("git", ["push", "--set-upstream", "origin", branch]);
  const summary = git("log", "-1", "--format=%s");
  const titlePrefix = branch
    .split("/", 1)[0]
    .replace(/^feature$/, "feat")
    .replace(/^hotfix$/, "fix")
    .replace(/^(cursor|sync|dependabot)$/, "chore");
  const title = `${titlePrefix}: ${branch.slice(branch.indexOf("/") + 1).replace(/[-_]/g, " ")}`;
  const number = createOrFindPullRequest(branch, "staging", title, {
    summary,
    testPlan: "`pnpm run secrets:check`, `pnpm typecheck`, and `pnpm test` passed locally.",
    localChecksPassed: true,
  });

  execute("gh", ["pr", "merge", number, "--auto", "--squash"]);
  waitForRequiredChecks(number);
  if (waitForMerge(number)) syncAndDeleteMergedFeatureBranch(branch);
}

function createReleasePullRequest(): void {
  assertCleanWorktree();
  fetchOrigin("staging", "main");
  ensureBranchProtection("staging");
  ensureBranchProtection("main");
  if (!hasSharedGitHistory(root, "origin/main", "origin/staging")) {
    throw new Error("origin/main and origin/staging have no shared history; refusing to create a release PR.");
  }
  const commits = Number(git("rev-list", "--count", "origin/main..origin/staging"));
  if (commits === 0) {
    console.log("[smart-push] origin/main is already synchronized with origin/staging; no release PR needed.");
    return;
  }

  ensureAutoMergeSettings();
  const number = createOrFindPullRequest("staging", "main", "chore: release staging to main", {
    summary: `Release ${commits} staging commit(s) to main.`,
    testPlan: "Required GitHub checks: `quality (ubuntu-latest)`, `quality (windows-latest)`, and `branch-flow`.",
    release: true,
  });
  execute("gh", ["pr", "merge", number, "--auto", "--merge"]);
  waitForRequiredChecks(number);
  if (waitForMerge(number)) syncLocalProtectedBranches();
}

function main(args: string[]): void {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    console.log(
      "Usage: pnpm run git:smart-push [-- --release]\n" +
        "Feature mode: run local safety checks, open a staging PR, track required checks, and queue auto-merge.\n" +
        "Release mode: open a staging-to-main PR, track required checks, and queue a merge commit."
    );
    return;
  }
  if (args.length > 1 || (args.length === 1 && args[0] !== "--release")) {
    throw new Error("Unknown option. Use --help for usage.");
  }

  if (args[0] === "--release") createReleasePullRequest();
  else createFeaturePullRequest();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`[smart-push] ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
