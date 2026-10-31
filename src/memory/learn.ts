/**
 * Orchestration helpers for the review loop: retrieve, ingest, promote.
 * All English-only ASCII console logging via caller.
 */
import { promoteEligibleLessons } from "./promote.js";
import {
  ingestApprovedSkills,
  ingestRejectReasons,
} from "./ingest.js";
import { learningMemoryPromptBlock } from "./prompt.js";
import { runPromotedPrechecks, type PrecheckResult } from "./precheck.js";
import type { UpsertResult } from "./types.js";

export type LearnContext = {
  runId?: string;
  taskType?: string;
  targetType?: string;
  goalText?: string;
  home?: string;
};

/** Prompt block for strategist / auditor (may be empty). */
export function memoryContextForPrompts(ctx: LearnContext = {}): string {
  const tags: string[] = [];
  if (ctx.taskType) tags.push(`task:${ctx.taskType}`);
  if (ctx.targetType) tags.push(`target:${ctx.targetType}`);
  return learningMemoryPromptBlock(
    {
      text: ctx.goalText,
      tags: tags.length ? tags : undefined,
    },
    ctx.home
  );
}

/** After a rejection / gate failure: store lessons + maybe promote. */
export function learnFromRejection(
  reasons: string[],
  ctx: LearnContext = {}
): { lessons: UpsertResult[]; promoted: number } {
  const lessons = ingestRejectReasons(reasons, {
    sourceRunId: ctx.runId,
    taskType: ctx.taskType,
    targetType: ctx.targetType,
    home: ctx.home,
  });
  const promoted = promoteEligibleLessons(ctx.home);
  return { lessons, promoted: promoted.length };
}

/** After APPROVED: store successful strategy shapes as skills. */
export function learnFromApproval(
  strategy: string,
  ctx: LearnContext = {}
): UpsertResult[] {
  return ingestApprovedSkills({
    strategy,
    text: "",
    sourceRunId: ctx.runId,
    taskType: ctx.taskType,
    targetType: ctx.targetType,
    home: ctx.home,
  });
}

/** Deterministic pre-checks from promoted rules (before auditor LLM). */
export function applyMemoryPrechecks(
  strategy: string,
  home?: string
): PrecheckResult {
  return runPromotedPrechecks(strategy, home);
}
