/**
 * Git branch/commit helpers for Level-3 rollback snapshots.
 * Best-effort: if target is not a git repo, returns null and callers use file backups.
 */
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

export type GitSnapshot = {
  repo: string;
  branch: string;
  baseRef: string;
  headBefore: string;
  commitAfter?: string;
};

function git(
  repo: string,
  args: string[],
  opts?: { allowFail?: boolean }
): string {
  try {
    return execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf-8",
      windowsHide: true,
      timeout: 60_000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (e: any) {
    if (opts?.allowFail) return "";
    const msg = e?.stderr?.toString?.() || e?.message || String(e);
    throw new Error(`git ${args.join(" ")} failed: ${msg}`);
  }
}

export function isGitRepo(repo: string): boolean {
  try {
    const out = git(repo, ["rev-parse", "--is-inside-work-tree"], {
      allowFail: true,
    });
    return out === "true";
  } catch {
    return false;
  }
}

export function currentBranch(repo: string): string {
  return git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
}

export function currentHead(repo: string): string {
  return git(repo, ["rev-parse", "HEAD"]);
}

export function createImplementBranch(
  repo: string,
  branchName: string
): GitSnapshot | null {
  if (!isGitRepo(repo)) return null;
  const baseRef = currentBranch(repo);
  const headBefore = currentHead(repo);
  // If branch exists, check it out; else create
  const exists = git(repo, ["rev-parse", "--verify", branchName], {
    allowFail: true,
  });
  if (exists) {
    git(repo, ["checkout", branchName]);
  } else {
    git(repo, ["checkout", "-b", branchName]);
  }
  return { repo, branch: branchName, baseRef, headBefore };
}

export function commitAll(
  repo: string,
  message: string
): string | null {
  if (!isGitRepo(repo)) return null;
  git(repo, ["add", "-A"], { allowFail: true });
  const status = git(repo, ["status", "--porcelain"], { allowFail: true });
  if (!status.trim()) return currentHead(repo);
  git(repo, ["-c", "user.email=sam-harness@local", "-c", "user.name=Sam-Harness", "commit", "-m", message], {
    allowFail: false,
  });
  return currentHead(repo);
}

export function diffStat(repo: string, baseRef: string): string {
  if (!isGitRepo(repo)) return "";
  return git(repo, ["diff", "--stat", `${baseRef}...HEAD`], { allowFail: true });
}

/**
 * Hard reset to snapshot head and optionally return to base branch.
 */
export function rollbackToSnapshot(snapshot: GitSnapshot): void {
  if (!isGitRepo(snapshot.repo)) {
    throw new Error(`Not a git repo: ${snapshot.repo}`);
  }
  git(snapshot.repo, ["reset", "--hard", snapshot.headBefore]);
  if (snapshot.baseRef) {
    git(snapshot.repo, ["checkout", snapshot.baseRef], { allowFail: true });
  }
}

export function runRepoTests(
  repo: string,
  command: string,
  args: string[] = [],
  timeoutMs = 120_000
): { ok: boolean; stdout: string; stderr: string } {
  try {
    const out = execFileSync(command, args, {
      cwd: repo,
      encoding: "utf-8",
      windowsHide: true,
      timeout: timeoutMs,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stdout: String(out).slice(0, 8000), stderr: "" };
  } catch (e: any) {
    return {
      ok: false,
      stdout: String(e?.stdout || "").slice(0, 4000),
      stderr: String(e?.stderr || e?.message || e).slice(0, 4000),
    };
  }
}

/** Infer a default test command from package.json scripts when plan omits one. */
export function inferTestCommand(
  repo: string
): { command: string; args: string[] } | null {
  const pkgPath = path.join(repo, "package.json");
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
      scripts?: Record<string, string>;
    };
    const scripts = pkg.scripts || {};
    if (scripts.test && !/no test specified/i.test(scripts.test)) {
      return { command: "npm", args: ["test", "--silent"] };
    }
    if (scripts.typecheck) {
      return { command: "npm", args: ["run", "typecheck"] };
    }
  } catch {
    /* ignore */
  }
  return null;
}
