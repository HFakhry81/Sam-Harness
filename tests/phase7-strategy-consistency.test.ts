/**
 * Phase 7: model must not own REQ status/coverage/deps; deterministic
 * consistency pre-check; Spendy-like end-to-end strategy passes checks.
 */
import { describe, it, expect } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";
import { scanRepoEvidence } from "../src/agency/evidence.js";
import {
  buildDeterministicReqStatusIndex,
  clipStrategyForPrompt,
  injectGroundedStrategyBlocks,
  stripModelOwnedClaims,
} from "../src/agency/finalReport.js";
import { isSpecHeadingNotRequirement } from "../src/agency/pathFilters.js";
import { ingestSpecFolder } from "../src/agency/specIngest.js";
import { indexRepo } from "../src/agency/repoIndex.js";
import { buildReqTraceMatrix } from "../src/agency/reqTrace.js";
import {
  detectHallucinatedImplementedStatus,
  detectInvalidClaims,
} from "../src/agency/claimVerify.js";
import {
  repairStrategyDeterministically,
  runStrategyConsistencyChecks,
} from "../src/agency/strategyConsistency.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, "fixtures", "grounded-audit");
const SPENDY_REPO = path.join(FIX, "spendy-repo");
const SPENDY_SPEC = path.join(FIX, "spendy-spec");
const HEADING_SPEC = path.join(FIX, "heading-reqs-spec");
const JUNK_REPO = path.join(FIX, "junk-paths-repo");

describe("document-only section titles are n/a; feature bullets stay eligible", () => {
  it("marks overview/roadmap/guidelines/tech-stack headings as document-only", async () => {
    expect(isSpecHeadingNotRequirement("Project Overview")).toBe(true);
    expect(isSpecHeadingNotRequirement("Introduction")).toBe(true);
    expect(isSpecHeadingNotRequirement("Table of Contents")).toBe(true);
    expect(isSpecHeadingNotRequirement("Glossary")).toBe(true);
    expect(isSpecHeadingNotRequirement("Tech Stack")).toBe(true);
    expect(isSpecHeadingNotRequirement("Functional Requirements Analysis")).toBe(
      true
    );
    expect(isSpecHeadingNotRequirement("Architecture Overview")).toBe(true);
    expect(isSpecHeadingNotRequirement("Database Schema")).toBe(true);
    expect(isSpecHeadingNotRequirement("Implementation Roadmap")).toBe(true);
    expect(isSpecHeadingNotRequirement("Estimated Costs & Infrastructure")).toBe(
      true
    );

    const spec = await ingestSpecFolder(HEADING_SPEC);
    const matrix = buildReqTraceMatrix(
      spec.requirements,
      indexRepo(JUNK_REPO),
      []
    );
    // Bare headings are skipped at extract — remaining rows are feature MUST lines
    expect(
      matrix.rows.every(
        (r) =>
          r.status === "n/a" ||
          /must|should|shall|voice|ocr|egp/i.test(r.text)
      )
    ).toBe(true);
    expect(matrix.eligibleCount).toBeGreaterThanOrEqual(3);
    expect(
      matrix.rows.some((r) => /voice/i.test(r.text) && r.status !== "n/a")
    ).toBe(true);
  });
});

describe("OCR/voice without feature APIs are missing (not partial)", () => {
  it("Spendy OcrScreen/VoiceScreen name-only → missing", () => {
    const pack = scanRepoEvidence(SPENDY_REPO, {
      goal: `examine ${SPENDY_REPO} against ${SPENDY_SPEC}`,
      specRoot: SPENDY_SPEC,
    });
    const rows = pack.reqMatrix!.rows;
    const voice = rows.find((r) => /voice/i.test(r.text));
    const ocr = rows.find((r) => /\bocr\b|receipt/i.test(r.text));
    expect(voice).toBeTruthy();
    expect(ocr).toBeTruthy();
    expect(voice!.status).toBe("missing");
    expect(ocr!.status).toBe("missing");
    expect(voice!.codePaths.length).toBe(0);
    expect(ocr!.codePaths.length).toBe(0);
  });
});

describe("dependency P0s cite package.json in Key Findings", () => {
  it("injects DEP findings with package.json for missing supabase/async-storage", () => {
    const pack = scanRepoEvidence(SPENDY_REPO, {
      goal: `examine ${SPENDY_REPO} against ${SPENDY_SPEC}`,
      specRoot: SPENDY_SPEC,
    });
    const deps = (pack.checklist?.findings || []).filter(
      (f) => f.category === "dependency" || /^DEP-/i.test(f.id)
    );
    expect(deps.length).toBeGreaterThanOrEqual(2);
    expect(
      deps.some((f) => /supabase/i.test(f.summary) || /supabase/i.test(f.id))
    ).toBe(true);
    expect(
      deps.some(
        (f) => /async-storage/i.test(f.summary) || /async.storage/i.test(f.id)
      )
    ).toBe(true);
    for (const d of deps) {
      expect(d.paths.some((p) => /package\.json/i.test(p))).toBe(true);
    }

    const strategy = injectGroundedStrategyBlocks("## Direct answer\nSpendy audit.\n", {
      checklistFindings: pack.checklist!.findings,
      reqRows: pack.reqMatrix!.rows,
      coverageRatio: pack.reqMatrix!.coverageRatio,
      eligibleCount: pack.reqMatrix!.eligibleCount,
      codeBackedCount: pack.reqMatrix!.codeBackedCount,
      groundedCurrency: "EGP",
    });
    expect(strategy).toMatch(/## Key Findings/);
    expect(strategy).toMatch(/DEP-/);
    expect(strategy).toMatch(/package\.json/);
    expect(strategy).toMatch(/supabase/i);
    expect(strategy).toMatch(/async-storage/i);
  });
});

describe("claim checker rejects mismatched REQ status prose", () => {
  it("rejects prose saying missing when RTM is partial and vice versa", () => {
    const grounded = [
      { id: "REQ-006", status: "partial", codePaths: ["src/screens/HomeScreen.js"] },
      { id: "REQ-007", status: "missing", codePaths: [] },
    ];
    const draft = [
      `## Direct answer`,
      `REQ-006 is missing from the codebase.`,
      `REQ-007 is partial via OcrScreen.`,
      `OCR is implemented in navigation.`,
    ].join("\n");
    const hits = detectHallucinatedImplementedStatus(draft, grounded);
    expect(hits.some((h) => /REQ-006/.test(h.claim))).toBe(true);
    expect(hits.some((h) => /REQ-007/.test(h.claim))).toBe(true);

    const detected = detectInvalidClaims(draft, SPENDY_REPO, "EGP", grounded);
    expect(detected.ok).toBe(false);
  });

  it("stripModelOwnedClaims removes model status/coverage/deps lines", () => {
    const dirty = [
      `## Direct answer`,
      `REQ-006 is missing and OCR is partial.`,
      `Deterministic Coverage: 2/16 (12.5%)`,
      `- Missing dependencies:`,
      `- @supabase/supabase-js missing from package.json`,
      `...(truncated narrative only)`,
      `## Deterministic blocks`,
      `- RTM rows in file: 0`,
    ].join("\n");
    const clean = stripModelOwnedClaims(dirty);
    expect(clean).not.toMatch(/REQ-006 is missing/);
    expect(clean).not.toMatch(/Deterministic Coverage/);
    expect(clean).not.toMatch(/RTM rows in file:\s*0/);
    expect(clean).not.toMatch(/\.\.\.\(\s*truncated/);
    expect(clean).not.toMatch(/@supabase\/supabase-js missing/);
  });
});

describe("clipStrategyForPrompt preserves full grounded RTM + Key Findings", () => {
  it("keeps every REQ id/status and finding id (no PROMPT_ONLY placeholder)", () => {
    const pack = scanRepoEvidence(SPENDY_REPO, {
      goal: `examine ${SPENDY_REPO} against ${SPENDY_SPEC}`,
      specRoot: SPENDY_SPEC,
    });
    const strategy = injectGroundedStrategyBlocks("## Direct answer\nOk.\n", {
      checklistFindings: pack.checklist!.findings,
      reqRows: pack.reqMatrix!.rows,
      coverageRatio: pack.reqMatrix!.coverageRatio,
      eligibleCount: pack.reqMatrix!.eligibleCount,
      codeBackedCount: pack.reqMatrix!.codeBackedCount,
      groundedCurrency: "EGP",
    });
    const clip = clipStrategyForPrompt(strategy, 800, {
      reqRowCount: pack.reqMatrix!.rows.length,
      findingCount: 5,
      reqRows: pack.reqMatrix!.rows,
      checklistFindings: pack.checklist!.findings,
      coverageRatio: pack.reqMatrix!.coverageRatio,
      assessedCoverageRatio: pack.reqMatrix!.assessedCoverageRatio,
      eligibleCount: pack.reqMatrix!.eligibleCount,
      codeBackedCount: pack.reqMatrix!.codeBackedCount,
      groundedCurrency: "EGP",
    });
    expect(clip).not.toMatch(/PROMPT_ONLY_DETERMINISTIC_SUMMARY/);
    expect(clip).not.toMatch(/Requirement Status List:/i);
    expect(clip).not.toMatch(/RTM rows in file:\s*0/);
    expect(clip).toMatch(/## Requirements traceability \(deterministic\)/);
    expect(clip).toMatch(/## Key Findings/);
    expect(clip).toMatch(/## REQ status index \(deterministic/);
    for (const r of pack.reqMatrix!.rows) {
      expect(clip).toContain(r.id);
      expect(clip).toMatch(
        new RegExp(`\\|\\s*${r.id}\\s*\\|\\s*${r.status}\\b`, "i")
      );
    }
    for (const f of pack.checklist!.findings) {
      if (!f?.id || /^CUR-OK$/i.test(f.id)) continue;
      expect(clip).toContain(f.id);
    }
  });
});

describe("target repo prompt injection", () => {
  it("formatTargetRepoPromptBlock labels harness cwd as non-target", async () => {
    const { formatTargetRepoPromptBlock, scrubHarnessCwdLeak } = await import(
      "../src/agency/reviewGraph.js"
    );
    const block = formatTargetRepoPromptBlock({
      targetRepo: "E:\\UpNexa.com\\spendy",
      specRoot: "D:\\My Documents\\Spendy",
      harnessCwd: "E:\\UpNexa.com\\Sam-Harness",
    });
    expect(block).toMatch(/TARGET REPO/);
    expect(block).toContain("E:\\UpNexa.com\\spendy");
    expect(block).toMatch(/HARNESS CWD \(internal only/);
    expect(block).toContain("Sam-Harness");
    const scrubbed = scrubHarnessCwdLeak(
      "Auditing `E:\\UpNexa.com\\Sam-Harness` next.",
      "E:\\UpNexa.com\\spendy",
      "E:\\UpNexa.com\\Sam-Harness"
    );
    expect(scrubbed).toContain("spendy");
    expect(scrubbed).not.toMatch(/Sam-Harness/);
  });
});

describe("Spendy end-to-end strategy consistency", () => {
  it("final strategy after inject+repair passes deterministic consistency checks", () => {
    const pack = scanRepoEvidence(SPENDY_REPO, {
      goal: `examine ${SPENDY_REPO} against ${SPENDY_SPEC}`,
      specRoot: SPENDY_SPEC,
    });
    expect(pack.reqMatrix).toBeTruthy();
    expect(pack.checklist).toBeTruthy();

    const dirtyModel = [
      `## Direct answer`,
      `Spendy looks mostly done.`,
      `REQ-006 is missing and REQ-007 is partial.`,
      `OCR is implemented via OcrScreen; voice is partial.`,
      `Deterministic Coverage: 2/16 (12.5%)`,
      `- Missing dependencies: @supabase/supabase-js`,
      `## Current State vs. Gaps`,
      `- `,
      `## Requirements traceability`,
      `Coverage: 12.5%`,
      `## Key Findings`,
      `- (model omitted deps)`,
      `...(truncated narrative only)`,
    ].join("\n");

    const grounded = {
      reqRows: pack.reqMatrix!.rows,
      checklistFindings: pack.checklist!.findings,
      coverageRatio: pack.reqMatrix!.coverageRatio,
      eligibleCount: pack.reqMatrix!.eligibleCount,
      codeBackedCount: pack.reqMatrix!.codeBackedCount,
      groundedCurrency: pack.localeCurrency?.currency || "EGP",
      targetRepo: SPENDY_REPO,
    };

    const repaired = repairStrategyDeterministically(dirtyModel, grounded);
    expect(repaired).toMatch(/## REQ status index \(deterministic/);
    expect(repaired).toMatch(/## Requirements traceability \(deterministic\)/);
    expect(repaired).toMatch(/## Key Findings/);
    expect(repaired).toMatch(/package\.json/);
    expect(repaired).not.toMatch(/\.\.\.\(\s*truncated/);
    expect(repaired).not.toMatch(/Deterministic Coverage:\s*2\/16/);
    expect(repaired).not.toMatch(/RTM rows in file:\s*0/);

    // Status index must agree with RTM for voice/OCR → missing
    const voice = pack.reqMatrix!.rows.find((r) => /voice/i.test(r.text));
    const ocr = pack.reqMatrix!.rows.find((r) => /\bocr\b|receipt/i.test(r.text));
    expect(voice?.status).toBe("missing");
    expect(ocr?.status).toBe("missing");
    if (voice) {
      expect(repaired).toMatch(
        new RegExp(`${voice.id}:\\s*\\*\\*missing\\*\\*`, "i")
      );
    }
    if (ocr) {
      expect(repaired).toMatch(
        new RegExp(`${ocr.id}:\\s*\\*\\*missing\\*\\*`, "i")
      );
    }

    const check = runStrategyConsistencyChecks(repaired, grounded);
    expect(check.ok, JSON.stringify(check.issues, null, 2)).toBe(true);

    const statusIdx = buildDeterministicReqStatusIndex(pack.reqMatrix!.rows);
    expect(statusIdx).toMatch(/from reqTrace/);
    expect(statusIdx.match(/REQ-\d+/g)?.length).toBe(pack.reqMatrix!.rows.length);
  });
});
