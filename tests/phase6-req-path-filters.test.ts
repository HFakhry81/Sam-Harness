/**
 * Phase 6: junk/backup/prior-report paths must not count as REQ implementation;
 * deterministic RTM/Key Findings must never be prompt-truncated in written files.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { fileURLToPath } from "url";
import {
  isAppSourcePath,
  isJunkEvidencePath,
} from "../src/agency/pathFilters.js";
import { buildReqTraceMatrix } from "../src/agency/reqTrace.js";
import { indexRepo } from "../src/agency/repoIndex.js";
import { scanRepoEvidence } from "../src/agency/evidence.js";
import { ingestSpecFolder } from "../src/agency/specIngest.js";
import {
  buildDeterministicRtmBlock,
  clipStrategyForPrompt,
  composeFinalReport,
  injectGroundedStrategyBlocks,
} from "../src/agency/finalReport.js";
import { buildAgencyVerdict } from "../src/agency/agencyVerdict.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, "fixtures", "grounded-audit");
const JUNK_REPO = path.join(FIX, "junk-paths-repo");
const JUNK_SPEC = path.join(FIX, "junk-paths-spec");
const SPENDY_REPO = path.join(FIX, "spendy-repo");
const SPENDY_SPEC = path.join(FIX, "spendy-spec");

describe("path filters — junk / backup / prior reports", () => {
  it("classifies backup, Sam-Harness output, toolbox/maintenance, docs json, lockfiles as junk", () => {
    expect(isJunkEvidencePath(".security-backup-20261023/package.json")).toBe(
      true
    );
    expect(isJunkEvidencePath("docs/Sam-Harness no.1/engagement.json")).toBe(
      true
    );
    expect(isJunkEvidencePath("toolbox/maintenance/project.json")).toBe(true);
    expect(isJunkEvidencePath("docs/notes.md")).toBe(true);
    expect(isJunkEvidencePath("pnpm-lock.yaml")).toBe(true);
    expect(isJunkEvidencePath("ceo-draft.md")).toBe(true);
    expect(isJunkEvidencePath("README.md")).toBe(true);
    expect(isAppSourcePath("src/screens/HomeScreen.js")).toBe(true);
    expect(isAppSourcePath("toolbox/maintenance/project.json")).toBe(false);
    expect(isAppSourcePath("docs/Sam-Harness no.1/engagement.json")).toBe(false);
  });

  it("fixture: backup + prior-report dirs never count as voice/OCR/supabase implementation", async () => {
    const spec = await ingestSpecFolder(JUNK_SPEC);
    expect(spec.requirements.length).toBeGreaterThanOrEqual(3);
    const index = indexRepo(JUNK_REPO);
    // Index must not surface junk paths as hits
    expect(
      index.hits.some((h) => /security-backup|Sam-Harness|toolbox\/maintenance/i.test(h.path))
    ).toBe(false);
    expect(index.filesReadMeta?.some((f) => isJunkEvidencePath(f.path))).toBe(
      false
    );

    const pack = scanRepoEvidence(JUNK_REPO, {
      goal: `examine ${JUNK_REPO} against ${JUNK_SPEC}`,
      specRoot: JUNK_SPEC,
    });
    expect(pack.reqMatrix).toBeTruthy();
    const rows = pack.reqMatrix!.rows;

    const voice = rows.find((r) => /voice/i.test(r.text));
    const ocr = rows.find((r) => /ocr/i.test(r.text));
    const supabase = rows.find((r) => /supabase/i.test(r.text));
    expect(voice).toBeTruthy();
    expect(ocr).toBeTruthy();
    expect(supabase).toBeTruthy();

    for (const r of [voice!, ocr!, supabase!]) {
      expect(r.status).not.toBe("implemented");
      expect(["missing", "unverified", "partial", "contradicts"]).toContain(
        r.status
      );
      expect(
        r.codePaths.every((p) => !isJunkEvidencePath(p) && isAppSourcePath(p))
      ).toBe(true);
      // No junk path citations
      expect(
        r.codePaths.some((p) =>
          /security-backup|Sam-Harness|toolbox\/maintenance|ceo-draft|README/i.test(
            p
          )
        )
      ).toBe(false);
    }

    // Coverage must not be inflated by junk "hits"
    expect(pack.reqMatrix!.coverageRatio).toBeLessThan(0.875);
    // EGP home screen may be partial/implemented from real src — fine
    const egp = rows.find((r) => /EGP/i.test(r.text));
    expect(egp).toBeTruthy();
    if (egp!.status === "implemented" || egp!.status === "partial") {
      expect(egp!.codePaths.some((p) => /src\/screens\/HomeScreen/.test(p))).toBe(
        true
      );
    }
  });

  it("P0 mock/auth findings cap related REQs at partial (Spendy)", () => {
    const pack = scanRepoEvidence(SPENDY_REPO, {
      goal: `examine ${SPENDY_REPO} against ${SPENDY_SPEC}`,
      specRoot: SPENDY_SPEC,
    });
    const rows = pack.reqMatrix!.rows;
    const liveish = rows.filter((r) =>
      /auth|supabase|live|otp|mock/i.test(r.text)
    );
    expect(liveish.length).toBeGreaterThan(0);
    expect(liveish.every((r) => r.status === "implemented")).toBe(false);
    // Mock/auth P0s should prevent implemented for live-backend REQs
    for (const r of liveish) {
      expect(r.status).not.toBe("implemented");
    }
  });
});

describe("deterministic blocks never truncated in written files", () => {
  it("clipStrategyForPrompt summarizes RTM/Key Findings without ...(truncated) inside those blocks", () => {
    const pack = scanRepoEvidence(SPENDY_REPO, {
      goal: `examine ${SPENDY_REPO} against ${SPENDY_SPEC}`,
      specRoot: SPENDY_SPEC,
    });
    const verdict = buildAgencyVerdict({
      auditPassed: true,
      goalPassed: true,
      goalFidelityScore: 1,
      loop: 1,
      maxLoops: 5,
      packClaimsOk: true,
    });
    const longNarrative = ("Gap analysis paragraph. ").repeat(400);
    const strategy = injectGroundedStrategyBlocks(
      `## Direct answer\n${longNarrative}\n`,
      {
        checklistFindings: pack.checklist!.findings,
        reqRows: pack.reqMatrix!.rows,
        coverageRatio: pack.reqMatrix!.coverageRatio,
        groundedCurrency: "EGP",
      }
    );

    // Written strategy must contain full deterministic blocks (no truncation marker)
    expect(strategy).toMatch(/## Requirements traceability \(deterministic\)/);
    expect(strategy).toMatch(/## Key Findings/);
    const rtmSection = strategy.match(
      /## Requirements traceability \(deterministic\)[\s\S]*?(?=\n## Key Findings)/
    )?.[0];
    expect(rtmSection).toBeTruthy();
    expect(rtmSection!).not.toMatch(/\.\.\.\(truncated\)/);
    expect(rtmSection!).toMatch(/\| REQ-/i);

    const promptClip = clipStrategyForPrompt(strategy, 800);
    // Prompt may truncate narrative, but must not embed truncated RTM table
    expect(promptClip).toMatch(/Deterministic blocks \(full text is in the written/);
    expect(promptClip).toMatch(/RTM rows in file:/);
    expect(promptClip).not.toMatch(
      /## Requirements traceability \(deterministic\)[\s\S]*\.\.\.\(truncated\)/
    );

    const composed = composeFinalReport({
      evidence: {
        verdict,
        checklistFindings: pack.checklist!.findings,
        reqRows: pack.reqMatrix!.rows,
        groundedCurrency: "EGP",
      },
      modelProse: longNarrative,
    });
    expect(composed).not.toMatch(
      /## Key Findings[\s\S]*\.\.\.\(truncated\)/
    );
  });

  it("buildDeterministicRtmBlock lists every REQ without truncation", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: `REQ-${String(i + 1).padStart(3, "0")}`,
      text: `Requirement number ${i + 1} about feature ${i + 1}`,
      status: i % 5 === 0 ? "missing" : "partial",
      codePaths: i % 5 === 0 ? [] : [`src/feature${i}.js`],
    }));
    const block = buildDeterministicRtmBlock({
      reqRows: rows,
      coverageRatio: 0.4,
    });
    expect(block).not.toMatch(/\.\.\.\(truncated\)/);
    expect(block).toContain("REQ-001");
    expect(block).toContain("REQ-020");
    expect(block).toMatch(/Coverage \(code-backed/);
  });
});
