/**
 * Self-learning memory schema — lessons + skills under SAM_OUTPUT_HOME/memory/.
 */

export const MEMORY_SCHEMA_VERSION = 1;

export type MemoryKind = "lesson" | "skill";

/** Deterministic pre-check rule promoted from a recurring lesson. */
export type PromoteRule = {
  /** Stable rule id (often equals entry id). */
  id: string;
  /** Human-readable ASCII description. */
  description: string;
  /**
   * Forbidden substring / regex source matched against strategy text.
   * Applied case-insensitively as a literal substring unless `regex` is true.
   */
  pattern: string;
  regex?: boolean;
  /** Optional gate tag: residue | traceability | repetition | coverage | other */
  gate?: string;
  createdAt: string;
  fromLessonId: string;
};

export type MemoryEntry = {
  id: string;
  kind: MemoryKind;
  text: string;
  /** Normalized fingerprint used for exact / near-dup matching. */
  fingerprint: string;
  /** Tags: task type, target type, gate kind, etc. */
  tags: string[];
  sourceRunId: string;
  createdAt: string;
  updatedAt: string;
  hitCount: number;
  successCount: number;
  failureCount: number;
  /** Related entry ids (variants, promotions, skills linked to lessons). */
  relatedIds: string[];
  /** Parent entry when this is a middle-band variant. */
  parentId?: string;
  /** True when promoted into a deterministic pre-check. */
  promoted?: boolean;
  promoteRule?: PromoteRule;
};

export type MemoryFile = {
  schemaVersion: number;
  updatedAt: string;
  entries: MemoryEntry[];
};

export type DedupBand = "duplicate" | "variant" | "distinct";

export type DedupDecision = {
  band: DedupBand;
  similarity: number;
  matchId?: string;
};

export type UpsertResult = {
  entry: MemoryEntry;
  created: boolean;
  band: DedupBand;
  similarity: number;
};

export type RetrieveQuery = {
  text?: string;
  tags?: string[];
  kinds?: MemoryKind[];
  /** Soft token budget for the injected prompt block (chars ≈ tokens*4). */
  tokenBudget?: number;
  limit?: number;
};

export type IngestSource =
  | "auditor_rejection"
  | "gate_residue"
  | "gate_traceability"
  | "gate_repetition"
  | "gate_coverage"
  | "gate_other"
  | "approved_skill";
