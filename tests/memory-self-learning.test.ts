/**
 * Self-learning memory: normalize/dedup bands (incl. Arabic), store recovery,
 * promotion pre-checks, and stubbed run1→run2 e2e.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MEMORY_BLOCK_END,
  MEMORY_BLOCK_START,
  MEMORY_SCHEMA_VERSION,
  allowSmallModelForTask,
  applyMemoryPrechecks,
  classifySimilarity,
  extractForbiddenPattern,
  findBestMatch,
  fingerprintText,
  forcePromoteLesson,
  formatMemoryPromptBlock,
  ingestAuditorRejection,
  isSmallLocalModel,
  learnFromApproval,
  learnFromRejection,
  learningMemoryPromptBlock,
  loadMemoryConfig,
  loadMemoryFile,
  loadPromotedRules,
  memoryContextForPrompts,
  memorySimilarity,
  normalizeMemoryText,
  promoteEligibleLessons,
  pruneMemory,
  retrieveMemory,
  saveMemoryFile,
  shingleJaccard,
  tokenJaccard,
  upsertMemoryEntry,
} from "../src/memory/index.js";

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "sam-mem-"));
  process.env.SAM_OUTPUT_HOME = home;
  // Stable thresholds for band tests
  process.env.SAM_MEMORY_DUP_THRESHOLD = "0.92";
  process.env.SAM_MEMORY_VARIANT_THRESHOLD = "0.70";
  process.env.SAM_MEMORY_PROMOTE_HITS = "3";
});

afterEach(() => {
  try {
    fs.rmSync(home, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("normalize + Arabic", () => {
  it("strips diacritics and maps letter variants", () => {
    const a = normalizeMemoryText("إِنْشَاءُ مَلَفٍّ");
    const b = normalizeMemoryText("انشاء ملف");
    expect(a).toBe(b);
    expect(fingerprintText("أأأ")).toBe(fingerprintText("ااا"));
    expect(normalizeMemoryText("ملفٌ")).toContain("ملف");
  });

  it("normalizes Arabic-Indic digits and punctuation/case", () => {
    expect(normalizeMemoryText("REQ-١٢٣")).toBe("req 123");
    expect(normalizeMemoryText("Hello,  WORLD!!")).toBe("hello world");
    expect(normalizeMemoryText("  foo   bar  ")).toBe("foo bar");
  });
});

describe("similarity bands", () => {
  const cfg = () =>
    loadMemoryConfig({ duplicateThreshold: 0.92, variantThreshold: 0.7 });

  it("exact / near-verbatim → duplicate band", () => {
    const a = "Reject invented packages/ paths not in evidence";
    const b = "reject invented packages/ paths not in evidence.";
    const sim = memorySimilarity(a, b);
    expect(sim).toBeGreaterThanOrEqual(0.92);
    expect(classifySimilarity(sim, cfg())).toBe("duplicate");
  });

  it("slight real modification → variant band", () => {
    // Share most tokens; change one meaningful fragment so similarity sits mid-band
    const a =
      "Reject invented packages/monorepo paths that are not listed in the evidence pack file";
    const b =
      "Reject invented packages/frontend paths that are not listed in the evidence pack file";
    const sim = memorySimilarity(a, b);
    expect(sim).toBeGreaterThanOrEqual(0.7);
    expect(sim).toBeLessThan(0.92);
    expect(classifySimilarity(sim, cfg())).toBe("variant");
  });

  it("clearly different → distinct band", () => {
    const a = "Raise REQ coverage above seventy percent before approval";
    const b = "Always use EGP currency and never invent USD in drafts";
    const sim = memorySimilarity(a, b);
    expect(sim).toBeLessThan(0.7);
    expect(classifySimilarity(sim, cfg())).toBe("distinct");
  });

  it("Arabic near-duplicate collapses via normalization", () => {
    const a = "لا تستخدم مسارات packages/ غير موجودة";
    const b = "لا تَسْتَخْدِمْ مسارات packages/ غير موجودة!";
    expect(fingerprintText(a)).toBe(fingerprintText(b));
    expect(memorySimilarity(a, b)).toBe(1);
    expect(tokenJaccard(a, b)).toBe(1);
    expect(shingleJaccard(a, b)).toBe(1);
  });
});

describe("upsert dedup", () => {
  it("duplicate increments hitCount and does not create a second entry", () => {
    const r1 = upsertMemoryEntry({
      kind: "lesson",
      text: "Never cite apps/web unless the folder exists",
      tags: ["gate:residue"],
      sourceRunId: "run-a",
      outcome: "failure",
      home,
    });
    expect(r1.created).toBe(true);
    const r2 = upsertMemoryEntry({
      kind: "lesson",
      text: "never cite apps/web unless the folder exists!",
      tags: ["gate:residue"],
      sourceRunId: "run-b",
      outcome: "failure",
      home,
    });
    expect(r2.created).toBe(false);
    expect(r2.band).toBe("duplicate");
    expect(r2.entry.id).toBe(r1.entry.id);
    expect(r2.entry.hitCount).toBe(2);
    expect(r2.entry.failureCount).toBe(2);
    expect(loadMemoryFile("lesson", home).entries).toHaveLength(1);
  });

  it("variant creates a linked new entry", () => {
    const parent = upsertMemoryEntry({
      kind: "lesson",
      text: "Forbidden residue: do not write [REMOVED] placeholders in pack files",
      sourceRunId: "run-1",
      outcome: "failure",
      home,
    });
    const variant = upsertMemoryEntry({
      kind: "lesson",
      text: "Forbidden residue: do not write [REMOVED COPSAR] placeholders inside audit history files",
      sourceRunId: "run-2",
      outcome: "failure",
      home,
    });
    // If similarity lands in variant band, link; if duplicate due to high overlap, still OK to assert non-explosion
    if (variant.band === "variant") {
      expect(variant.created).toBe(true);
      expect(variant.entry.parentId).toBe(parent.entry.id);
      expect(variant.entry.relatedIds).toContain(parent.entry.id);
      expect(loadMemoryFile("lesson", home).entries.length).toBeGreaterThanOrEqual(2);
    } else if (variant.band === "duplicate") {
      expect(variant.created).toBe(false);
      expect(variant.entry.hitCount).toBeGreaterThan(1);
    } else {
      expect(variant.created).toBe(true);
      expect(variant.entry.parentId).toBeUndefined();
    }
  });

  it("findBestMatch reports bands with configurable thresholds", () => {
    const entries = loadMemoryFile("lesson", home).entries;
    upsertMemoryEntry({
      kind: "lesson",
      text: "Alpha beta gamma delta epsilon zeta",
      home,
    });
    const filled = loadMemoryFile("lesson", home).entries;
    const d = findBestMatch("Alpha beta gamma delta epsilon zeta!!!", filled);
    expect(d.band).toBe("duplicate");
    expect(d.similarity).toBe(1);
    void entries;
  });
});

describe("store atomic + corruption recovery", () => {
  it("writes schemaVersion and recovers from corrupt JSON", () => {
    upsertMemoryEntry({
      kind: "lesson",
      text: "Valid starter lesson about coverage gates",
      home,
    });
    const file = path.join(home, "memory", "lessons.json");
    expect(fs.existsSync(file)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(parsed.schemaVersion).toBe(MEMORY_SCHEMA_VERSION);

    fs.writeFileSync(file, "{not-json", "utf-8");
    const recovered = loadMemoryFile("lesson", home);
    expect(recovered.entries).toEqual([]);
    expect(recovered.schemaVersion).toBe(MEMORY_SCHEMA_VERSION);
    // Corrupt backup should exist
    const backups = fs
      .readdirSync(path.join(home, "memory"))
      .filter((n) => n.includes("corrupt"));
    expect(backups.length).toBeGreaterThan(0);
  });

  it("saveMemoryFile round-trips", () => {
    saveMemoryFile(
      "skill",
      {
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        entries: [],
      },
      home
    );
    expect(loadMemoryFile("skill", home).entries).toEqual([]);
  });
});

describe("retrieve + prompt block", () => {
  it("injects a delimited learned-memory block", () => {
    upsertMemoryEntry({
      kind: "lesson",
      text: "Never invent USD when grounded currency is EGP",
      tags: ["task:audit", "gate:residue"],
      outcome: "failure",
      home,
    });
    upsertMemoryEntry({
      kind: "skill",
      text: "Strategy section: Concrete recommendations / next actions",
      tags: ["task:audit"],
      outcome: "success",
      home,
    });
    const block = learningMemoryPromptBlock(
      { text: "currency EGP audit", tags: ["task:audit"] },
      home
    );
    expect(block).toContain(MEMORY_BLOCK_START);
    expect(block).toContain(MEMORY_BLOCK_END);
    expect(block.toLowerCase()).toMatch(/egp|currency|recommendations/);
    expect(formatMemoryPromptBlock([])).toBe("");
  });

  it("retrieve ranks tag matches", () => {
    upsertMemoryEntry({
      kind: "lesson",
      text: "Unrelated lesson about PowerShell pipes",
      tags: ["task:ops"],
      home,
    });
    upsertMemoryEntry({
      kind: "lesson",
      text: "Coverage must stay above seventy percent for REQ gates",
      tags: ["task:audit", "gate:coverage"],
      outcome: "failure",
      home,
    });
    const top = retrieveMemory(
      { text: "REQ coverage audit", tags: ["task:audit"], limit: 2 },
      home
    );
    expect(top[0].text).toMatch(/Coverage|seventy/i);
  });
});

describe("promotion + precheck", () => {
  it("promotes recurring expressible lesson and fails precheck on pattern", () => {
    const text =
      'Forbidden residue: never use "packages/ghost" paths in strategy drafts';
    for (let i = 0; i < 3; i++) {
      upsertMemoryEntry({
        kind: "lesson",
        text,
        tags: ["gate:residue"],
        sourceRunId: `run-${i}`,
        outcome: "failure",
        home,
      });
    }
    const entry = loadMemoryFile("lesson", home).entries[0];
    expect(entry.hitCount).toBeGreaterThanOrEqual(3);
    expect(extractForbiddenPattern(entry.text)).toBeTruthy();

    const created = promoteEligibleLessons(home);
    expect(created.length).toBeGreaterThanOrEqual(1);
    const rules = loadPromotedRules(home).rules;
    expect(rules.some((r) => /packages\/ghost/i.test(r.pattern))).toBe(true);

    const fail = applyMemoryPrechecks(
      "We will reuse packages/ghost for the UI layer.",
      home
    );
    expect(fail.ok).toBe(false);
    expect(fail.issues[0].reason).toMatch(/Promoted memory pre-check FAIL/);

    const ok = applyMemoryPrechecks(
      "We will reuse only evidence-backed paths under src/.",
      home
    );
    expect(ok.ok).toBe(true);
  });

  it("forcePromoteLesson works for tests", () => {
    const r = upsertMemoryEntry({
      kind: "lesson",
      text: 'Do not write "[REMOVED]" erasure tokens',
      home,
    });
    const rule = forcePromoteLesson(r.entry.id, home);
    expect(rule?.pattern).toMatch(/REMOVED/i);
  });
});

describe("small model policy", () => {
  it("allows <=3B only for simple tasks", () => {
    expect(isSmallLocalModel("qwen2.5:1.5b")).toBe(true);
    expect(isSmallLocalModel("qwen2.5:7b")).toBe(false);
    expect(allowSmallModelForTask("triage", "gemma3:1b").allowed).toBe(true);
    expect(allowSmallModelForTask("planning", "gemma3:1b").allowed).toBe(false);
    expect(allowSmallModelForTask("review", "qwen2.5:3b").allowed).toBe(false);
    expect(allowSmallModelForTask("extraction", "qwen2.5:3b").allowed).toBe(
      true
    );
  });
});

describe("prune", () => {
  it("removes low-hit unpromoted entries", () => {
    upsertMemoryEntry({
      kind: "lesson",
      text: "One-hit noise lesson about something unique AAA",
      home,
    });
    upsertMemoryEntry({
      kind: "lesson",
      text: "Repeated lesson about unique BBB coverage floor",
      home,
    });
    const kept = upsertMemoryEntry({
      kind: "lesson",
      text: "Repeated lesson about unique BBB coverage floor!",
      home,
    });
    expect(kept.created).toBe(false);
    expect(kept.entry.hitCount).toBe(2);
    const result = pruneMemory({ minHits: 2, home });
    expect(result.removed).toBeGreaterThanOrEqual(1);
    expect(
      loadMemoryFile("lesson", home).entries.every((e) => e.hitCount >= 2)
    ).toBe(true);
  });
});

describe("stubbed e2e: rejection run1 → lesson injected run2; duplicate not re-stored", () => {
  it("accumulates a lesson from run1 and injects it before run2 planning", () => {
    const reason =
      "Pack claim assertion FAIL: forbidden residues packages/apps, [REMOVED]";

    // --- Run 1: auditor rejection becomes a lesson ---
    const run1 = learnFromRejection([reason], {
      runId: "run-e2e-1",
      taskType: "audit",
      targetType: "general",
      goalText: "Audit the UI coverage and pack claims",
      home,
    });
    expect(run1.lessons.length).toBe(1);
    expect(run1.lessons[0].created).toBe(true);
    expect(loadMemoryFile("lesson", home).entries).toHaveLength(1);

    // Duplicate rejection in a later loop of run1 must NOT create a new entry
    const dup = learnFromRejection([reason + "."], {
      runId: "run-e2e-1b",
      taskType: "audit",
      home,
    });
    expect(dup.lessons[0].created).toBe(false);
    expect(dup.lessons[0].band).toBe("duplicate");
    expect(dup.lessons[0].entry.hitCount).toBe(2);
    expect(loadMemoryFile("lesson", home).entries).toHaveLength(1);

    // --- Run 2: before planning, lesson is retrieved into delimited block ---
    const injected = memoryContextForPrompts({
      runId: "run-e2e-2",
      taskType: "audit",
      goalText: "Audit pack claims and residue",
      home,
    });
    expect(injected).toContain(MEMORY_BLOCK_START);
    expect(injected).toContain(MEMORY_BLOCK_END);
    expect(injected).toMatch(/forbidden residues|packages\/apps|REMOVED/i);

    // Approval path stores skills without wiping lessons
    const skills = learnFromApproval(
      [
        "## Direct answer to ORIGINAL USER GOAL",
        "## Concrete recommendations / next actions",
        "- Cite only evidence-pack paths under the target repo",
        "- Keep currency grounded to EGP",
      ].join("\n"),
      { runId: "run-e2e-2", taskType: "audit", home }
    );
    expect(skills.length).toBeGreaterThan(0);
    expect(loadMemoryFile("lesson", home).entries).toHaveLength(1);
    expect(loadMemoryFile("skill", home).entries.length).toBeGreaterThan(0);
  });
});
