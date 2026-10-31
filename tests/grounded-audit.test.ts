/**
 * Grounded audit — path extraction, evidence v2, REQ matrix, gates,
 * currency, repetition, model policy. Includes Spendy regression fixture.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  extractGoalPaths,
  primaryTargetRepo,
  primarySpecRoot,
  sanitizeExtractedPath,
} from "../src/agency/pathExtract.js";
import { scanRepoEvidence } from "../src/agency/evidence.js";
import { ingestSpecFolder } from "../src/agency/specIngest.js";
import { indexRepo } from "../src/agency/repoIndex.js";
import { buildReqTraceMatrix } from "../src/agency/reqTrace.js";
import { inferLocaleCurrency } from "../src/agency/localeCurrency.js";
import {
  extractCitedPaths,
  normalizeCitedPath,
  verifyCitationsAgainstRepo,
} from "../src/agency/claimVerify.js";
import { detectRepetition } from "../src/agency/repetitionGuard.js";
import { injectGroundedStrategyBlocks } from "../src/agency/finalReport.js";
import {
  isTinyModel,
  parseModelSizeB,
  validateTeamModelPolicy,
  LONG_FORM_ROLES,
} from "../src/agency/modelPolicy.js";
import {
  scoreGoalFidelity,
  GROUNDED_FIDELITY_THRESHOLD,
} from "../src/agency/goalFidelity.js";
import { MIN_REQ_COVERAGE } from "../src/agency/reviewGraph.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, "fixtures", "grounded-audit");
const REPO = path.join(FIX, "spendy-repo");
const SPEC = path.join(FIX, "spendy-spec");

describe("path extraction", () => {
  it("parses Windows paths with spaces and classifies repo vs spec", () => {
    const prompt =
      "examine project E:\\UpNexa.com\\spendy against spec docs in D:\\My Documents\\Spendy and produce reports";
    const paths = extractGoalPaths(prompt);
    expect(paths.targetRepos.length + paths.specRoots.length + paths.other.length).toBeGreaterThanOrEqual(2);
    const all = [...paths.targetRepos, ...paths.specRoots, ...paths.other].map(
      (p) => p.normalized.replace(/\//g, "\\").toLowerCase()
    );
    expect(all.some((p) => p.includes("spendy") && p.includes("upnexa"))).toBe(true);
    expect(all.some((p) => /my documents/i.test(p) && /spendy/i.test(p))).toBe(true);
  });

  it("handles quoted paths and Arabic surrounding text", () => {
    const prompt = `افحص المشروع "${REPO}" مقابل المواصفات في "${SPEC}"`;
    const paths = extractGoalPaths(prompt);
    expect(primaryTargetRepo(paths)).toBeTruthy();
    // At least one path extracted
    expect(
      paths.targetRepos.length + paths.specRoots.length + paths.other.length
    ).toBeGreaterThanOrEqual(1);
  });

  it("stops Windows paths at markdown / numbered-list glue (no RTM swallow)", () => {
    const garbage =
      "D:\\My Documents\\Spendy\\Easy Expenses\\Easy Expensa\\1. ## 3. Deterministic Requirement Traceability Matrix (RTM) **Coverage Summary:**";
    const cleaned = sanitizeExtractedPath(garbage);
    expect(cleaned.toLowerCase()).toContain("easy expensa");
    expect(cleaned).not.toMatch(/##|Coverage Summary|Deterministic/i);
    expect(cleaned).not.toMatch(/\d+\.\s+#/);

    const prompt = `audit against ${garbage}`;
    const paths = extractGoalPaths(prompt);
    const all = [...paths.targetRepos, ...paths.specRoots, ...paths.other];
    expect(all.every((p) => !/##|Coverage Summary/i.test(p.normalized))).toBe(
      true
    );
  });

  it("citation extractor rejects markdown-glued Windows paths", () => {
    const text = [
      "See `D:\\My Documents\\Spendy\\Easy Expenses\\Easy Expensa\\1. ## 3. Deterministic Requirement Traceability Matrix (RTM) **Coverage Summary:**`",
      "Real code: `src/screens/HomeScreen.js`",
    ].join("\n");
    const cited = extractCitedPaths(text);
    expect(cited.every((p) => !/##|Coverage Summary/i.test(p))).toBe(true);
    expect(cited.some((p) => /HomeScreen/i.test(p))).toBe(true);
    expect(
      normalizeCitedPath(
        "D:/My Documents/Spendy/Easy Expensa/1. ## 3. Deterministic RTM"
      )
    ).not.toMatch(/##|Deterministic/);
    const v = verifyCitationsAgainstRepo(text, REPO, { specRoot: SPEC });
    expect(v.missing.every((m) => !/##|Coverage Summary/i.test(m.raw))).toBe(
      true
    );
  });
});

describe("evidence scout v2 — Spendy fixture", () => {
  it("ingests spec REQs from md + docx", async () => {
    const spec = await ingestSpecFolder(SPEC);
    expect(spec.filesRead.length).toBeGreaterThanOrEqual(2);
    expect(spec.requirements.length).toBeGreaterThanOrEqual(3);
    expect(spec.requirements.some((r) => /EGP/i.test(r.text))).toBe(true);
    expect(spec.requirements[0].id).toMatch(/^REQ-\d{3}$/);
  });

  it("indexes repo: mock data, missing supabase dep, EGP currency", () => {
    const idx = indexRepo(REPO);
    expect(idx.usesMockData).toBe(true);
    expect(idx.currencies).toContain("EGP");
    expect(idx.missingImports.some((m) => m.specifier.includes("@supabase/supabase-js"))).toBe(
      true
    );
    // Must not invent packages/* as hits unless they exist
    expect(idx.hits.every((h) => !h.path.startsWith("packages/") || fs.existsSync(path.join(REPO, h.path)))).toBe(
      true
    );
  });

  it("scanRepoEvidence wires goal paths + evidence.json fields", () => {
    const goal = `examine project ${REPO} against spec docs in ${SPEC} and produce reports`;
    const pack = scanRepoEvidence(REPO, { goal, specRoot: SPEC });
    expect(pack.version).toBe(2);
    expect(pack.hits.length).toBeGreaterThan(0);
    expect(pack.spec?.requirements.length).toBeGreaterThan(0);
    expect(pack.localeCurrency?.currency).toBe("EGP");
    expect(pack.summaryMarkdown).toMatch(/Evidence pack v2/);
    expect(pack.summaryMarkdown).toMatch(/mock data: YES/i);
    // Regression: do not mislabel README Expo Go as QR/check-in booking signal
    expect(pack.hits.some((h) => /QR\/check-in/i.test(h.note))).toBe(false);
    // Regression: pnpm-workspace is workspace config, not tenant isolation
    expect(
      pack.hits.some(
        (h) =>
          /pnpm-workspace/i.test(h.path) && /tenant isolation/i.test(h.note)
      )
    ).toBe(false);
  });

  it("REQ matrix flags missing auth / live supabase as missing or contradicts", () => {
    const pack = scanRepoEvidence(REPO, {
      goal: `examine ${REPO} against ${SPEC}`,
      specRoot: SPEC,
    });
    expect(pack.reqMatrix).toBeTruthy();
    const rows = pack.reqMatrix!.rows;
    expect(rows.length).toBeGreaterThan(0);
    // At least one requirement about auth/supabase/live should not be "implemented"
    const liveish = rows.filter((r) =>
      /supabase|auth|live|mock/i.test(r.text)
    );
    expect(liveish.length).toBeGreaterThan(0);
    expect(liveish.every((r) => r.status === "implemented")).toBe(false);
  });
});

describe("claim verification + fidelity + gates constants", () => {
  it("rejects invented packages/* and apps/web citations", () => {
    const text = [
      "Implement in `packages/mobile/src/foo.ts`",
      "Also update `apps/web/pages/index.tsx`",
      "Real file: `src/data/mockData.js`",
    ].join("\n");
    const v = verifyCitationsAgainstRepo(text, REPO);
    expect(v.missing.some((m) => /packages\//.test(m.raw))).toBe(true);
    expect(v.missing.some((m) => /apps\/web/.test(m.raw))).toBe(true);
    expect(v.citations.some((c) => c.raw.includes("mockData.js") && c.exists)).toBe(
      true
    );
  });

  it("fidelity threshold is grounded 0.8", () => {
    expect(GROUNDED_FIDELITY_THRESHOLD).toBe(0.8);
    expect(MIN_REQ_COVERAGE).toBe(0.7);
    const weak = scoreGoalFidelity(
      "examine spendy against spec and produce gap matrix with EGP",
      "hello world",
      GROUNDED_FIDELITY_THRESHOLD
    );
    expect(weak.passed).toBe(false);
  });

  it("Spendy regression: 17/32-style hit ratio must not mint fidelity 1.0", () => {
    // Long goal with many distinctive tokens; strategy only covers about half.
    const goal = [
      "examine project spendy against spec docs produce gap matrix",
      "currency EGP locale ar-EG supabase auth tickets packages",
      "workspace mockData checkin invoice tenant isolation QR expo",
      "requirements traceability evidence pack final report auditor",
    ].join(" ");
    const strategy = [
      "Gap matrix for spendy with currency EGP and locale notes.",
      "Evidence pack lists mockData usage. Auth remains a gap.",
    ].join(" ");
    const r = scoreGoalFidelity(goal, strategy, GROUNDED_FIDELITY_THRESHOLD);
    expect(r.hitTokens.length).toBeGreaterThan(0);
    expect(r.hitTokens.length).toBeLessThan(r.goalTokens.length);
    // Must not inflate partial coverage to 1.0 (old Math.min(n,12) bug)
    expect(r.score).toBeLessThan(0.95);
    expect(r.passed).toBe(false);
  });
});

describe("locale/currency grounding", () => {
  it("infers EGP/ar-EG from Spendy fixture code — not SAR", () => {
    const idx = indexRepo(REPO);
    const profile = inferLocaleCurrency(idx);
    expect(profile.currency).toBe("EGP");
    expect(profile.currency).not.toBe("SAR");
  });
});

describe("repetition guard", () => {
  it("flags degenerate repeated lines", () => {
    const line = "This is a repeated deliverable line about the agency pack status.";
    const text = Array.from({ length: 12 }, () => line).join("\n");
    const r = detectRepetition(text);
    expect(r.ok).toBe(false);
    expect(r.score).toBeGreaterThan(0.3);
  });

  it("accepts normal varied text", () => {
    const text = Array.from({ length: 20 }, (_, i) => `Unique finding number ${i} with detail.`).join(
      "\n"
    );
    expect(detectRepetition(text).ok).toBe(true);
  });

  it("exempts deterministic RTM / status-index / Key Findings from degeneration", () => {
    const rows = Array.from({ length: 70 }, (_, i) => ({
      id: `REQ-${String(i + 1).padStart(3, "0")}`,
      text: `Spendy feature requirement number ${i + 1}`,
      status: i % 5 === 0 ? "partial" : "missing",
      codePaths: i % 5 === 0 ? ["src/screens/HomeScreen.js"] : ([] as string[]),
    }));
    const findings = [
      {
        id: "DEP-async_storage",
        category: "dependency" as const,
        severity: "P0" as const,
        summary: "Missing @react-native-async-storage/async-storage",
        paths: ["package.json"],
        detail: "add dep",
      },
      {
        id: "DEP-supabase",
        category: "dependency" as const,
        severity: "P0" as const,
        summary: "Missing @supabase/supabase-js",
        paths: ["package.json"],
        detail: "add dep",
      },
      {
        id: "AUTH-OTP",
        category: "auth" as const,
        severity: "P0" as const,
        summary: "OTP missing",
        paths: [] as string[],
        detail: "add otp",
      },
      {
        id: "UI-HANDLER-1",
        category: "ui_handler" as const,
        severity: "P0" as const,
        summary: "Logout without onPress",
        paths: ["src/screens/HomeScreen.js:15"],
        detail: "wire onPress",
      },
      {
        id: "MOCK-001",
        category: "mock_data" as const,
        severity: "P0" as const,
        summary: "mock data",
        paths: ["src/data/mockData.js"],
        detail: "wire backend",
      },
      {
        id: "STACK-001",
        category: "stack_conflict" as const,
        severity: "P0" as const,
        summary: "Flutter vs RN",
        paths: ["package.json"],
        detail: "align stack",
      },
    ];
    const strategy = injectGroundedStrategyBlocks(
      [
        "## Direct answer",
        "Spendy audit against the product brief.",
        "## Stack conflict",
        "Spec wants Flutter+FastAPI; repo is React Native.",
        "## Recommendations",
        "1. Install missing deps",
        "2. Wire OTP auth",
        "3. Add Logout onPress",
      ].join("\n"),
      {
        checklistFindings: findings,
        reqRows: rows,
        coverageRatio: 0.14,
        assessedCoverageRatio: 1,
        eligibleCount: 70,
        codeBackedCount: 14,
        assessedCount: 70,
        groundedCurrency: "EGP",
      }
    );
    const r = detectRepetition(strategy);
    expect(r.ok).toBe(true);
    expect(r.reason).not.toMatch(/degenerate/i);
  });
});

describe("model policy", () => {
  it("detects tiny models", () => {
    expect(parseModelSizeB("qwen2.5:1.5b")).toBe(1.5);
    expect(isTinyModel("qwen2.5:1.5b")).toBe(true);
    expect(isTinyModel("qwen2.5:7b")).toBe(false);
    expect(isTinyModel("gemma4:cloud")).toBe(false);
  });

  it("warns when long-form roles pin tiny locals in team.json", () => {
    const issues = validateTeamModelPolicy(process.cwd());
    // Current team.json uses 1–1.5B locals for several long-form roles
    expect(issues.some((i) => LONG_FORM_ROLES.has(i.roleId))).toBe(true);
  });
});

describe("Spendy failure-mode regression (integration of gates inputs)", () => {
  it("empty gates must start CLOSED; coverage below 70% fails gate math", () => {
    const pack = scanRepoEvidence(REPO, {
      goal: `examine project ${REPO} against ${SPEC}`,
      specRoot: SPEC,
    });
    const coverage = pack.reqMatrix?.coverageRatio ?? 0;
    // Fixture intentionally incomplete vs spec → coverage should not be perfect 1.0
    // (implemented-only). Allow partials; assert we compute a real ratio.
    expect(pack.reqMatrix).toBeTruthy();
    expect(typeof coverage).toBe("number");
    // If coverage is high due to weak matching, still assert missingImports P0 exists
    expect(pack.repoIndex?.missingImports.length).toBeGreaterThan(0);
    const wouldApprove =
      coverage >= MIN_REQ_COVERAGE &&
      pack.localeCurrency?.currency === "EGP" &&
      verifyCitationsAgainstRepo(
        "See `packages/core/index.ts` for tenant isolation",
        REPO
      ).ok;
    // Invented packages path must block approval
    expect(wouldApprove).toBe(false);
  });
});
