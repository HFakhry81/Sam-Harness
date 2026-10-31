/**
 * Ingest lessons from auditor/gates and skills from approved strategies.
 * Deterministic — no paid LLM calls.
 */
import { upsertMemoryEntry, type UpsertInput } from "./dedup.js";
import type { IngestSource, UpsertResult } from "./types.js";

export type GateFailureKind =
  | "residue"
  | "traceability"
  | "repetition"
  | "coverage"
  | "other";

function gateSource(kind: GateFailureKind): IngestSource {
  switch (kind) {
    case "residue":
      return "gate_residue";
    case "traceability":
      return "gate_traceability";
    case "repetition":
      return "gate_repetition";
    case "coverage":
      return "gate_coverage";
    default:
      return "gate_other";
  }
}

function classifyGateReason(reason: string): GateFailureKind {
  const r = reason.toLowerCase();
  if (
    /residue|forbidden|currency|\[removed\]|pack claim|invalid path|invented/i.test(
      r
    )
  ) {
    return "residue";
  }
  if (/traceability|citation|cite|missing path/i.test(r)) {
    return "traceability";
  }
  if (/repetition|degenerat|stall|near-identical/i.test(r)) {
    return "repetition";
  }
  if (/coverage|req coverage|too many reqs/i.test(r)) {
    return "coverage";
  }
  return "other";
}

export type IngestLessonInput = {
  text: string;
  sourceRunId?: string;
  tags?: string[];
  taskType?: string;
  targetType?: string;
  home?: string;
};

function baseTags(input: IngestLessonInput, extra: string[]): string[] {
  const tags = [...(input.tags || []), ...extra];
  if (input.taskType) tags.push(`task:${input.taskType}`);
  if (input.targetType) tags.push(`target:${input.targetType}`);
  return [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
}

/** Record an auditor rejection reason as a lesson. */
export function ingestAuditorRejection(
  input: IngestLessonInput
): UpsertResult {
  const tags = baseTags(input, ["source:auditor_rejection", "kind:lesson"]);
  return upsertMemoryEntry({
    kind: "lesson",
    text: input.text,
    tags,
    sourceRunId: input.sourceRunId,
    outcome: "failure",
    home: input.home,
  });
}

/** Record a grounded gate failure as a lesson. */
export function ingestGateFailure(
  input: IngestLessonInput & { gate?: GateFailureKind }
): UpsertResult {
  const gate = input.gate || classifyGateReason(input.text);
  const tags = baseTags(input, [
    `source:${gateSource(gate)}`,
    `gate:${gate}`,
    "kind:lesson",
  ]);
  return upsertMemoryEntry({
    kind: "lesson",
    text: input.text,
    tags,
    sourceRunId: input.sourceRunId,
    outcome: "failure",
    home: input.home,
  });
}

/**
 * Extract compact skill bullets from an approved strategy.
 * Deterministic heuristics — section headings + short actionable lines.
 */
export function extractSkillCandidates(strategy: string, max = 6): string[] {
  const text = String(strategy || "");
  const out: string[] = [];
  const seen = new Set<string>();

  // Prefer markdown ## headings as skill shapes
  for (const m of text.matchAll(/^##\s+(.+)$/gm)) {
    const title = m[1].replace(/#+$/, "").trim();
    if (
      title.length < 8 ||
      title.length > 160 ||
      /requirements traceability|key findings|req status index/i.test(title)
    ) {
      continue;
    }
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(`Strategy section: ${title}`);
    if (out.length >= max) return out;
  }

  // Actionable bullets
  for (const m of text.matchAll(/^\s*[-*]\s+(.{20,180})$/gm)) {
    const line = m[1].trim();
    if (/REQ-|^\|/.test(line)) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= max) break;
  }
  return out;
}

/** Record approved strategy shapes/steps as skills. */
export function ingestApprovedSkills(
  input: IngestLessonInput & { strategy: string }
): UpsertResult[] {
  const candidates = extractSkillCandidates(input.strategy);
  const results: UpsertResult[] = [];
  for (const text of candidates) {
    const tags = baseTags(input, ["source:approved_skill", "kind:skill"]);
    results.push(
      upsertMemoryEntry({
        kind: "skill",
        text,
        tags,
        sourceRunId: input.sourceRunId,
        outcome: "success",
        home: input.home,
      } satisfies UpsertInput)
    );
  }
  return results;
}

/**
 * Batch-ingest reject reasons from a gate / audit loop.
 */
export function ingestRejectReasons(
  reasons: string[],
  meta: {
    sourceRunId?: string;
    taskType?: string;
    targetType?: string;
    home?: string;
  } = {}
): UpsertResult[] {
  const out: UpsertResult[] = [];
  for (const raw of reasons) {
    const text = String(raw || "").trim();
    if (!text || text.length < 8) continue;
    const gate = classifyGateReason(text);
    if (gate === "other" && /reject|auditor|goal fidelity/i.test(text)) {
      out.push(
        ingestAuditorRejection({
          text,
          sourceRunId: meta.sourceRunId,
          taskType: meta.taskType,
          targetType: meta.targetType,
          home: meta.home,
        })
      );
    } else {
      out.push(
        ingestGateFailure({
          text,
          gate,
          sourceRunId: meta.sourceRunId,
          taskType: meta.taskType,
          targetType: meta.targetType,
          home: meta.home,
        })
      );
    }
  }
  return out;
}
