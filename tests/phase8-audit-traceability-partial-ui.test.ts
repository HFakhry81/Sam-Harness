/**
 * Phase 8: audit-intent gate uses assessed REQ traceability (not implementation
 * coverage); screen+handler+mock = partial; nav-only = missing; ASCII gate reasons.
 */
import { describe, it, expect } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  buildReqTraceMatrix,
  formatAssessedCoverageLine,
  formatGroundedCoverageLine,
} from "../src/agency/reqTrace.js";
import { indexRepo } from "../src/agency/repoIndex.js";
import { scanRepoEvidence } from "../src/agency/evidence.js";
import { ingestSpecFolder } from "../src/agency/specIngest.js";
import { classifyRouteIntent } from "../src/agency/routeIntent.js";
import { asciiGateReason, toAsciiDashes } from "../src/agency/asciiText.js";
import { buildAgencyVerdict } from "../src/agency/agencyVerdict.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, "fixtures", "grounded-audit");
const PARTIAL_REPO = path.join(FIX, "partial-ui-repo");
const PARTIAL_SPEC = path.join(FIX, "partial-ui-spec");

describe("partial-ui fixture: screen+mock = partial; nav-only = missing", () => {
  it("wallet/transactions with feature UI + mockData are partial; voice/OCR nav-only are missing", async () => {
    const spec = await ingestSpecFolder(PARTIAL_SPEC);
    expect(spec.requirements.length).toBeGreaterThanOrEqual(4);
    const index = indexRepo(PARTIAL_REPO);
    expect(index.usesMockData).toBe(true);

    const matrix = buildReqTraceMatrix(spec.requirements, index, []);
    const wallet = matrix.rows.find((r) => /wallet/i.test(r.text));
    const tx = matrix.rows.find((r) => /transaction/i.test(r.text));
    const voice = matrix.rows.find((r) => /voice/i.test(r.text));
    const ocr = matrix.rows.find((r) => /ocr|receipt/i.test(r.text));

    expect(wallet).toBeTruthy();
    expect(tx).toBeTruthy();
    expect(voice).toBeTruthy();
    expect(ocr).toBeTruthy();

    expect(wallet!.status).toBe("partial");
    expect(wallet!.codePaths.some((p) => /WalletScreen/i.test(p))).toBe(true);
    expect(wallet!.assessed).toBe(true);
    expect(
      wallet!.evidenceNotes.some((n) => /mock data|partial/i.test(n))
    ).toBe(true);

    expect(tx!.status).toBe("partial");
    expect(tx!.codePaths.some((p) => /TransactionsScreen/i.test(p))).toBe(true);
    expect(tx!.assessed).toBe(true);

    // Nav-only Tab.Screen registration must NOT elevate OCR/voice
    expect(voice!.status).toBe("missing");
    expect(voice!.codePaths.length).toBe(0);
    expect(voice!.assessed).toBe(true);
    expect(ocr!.status).toBe("missing");
    expect(ocr!.codePaths.length).toBe(0);
    expect(ocr!.assessed).toBe(true);

    // Nav / mock paths never appear as implementation codePaths
    for (const r of [wallet!, tx!, voice!, ocr!]) {
      expect(
        r.codePaths.some((p) => /navigation\/|mockData|AppTabs/i.test(p))
      ).toBe(false);
    }
  });

  it("scanRepoEvidence agrees with matrix statuses", () => {
    const pack = scanRepoEvidence(PARTIAL_REPO, {
      goal: `audit ${PARTIAL_REPO} against ${PARTIAL_SPEC}`,
      specRoot: PARTIAL_SPEC,
    });
    expect(pack.reqMatrix).toBeTruthy();
    const rows = pack.reqMatrix!.rows;
    expect(rows.find((r) => /wallet/i.test(r.text))!.status).toBe("partial");
    expect(rows.find((r) => /transaction/i.test(r.text))!.status).toBe(
      "partial"
    );
    expect(rows.find((r) => /voice/i.test(r.text))!.status).toBe("missing");
    expect(rows.find((r) => /ocr|receipt/i.test(r.text))!.status).toBe(
      "missing"
    );
  });
});

describe("audit intent gate metric is assessed traceability", () => {
  it("assessedCoverageRatio is ~1 when every eligible REQ was searched; implementation may be low", async () => {
    const spec = await ingestSpecFolder(PARTIAL_SPEC);
    const index = indexRepo(PARTIAL_REPO);
    const matrix = buildReqTraceMatrix(spec.requirements, index, []);

    expect(matrix.eligibleCount).toBeGreaterThanOrEqual(4);
    expect(matrix.assessedCount).toBe(matrix.eligibleCount);
    expect(matrix.assessedCoverageRatio).toBe(1);
    // Implementation coverage is reported only - low is a FINDING, not a gate fail
    expect(matrix.coverageRatio).toBeLessThan(0.7);
    expect(matrix.partialCount).toBeGreaterThanOrEqual(2);
    expect(matrix.missingCount).toBeGreaterThanOrEqual(2);
    expect(matrix.codeBackedCount).toBe(matrix.partialCount);

    const implLine = formatGroundedCoverageLine({
      coverageRatio: matrix.coverageRatio,
      codeBackedCount: matrix.codeBackedCount,
      eligibleCount: matrix.eligibleCount,
    });
    const assessedLine = formatAssessedCoverageLine({
      assessedCoverageRatio: matrix.assessedCoverageRatio,
      assessedCount: matrix.assessedCount,
      eligibleCount: matrix.eligibleCount,
    });
    expect(matrix.markdown).toContain(implLine);
    expect(matrix.markdown).toContain(assessedLine);
    expect(assessedLine).toMatch(/Audit traceability/);
    expect(assessedLine).toMatch(/100\.0%/);

    const intent = classifyRouteIntent(
      `audit the Expo app at ${PARTIAL_REPO} against ${PARTIAL_SPEC}`
    );
    expect(intent.kind).toBe("audit");
    // Gate for audit uses assessed (>= 0.7); implementation stays reported
    const gateCoverage =
      intent.kind === "audit" || intent.kind === "unknown"
        ? matrix.assessedCoverageRatio
        : matrix.coverageRatio;
    expect(gateCoverage).toBeGreaterThanOrEqual(0.7);
    expect(matrix.coverageRatio).toBeLessThan(0.7);
  });
});

describe("ASCII dashes in written gate reasons", () => {
  it("toAsciiDashes / asciiGateReason strip em and en dashes", () => {
    const raw =
      "Requirements coverage 6.7% < 70% \u2014 too many REQs still missing";
    expect(toAsciiDashes(raw)).toBe(
      "Requirements coverage 6.7% < 70% - too many REQs still missing"
    );
    expect(asciiGateReason(raw)).not.toMatch(/[\u2014\u2013\u2212]/);
    expect(asciiGateReason(raw)).toContain(" - ");
  });

  it("verdict rejectReasons are ASCII-safe", () => {
    const v = buildAgencyVerdict({
      auditPassed: false,
      goalPassed: false,
      goalFidelityScore: 0.9,
      loop: 3,
      maxLoops: 5,
      packClaimsOk: true,
      rejectReasons: [
        "Audit traceability 6.7% < 70% \u2014 too many REQs lack an assessed search/status trace",
      ],
    });
    expect(v.rejectReasons[0]).not.toMatch(/[\u2014\u2013]/);
    expect(v.rejectReasons[0]).toContain(" - ");
    expect(v.reason).not.toMatch(/[\u2014\u2013]/);
  });
});
