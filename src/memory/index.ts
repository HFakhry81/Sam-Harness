/**
 * Sam-Harness self-learning memory — persistent lessons + skills.
 *
 * Store: SAM_OUTPUT_HOME/memory/{lessons,skills,promoted-rules}.json
 * Dedup: three-band (duplicate / variant / distinct) with configurable thresholds.
 * Retrieve: tag + lexical + hit/success weighting, bounded token budget.
 * Promote: recurring expressible lessons → deterministic pre-checks.
 * Policy: <=3B models only for triage/classification/extraction; default deterministic.
 */
export { loadMemoryConfig, type MemoryConfig } from "./config.js";
export {
  normalizeMemoryText,
  fingerprintText,
  tokenizeNormalized,
} from "./normalize.js";
export {
  memorySimilarity,
  tokenJaccard,
  shingleJaccard,
  shingles,
} from "./similarity.js";
export {
  classifySimilarity,
  findBestMatch,
  upsertMemoryEntry,
  bumpEntry,
  type UpsertInput,
} from "./dedup.js";
export {
  getMemoryDir,
  memoryFilePath,
  loadMemoryFile,
  saveMemoryFile,
  listAllEntries,
  findEntryById,
  removeEntry,
  pruneMemory,
  LESSONS_FILE,
  SKILLS_FILE,
  RULES_FILE,
} from "./store.js";
export { retrieveMemory, scoreEntry } from "./retrieve.js";
export {
  ingestAuditorRejection,
  ingestGateFailure,
  ingestApprovedSkills,
  ingestRejectReasons,
  extractSkillCandidates,
  type GateFailureKind,
  type IngestLessonInput,
} from "./ingest.js";
export {
  loadPromotedRules,
  savePromotedRules,
  promoteEligibleLessons,
  forcePromoteLesson,
  extractForbiddenPattern,
  isPromotableLesson,
} from "./promote.js";
export {
  runPromotedPrechecks,
  type PrecheckIssue,
  type PrecheckResult,
} from "./precheck.js";
export {
  MEMORY_BLOCK_START,
  MEMORY_BLOCK_END,
  formatMemoryPromptBlock,
  learningMemoryPromptBlock,
} from "./prompt.js";
export {
  isSmallLocalModel,
  allowSmallModelForTask,
  memoryUsesDeterministicDefault,
  SMALL_MODEL_OK_TASKS,
  SMALL_MODEL_FORBIDDEN_TASKS,
} from "./policy.js";
export {
  memoryContextForPrompts,
  learnFromRejection,
  learnFromApproval,
  applyMemoryPrechecks,
  type LearnContext,
} from "./learn.js";
export type {
  MemoryKind,
  MemoryEntry,
  MemoryFile,
  DedupBand,
  DedupDecision,
  UpsertResult,
  RetrieveQuery,
  PromoteRule,
  IngestSource,
} from "./types.js";
export { MEMORY_SCHEMA_VERSION } from "./types.js";
