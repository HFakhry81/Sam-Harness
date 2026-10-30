/**
 * Spec/config-driven Level-3 plan — no product-specific hardcoding.
 * Loaded from packDir/level3-plan.json (or IMPLEMENTATION_PLAN.json).
 */
import * as fs from "fs";
import * as path from "path";

export type Level3FileWrite = {
  path: string;
  content: string;
};

export type Level3FilePatch = {
  path: string;
  find: string;
  replace: string;
};

export type Level3Plan = {
  /** Human title for the change set */
  title?: string;
  /** Branch name prefix (default sam-harness/l3) */
  branchPrefix?: string;
  /** Files to create/overwrite (relative to targetRepo) */
  writes?: Level3FileWrite[];
  /** Exact string replacements */
  patches?: Level3FilePatch[];
  /** Shell/test command to run after applying (cwd = targetRepo). Empty = skip. */
  testCommand?: string;
  testArgs?: string[];
  /** Optional review notes for the journal */
  notes?: string;
};

const PLAN_NAMES = ["level3-plan.json", "IMPLEMENTATION_PLAN.json", "l3-plan.json"];

export function findLevel3PlanPath(packDir: string): string | null {
  for (const name of PLAN_NAMES) {
    const p = path.join(packDir, name);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}

export function loadLevel3Plan(packDir: string): Level3Plan | null {
  const p = findLevel3PlanPath(packDir);
  if (!p) return null;
  const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as Level3Plan;
  return normalizePlan(raw);
}

export function normalizePlan(raw: Level3Plan): Level3Plan {
  return {
    title: raw.title || "Level-3 change set",
    branchPrefix: raw.branchPrefix || "sam-harness/l3",
    writes: Array.isArray(raw.writes) ? raw.writes : [],
    patches: Array.isArray(raw.patches) ? raw.patches : [],
    testCommand: raw.testCommand,
    testArgs: Array.isArray(raw.testArgs) ? raw.testArgs : undefined,
    notes: raw.notes,
  };
}

/** Build a minimal plan from explicit writes (tests / programmatic). */
export function planFromWrites(
  writes: Level3FileWrite[],
  opts?: Partial<Level3Plan>
): Level3Plan {
  return normalizePlan({
    title: opts?.title || "Level-3 writes",
    writes,
    testCommand: opts?.testCommand,
    testArgs: opts?.testArgs,
    notes: opts?.notes,
    branchPrefix: opts?.branchPrefix,
    patches: opts?.patches,
  });
}

export function planHasWork(plan: Level3Plan): boolean {
  return (plan.writes?.length || 0) + (plan.patches?.length || 0) > 0;
}
