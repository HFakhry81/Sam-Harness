/**
 * Phase 4 grounded-audit: post-write forbidden-residue enforcement on
 * final-report.md (SAR-in-EGP) + deterministic Key Findings coverage.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { fileURLToPath } from "url";
import {
  assertCleanPackClaims,
  enforcePackResiduesAfterWrite,
  scoreGroundedAuditRubric,
  GROUNDED_FIDELITY_THRESHOLD,
} from "../src/agency/fidelityRubric.js";
import {
  detectInvalidClaims,
  finalizeClaimsClean,
  remediateInvalidClaims,
} from "../src/agency/claimVerify.js";
import {
  buildDeterministicFinalReportSections,
  composeFinalReport,
  finalReportCoversStructuredFindings,
  finalReportHasFindingsCoverage,
} from "../src/agency/finalReport.js";
import { buildAgencyVerdict } from "../src/agency/agencyVerdict.js";
import { scanRepoEvidence } from "../src/agency/evidence.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, "fixtures", "grounded-audit");
const REPO = path.join(FIX, "spendy-repo");
const SPEC = path.join(FIX, "spendy-spec");
const SAR_FIXTURE = path.join(FIX, "sar-in-egp-final-report.md");

describe("SAR-in-EGP forbidden residue — post-write scan", () => {
  let tmp: string;
  let prevCwd: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sam-residue-"));
    prevCwd = process.cwd();
    process.chdir(tmp);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("detects SAR (and lowercase sar) in tables/code spans for an EGP-grounded run", () => {
    const dirty = fs.readFileSync(SAR_FIXTURE, "utf-8");
    expect(dirty).toMatch(/\bSAR\b/);
    expect(dirty).toMatch(/`sar`/);
    const detected = detectInvalidClaims(dirty, REPO, "EGP");
    expect(detected.ok).toBe(false);
    expect(detected.invalid.some((i) => i.kind === "invalid_currency")).toBe(true);
    expect(assertCleanPackClaims(dirty, "EGP").ok).toBe(false);
    expect(assertCleanPackClaims(dirty, "EGP").violations).toContain("SAR");
  });

  it("clean-deletes SAR sentences — never [REMOVED] and never auto-subs EGP into the SAR sentence", () => {
    const dirty = fs.readFileSync(SAR_FIXTURE, "utf-8");
    const cleaned = finalizeClaimsClean(dirty, REPO, "EGP");
    expect(cleaned.text).not.toMatch(/\bSAR\b/i);
    expect(cleaned.text).not.toMatch(/\[REMOVED\]/i);
    // Must keep grounded EGP evidence path — not rewrite SAR→EGP in-place
    expect(cleaned.text).toMatch(/mockData\.js/);
    expect(cleaned.text).toMatch(/\bEGP\b/);
    expect(assertCleanPackClaims(cleaned.text, "EGP").ok).toBe(true);
  });

  it("enforcePackResiduesAfterWrite scans final-report.md after last write and remediates", async () => {
    const dirty = fs.readFileSync(SAR_FIXTURE, "utf-8");
    fs.writeFileSync("final-report.md", dirty, "utf-8");
    fs.writeFileSync(
      "ceo-draft.md",
      "# Draft\nGrounded EGP only.\n",
      "utf-8"
    );

    // Simulate a rewriter that fails to remove SAR (still returns residue)
    let rewriteCalls = 0;
    const result = await enforcePackResiduesAfterWrite({
      cwd: tmp,
      targetRepo: REPO,
      groundedCurrency: "EGP",
      maxRewrites: 2,
      rewriteFn: async () => {
        rewriteCalls += 1;
        return "Still mentions SAR pricing for Gulf.\nKeep `src/data/mockData.js` EGP.\n";
      },
    });

    expect(rewriteCalls).toBe(2);
    const finalText = fs.readFileSync("final-report.md", "utf-8");
    expect(finalText).not.toMatch(/\bSAR\b/i);
    expect(finalText).not.toMatch(/\[REMOVED\]/);
    expect(finalText).toMatch(/mockData\.js/);
    expect(assertCleanPackClaims(finalText, "EGP").ok).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.filesChecked).toContain("final-report.md");
  });

  it("closes the logical gate when residue cannot be removed", async () => {
    // Path that finalizeClaimsClean cannot fully erase if we inject a
    // non-sentence token glued in a way delete misses — use needsRewrite path
    // by writing a file and asserting enforce reports stillDirty when
    // assertion fails after remediation. Here we verify remediate + assert
    // contract: leftover SAR after failed delete forces ok=false.
    fs.writeFileSync(
      "final-report.md",
      [
        "```model-errors",
        "1. [invalid_currency] SAR — logged only",
        "```",
        "",
        "Outside fence the draft still says SAR for Gulf tenants.",
        "Grounded: EGP in `src/data/mockData.js`.",
      ].join("\n"),
      "utf-8"
    );

    const remediated = await remediateInvalidClaims(
      fs.readFileSync("final-report.md", "utf-8"),
      REPO,
      "EGP",
      async () =>
        // Rewriter keeps inventing SAR — force clean-delete path
        "Gulf edition SAR pricing remains. Real path `src/data/mockData.js` uses EGP.\n",
      2
    );
    fs.writeFileSync("final-report.md", remediated.text, "utf-8");
    const check = assertCleanPackClaims(
      fs.readFileSync("final-report.md", "utf-8"),
      "EGP"
    );
    expect(check.ok).toBe(true);

    // If residue remained, packClaimsOk must force CLOSED
    const closed = buildAgencyVerdict({
      auditPassed: true,
      goalPassed: true,
      goalFidelityScore: 1,
      loop: 1,
      maxLoops: 5,
      packClaimsOk: false,
      rejectReasons: ["Pack claim assertion FAIL: forbidden residues SAR in final-report.md"],
    });
    expect(closed.gate).toBe("CLOSED");
    expect(closed.auditPassed).toBe(false);
    expect(closed.reason).toMatch(/pack claim/i);
  });

  it("does not treat scrub-to-fence as sufficient — body outside fences must be clean", () => {
    const fencedOnly = [
      "# Final report",
      "EGP only.",
      "```model-errors",
      "1. [invalid_currency] SAR — conflicts with EGP",
      "```",
    ].join("\n");
    expect(assertCleanPackClaims(fencedOnly, "EGP").ok).toBe(true);

    const bodyResidue = [
      "# Final report",
      "Still uses SAR here.",
      "```model-errors",
      "1. [invalid_currency] SAR — conflicts with EGP",
      "```",
    ].join("\n");
    expect(assertCleanPackClaims(bodyResidue, "EGP").ok).toBe(false);
  });
});

describe("deterministic final-report Key Findings", () => {
  it("composeFinalReport always includes Executive summary, Key Findings, Recommendations", () => {
    const pack = scanRepoEvidence(REPO, {
      goal: `examine ${REPO} against ${SPEC}`,
      specRoot: SPEC,
    });
    expect(pack.checklist?.findings.length).toBeGreaterThan(0);
    expect(pack.reqMatrix?.rows.length).toBeGreaterThan(0);

    const verdict = buildAgencyVerdict({
      auditPassed: true,
      goalPassed: true,
      goalFidelityScore: 1,
      loop: 1,
      maxLoops: 5,
      packClaimsOk: true,
    });

    const evidence = {
      verdict,
      checklistFindings: pack.checklist!.findings,
      reqRows: pack.reqMatrix!.rows,
      groundedCurrency: pack.localeCurrency?.currency || "EGP",
      targetRepo: REPO,
    };

    // Model prose that tries to drop findings — deterministic sections must win
    const composed = composeFinalReport({
      evidence,
      modelProse: [
        "# Final report",
        "## Executive summary",
        "All good, nothing to see.",
        "## Key Findings",
        "- (model omitted real gaps)",
        "Short vibe check only.",
      ].join("\n"),
    });

    expect(finalReportHasFindingsCoverage(composed)).toBe(true);
    expect(composed).toMatch(/## Executive summary/i);
    expect(composed).toMatch(/## Key Findings/i);
    expect(composed).toMatch(/## Recommendations/i);
    expect(composed).toMatch(/\bEGP\b/);
    expect(composed).not.toMatch(/\bSAR\b/);

    // Must surface structured checklist + unmet REQs (mock, onPress, OTP/auth, stack, deps)
    expect(composed).toMatch(/MOCK-001|mock data/i);
    expect(composed).toMatch(/UI-HANDLER|onPress/i);
    expect(composed).toMatch(/STACK-001|stack/i);
    expect(composed).toMatch(/AUTH-|OTP|auth/i);
    expect(composed).toMatch(/DEP-|supabase/i);
    expect(composed).toMatch(/REQ-/);

    const coverage = finalReportCoversStructuredFindings(composed, evidence);
    expect(coverage.ok).toBe(true);

    // file:line citations for handler findings
    expect(composed).toMatch(/HomeScreen\.js:\d+/);
  });

  it("model cannot drop Key Findings by omitting them from prose", () => {
    const verdict = buildAgencyVerdict({
      auditPassed: true,
      goalPassed: true,
      goalFidelityScore: 0.9,
      loop: 2,
      maxLoops: 5,
      packClaimsOk: true,
    });
    const evidence = {
      verdict,
      checklistFindings: [
        {
          id: "MOCK-001",
          category: "mock_data" as const,
          severity: "P0" as const,
          summary: "Screens use mock data",
          paths: ["src/data/mockData.js:2"],
          detail: "Wire real backend",
        },
        {
          id: "AUTH-OTP",
          category: "auth" as const,
          severity: "P0" as const,
          summary: "OTP gap",
          paths: ["src/screens/HomeScreen.js:6"],
          detail: "Add OTP flow",
        },
      ],
      reqRows: [
        {
          id: "REQ-001",
          text: "MUST wire real authentication",
          status: "missing" as const,
          codePaths: [],
        },
      ],
      groundedCurrency: "EGP",
    };

    const brief = composeFinalReport({
      evidence,
      modelProse: "Looks fine. Ship it.",
    });
    expect(brief).toContain("MOCK-001");
    expect(brief).toContain("AUTH-OTP");
    expect(brief).toContain("REQ-001");
    expect(brief).toContain("src/data/mockData.js:2");

    const deterministic = buildDeterministicFinalReportSections(evidence);
    expect(deterministic).toMatch(/## Key Findings/);
    expect(deterministic.split("MOCK-001").length).toBeGreaterThan(1);
  });

  it("fidelity rubric requires findings_coverage when finalReport is provided", () => {
    const pack = scanRepoEvidence(REPO, {
      goal: `examine ${REPO} against ${SPEC}`,
      specRoot: SPEC,
    });
    const verdict = buildAgencyVerdict({
      auditPassed: true,
      goalPassed: true,
      goalFidelityScore: 1,
      loop: 1,
      maxLoops: 5,
      packClaimsOk: true,
    });
    const composed = composeFinalReport({
      evidence: {
        verdict,
        checklistFindings: pack.checklist!.findings,
        reqRows: pack.reqMatrix!.rows,
        groundedCurrency: "EGP",
      },
    });

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sam-rubric-fr-"));
    try {
      fs.writeFileSync(path.join(tmp, "evidence.json"), "{}");
      fs.writeFileSync(path.join(tmp, "evidence-pack.md"), "# e\n");
      fs.writeFileSync(path.join(tmp, "REQ_TRACEABILITY.md"), "# r\n");
      fs.writeFileSync(path.join(tmp, "ceo-draft.md"), "# d\n");

      const strategy = [
        "## Stack conflict: Flutter vs Expo",
        "REQ status in matrix.",
        "`src/data/mockData.js` mock-only.",
        "[P0] Auth gaps. [P1] deps.",
        "## Recommendations",
        "Should wire auth and install supabase.",
      ].join("\n");

      const withCoverage = scoreGroundedAuditRubric({
        strategy,
        evidenceMarkdown: pack.summaryMarkdown,
        specsReadCount: pack.spec?.filesRead.length || 0,
        reqRows: (pack.reqMatrix?.rows || []).map((r) => ({
          id: r.id,
          status: r.status,
          codePaths: r.codePaths,
        })),
        findings: (pack.checklist?.findings || []).map((f) => ({
          id: f.id,
          severity: f.severity,
          summary: f.summary,
          category: f.category,
        })),
        cwd: tmp,
        finalReport: composed,
        groundedCurrency: "EGP",
      });
      expect(withCoverage.items.find((i) => i.id === "findings_coverage")?.applicable).toBe(
        true
      );
      expect(withCoverage.items.find((i) => i.id === "findings_coverage")?.passed).toBe(
        true
      );
      expect(withCoverage.score).toBeGreaterThanOrEqual(GROUNDED_FIDELITY_THRESHOLD);

      const briefOnly = scoreGroundedAuditRubric({
        strategy,
        evidenceMarkdown: pack.summaryMarkdown,
        specsReadCount: pack.spec?.filesRead.length || 0,
        reqRows: (pack.reqMatrix?.rows || []).map((r) => ({
          id: r.id,
          status: r.status,
          codePaths: r.codePaths,
        })),
        findings: (pack.checklist?.findings || []).map((f) => ({
          id: f.id,
          severity: f.severity,
          summary: f.summary,
          category: f.category,
        })),
        cwd: tmp,
        finalReport: "# Final report\nToo brief. Gate OPEN.\n",
        groundedCurrency: "EGP",
      });
      expect(briefOnly.items.find((i) => i.id === "findings_coverage")?.passed).toBe(
        false
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
