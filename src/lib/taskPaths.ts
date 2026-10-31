/**
 * Runtime task files live under SAM_OUTPUT_HOME/tasks/ — never the repo cwd.
 * The tracked root task.ts is a seed for typecheck / first boot only.
 */
import * as fs from "fs";
import * as path from "path";
import { ensureOutputHome, getOutputLayout } from "./outputHome.js";

export const TASK_FILE_NAMES = [
  "task.ts",
  "task.md",
  "task.spec.json",
  "task.draft.json",
  "task.pending.md",
  "task-last-failure.md",
  "task.ts.bak",
] as const;

/** Directory for runtime task files (SAM_OUTPUT_HOME/tasks). */
export function getTaskDir(): string {
  const layout = ensureOutputHome();
  fs.mkdirSync(layout.tasks, { recursive: true });
  return layout.tasks;
}

/** Absolute path for a task basename under output home tasks/. */
export function taskFilePath(name: string): string {
  return path.join(getTaskDir(), path.basename(name));
}

/**
 * Resolve where to read a task file from.
 * Prefer output-home tasks/; fall back to repo seed (cwd) for typecheck/bootstrap.
 */
export function resolveTaskReadPath(
  name: string,
  repoRoot: string = process.cwd()
): string | null {
  const base = path.basename(name);
  const primary = path.join(getTaskDir(), base);
  if (fs.existsSync(primary)) return primary;
  const seed = path.join(repoRoot, base);
  if (fs.existsSync(seed)) return seed;
  return null;
}

/** True when absPath is under the Sam-Harness repo root (not output home). */
export function isInsideRepoRoot(
  absPath: string,
  repoRoot: string = process.cwd()
): boolean {
  const root = path.normalize(repoRoot).toLowerCase();
  const target = path.normalize(absPath).toLowerCase();
  const home = path.normalize(getOutputLayout().home).toLowerCase();
  if (target === home || target.startsWith(home + path.sep)) return false;
  return target === root || target.startsWith(root + path.sep);
}
