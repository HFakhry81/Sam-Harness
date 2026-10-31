/**
 * Phase 5: structural markdown repair after deletion, deterministic RTM /
 * Key Findings injection into strategy, Implemented-with-spec-only rejection.
 */
import { describe, it, expect } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  hasStructuralMarkdownHoles,
  normalizeMarkdownStructure,
} from "../src/agency/markdownNormalize.js";
import {
  deleteClaimSentences,
  detectHallucinatedImplementedStatus,
  detectInvalidClaims,
  finalizeClaimsClean,
  buildClaimRewritePrompt,
} from "../src/agency/claimVerify.js";
import {
  buildDeterministicKeyFindingsBlock,
  buildDeterministicRtmBlock,
  injectGroundedStrategyBlocks,
} from "../src/agency/finalReport.js";
import { extractAuditorIssues } from "../src/agency/reviewGraph.js";
import { scanRepoEvidence } from "../src/agency/evidence.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, "fixtures", "grounded-audit");
const REPO = path.join(FIX, "spendy-repo");
const SPEC = path.join(FIX, "spendy-spec");

describe("markdown structural normalize after deletion", () => {
  it("repairs empty bullets, skipped list numbers, empty headings, trailing colons", () => {
    const holes = [
      `# Strategy`,
      ``,
      `## Current State vs. Gaps`,
      ``,
      `- `,
      `- Missing Critical Dependencies:`,
      `Verification:`,
      ``,
      `## Next actions`,
      `2. Wire auth`,
      `4. Install supabase`,
      `6. Add onPress`,
      ``,
      `## Empty leftover`,
      `- `,
      ``,
    ].join("\n");

    expect(hasStructuralMarkdownHoles(holes)).toBe(true);
    const fixed = normalizeMarkdownStructure(holes);
    expect(hasStructuralMarkdownHoles(fixed)).toBe(false);
    expect(fixed).not.toMatch(/^\s*[-*+]\s*$/m);
    expect(fixed).not.toMatch(/Missing Critical Dependencies:\s*$/m);
    expect(fixed).not.toMatch(/^Verification:\s*$/m);
    expect(fixed).not.toMatch(/## Current State vs\. Gaps/i);
    expect(fixed).not.toMatch(/## Empty leftover/i);
    // Renumbered contiguous 1..N
    expect(fixed).toMatch(/1[.)]\s+Wire auth/);
    expect(fixed).toMatch(/2[.)]\s+Install supabase/);
    expect(fixed).toMatch(/3[.)]\s+Add onPress/);
    expect(fixed).not.toMatch(/^\s*4[.)]/m);
    expect(fixed).not.toMatch(/^\s*6[.)]/m);
  });

  it("normalize runs after claim deletion so auditor never sees holes", () => {
    const draft = [
      `## Gap matrix`,
      `Gulf pricing uses SAR in checkout.`,
      `- `,
      `## Current State vs. Gaps`,
      ``,
      `2. Keep mockData EGP at \`src/data/mockData.js\``,
      `4. Next step leftover`,
      `Verification:`,
    ].join("\n");

    const cleaned = finalizeClaimsClean(draft, REPO, "EGP");
    expect(cleaned.text).not.toMatch(/\bSAR\b/i);
    expect(hasStructuralMarkdownHoles(cleaned.text)).toBe(false);
    expect(cleaned.text).toMatch(/mockData\.js/);
    expect(cleaned.text).toMatch(/1[.)]\s+Keep mockData/);
  });

  it("deleteClaimSentences normalizes leftover empty list scaffolding", () => {
    const text = [
      `## Findings`,
      `- Currency must not be SAR.`,
      `- `,
      `## Empty section`,
      `- `,
    ].join("\n");
    const { text: out } = deleteClaimSentences(text, [
      {
        kind: "invalid_currency",
        claim: "SAR",
        detail: "conflict",
        sentence: "- Currency must not be SAR.",
      },
    ]);
    expect(out).not.toMatch(/\bSAR\b/);
    expect(hasStructuralMarkdownHoles(out)).toBe(false);
  });
});

describe("Implemented status claim checker", () => {
  it("rejects Implemented whose only citation is a spec .docx", () => {
    const draft =
      "REQ-001 is Implemented per `docs/Spendy-Brief.docx` and the product brief.";
    const grounded = [
      { id: "REQ-001", status: "missing", codePaths: [] },
      { id: "REQ-002", status: "partial", codePaths: ["src/data/mockData.js"] },
    ];
    const hits = detectHallucinatedImplementedStatus(draft, grounded);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.kind === "invalid_req_status")).toBe(true);

    const detected = detectInvalidClaims(draft, REPO, "EGP", grounded);
    expect(detected.ok).toBe(false);
    expect(detected.invalid.some((i) => i.kind === "invalid_req_status")).toBe(
      true
    );
  });

  it("rejects Implemented that contradicts grounded RTM missing/partial", () => {
    const draft =
      "REQ-003 is Implemented with live auth in production.";
    const grounded = [{ id: "REQ-003", status: "missing", codePaths: [] }];
    const hits = detectHallucinatedImplementedStatus(draft, grounded);
    expect(hits.some((h) => /grounded RTM status is missing/i.test(h.detail))).toBe(
      true
    );
  });

  it("allows Implemented when citing real code paths matching grounded status", () => {
    const draft =
      "REQ-002 is Implemented in `src/data/mockData.js` for EGP currency display.";
    const grounded = [
      {
        id: "REQ-002",
        status: "implemented",
        codePaths: ["src/data/mockData.js"],
      },
    ];
    const hits = detectHallucinatedImplementedStatus(draft, grounded);
    expect(hits.length).toBe(0);
  });
});

describe("deterministic RTM + Key Findings injection into strategy", () => {
  it("injects RTM coverage and all P0 findings with file:line into strategy", () => {
    const pack = scanRepoEvidence(REPO, {
      goal: `examine ${REPO} against ${SPEC}`,
      specRoot: SPEC,
    });
    expect(pack.reqMatrix?.rows.length).toBeGreaterThan(0);
    expect(pack.checklist?.findings.length).toBeGreaterThan(0);

    const modelDraft = [
      `## Direct answer`,
      `Spendy audit looks mostly done.`,
      `## Requirements traceability`,
      `Coverage: 21.4% — REQ-001 Implemented via brief.docx`,
      `## Key Findings`,
      `- (model omitted P0 deps)`,
    ].join("\n");

    const injected = injectGroundedStrategyBlocks(modelDraft, {
      checklistFindings: pack.checklist!.findings,
      reqRows: pack.reqMatrix!.rows,
      coverageRatio: pack.reqMatrix!.coverageRatio,
      groundedCurrency: pack.localeCurrency?.currency || "EGP",
    });

    expect(injected).toMatch(/## Requirements traceability \(deterministic\)/);
    expect(injected).toMatch(/## Key Findings/);
    expect(injected).toMatch(/Coverage \(non-missing\):/);
    // Must not keep the hallucinated 21.4% model RTM section
    expect(injected).not.toMatch(/Coverage:\s*21\.4%/);
    expect(injected).toMatch(/MOCK-001|mock data/i);
    expect(injected).toMatch(/DEP-|supabase/i);
    expect(injected).toMatch(/UI-HANDLER|onPress/i);
    expect(injected).toMatch(/HomeScreen\.js:\d+/);
    expect(injected).toMatch(/REQ-/);

    const rtm = buildDeterministicRtmBlock({
      reqRows: pack.reqMatrix!.rows,
      coverageRatio: pack.reqMatrix!.coverageRatio,
    });
    const expectedPct = (pack.reqMatrix!.coverageRatio * 100).toFixed(1);
    expect(rtm).toContain(`${expectedPct}%`);

    const kf = buildDeterministicKeyFindingsBlock({
      checklistFindings: pack.checklist!.findings,
      reqRows: pack.reqMatrix!.rows,
      groundedCurrency: "EGP",
    });
    expect(kf).toMatch(/\[P0\]/);
  });

  it("rewrite prompt includes prior auditor issues", () => {
    const prompt = buildClaimRewritePrompt({
      draft: "SAR leftover",
      invalid: [
        {
          kind: "invalid_currency",
          claim: "SAR",
          detail: "conflicts with EGP",
        },
      ],
      groundedCurrency: "EGP",
      evidenceClip: "src/data/mockData.js",
      priorAuditorIssues: [
        "Erasure placeholders / incomplete content: empty Current State vs. Gaps",
        "RTM mismatch: invented 21.4% coverage",
      ],
    });
    expect(prompt).toMatch(/PRIOR AUDITOR ISSUES/);
    expect(prompt).toMatch(/empty Current State vs\. Gaps/);
    expect(prompt).toMatch(/RTM mismatch/);
    expect(prompt).toMatch(/Do NOT mark a REQ Implemented/);
  });

  it("extractAuditorIssues surfaces structural and RTM complaints", () => {
    const report = [
      `[REJECTED]`,
      `### Issue 1`,
      `- Rejection reason: Erasure placeholders / incomplete content — empty sections`,
      `- How to fix: Fill Current State vs. Gaps; remove empty bullets`,
      `### Issue 2`,
      `- Rejection reason: RTM coverage hallucinated at 21.4% vs evidence`,
      `FIX 1: Include all P0 dependency findings with code paths`,
    ].join("\n");
    const issues = extractAuditorIssues(report);
    expect(issues.length).toBeGreaterThan(1);
    expect(issues.some((i) => /empty section|structural/i.test(i))).toBe(true);
    expect(issues.some((i) => /RTM|deterministic/i.test(i))).toBe(true);
    expect(issues.some((i) => /P0/i.test(i))).toBe(true);
  });
});
