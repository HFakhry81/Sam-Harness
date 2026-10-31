/**
 * Phase 3 grounded-audit: fidelity rubric, claim rewrite/clean-delete,
 * pack assertions, per-run gates isolation.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { fileURLToPath } from "url";
import {
  assertCleanPackClaims,
  GROUNDED_FIDELITY_THRESHOLD,
  keywordHitInfo,
  scoreGroundedAuditRubric,
} from "../src/agency/fidelityRubric.js";
import {
  buildClaimRewritePrompt,
  detectInvalidClaims,
  finalizeClaimsClean,
  sanitizeDraftClaims,
} from "../src/agency/claimVerify.js";
import {
  appendGateEntry,
  appendModelErrorsToEvidence,
  logModelClaimErrors,
  readGates,
  resetGatesForRun,
} from "../src/agency/gatesStore.js";
import { scanRepoEvidence } from "../src/agency/evidence.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, "fixtures", "grounded-audit");
const REPO = path.join(FIX, "spendy-repo");
const SPEC = path.join(FIX, "spendy-spec");

describe("fidelity rubric scoring", () => {
  let tmp: string;
  let prevCwd: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sam-rubric-"));
    prevCwd = process.cwd();
    process.chdir(tmp);
    fs.writeFileSync("evidence.json", JSON.stringify({ version: 2 }), "utf-8");
    fs.writeFileSync("evidence-pack.md", "# Evidence\n", "utf-8");
    fs.writeFileSync("REQ_TRACEABILITY.md", "# REQ\n", "utf-8");
    fs.writeFileSync("ceo-draft.md", "# draft\n", "utf-8");
  });

  afterEach(() => {
    process.chdir(prevCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("threshold is 0.8 and keyword hits are informational only", () => {
    expect(GROUNDED_FIDELITY_THRESHOLD).toBe(0.8);
    const kw = keywordHitInfo(
      "examine upnexa.com spendy against documents and produce reports",
      "Gap matrix with EGP and mockData findings."
    );
    expect(kw.total).toBeGreaterThan(0);
    // Keyword ratio alone must not be the gate
    expect(typeof kw.ratio).toBe("number");
  });

  it("scores passed/total against task rubric — full strategy passes", () => {
    const strategy = [
      "## Gap matrix",
      "Specs read from requirements.md covering REQ-001 auth and REQ-002 EGP.",
      "Code cites `src/data/mockData.js` and HomeScreen supabase gaps.",
      "## Stack conflict",
      "Spec wants Flutter/FastAPI; repo is Expo/React Native.",
      "## Findings",
      "[P0] Auth not wired — mockData only.",
      "[P1] Missing @supabase/supabase-js dependency.",
      "## Recommendations / next actions",
      "Should install @supabase/supabase-js and wire real auth.",
      "Should add onPress to logout Pressable.",
    ].join("\n");

    const r = scoreGroundedAuditRubric({
      strategy,
      evidenceMarkdown: "Spec root: spendy-spec\nCitable file hits: mockData",
      specsReadCount: 2,
      reqRows: [
        { id: "REQ-001", status: "missing", codePaths: [] },
        { id: "REQ-002", status: "partial", codePaths: ["src/data/mockData.js"] },
      ],
      findings: [
        { severity: "P0", summary: "auth not wired" },
        { severity: "P1", summary: "missing dep" },
      ],
      cwd: tmp,
    });
    expect(r.applicableCount).toBe(7);
    expect(r.passedCount).toBe(7);
    expect(r.score).toBe(1);
    expect(r.passed).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(GROUNDED_FIDELITY_THRESHOLD);
  });

  it("fails when stack conflict / recommendations / P0 are missing", () => {
    const strategy = "Short note about spendy with REQ-001 status missing.";
    const r = scoreGroundedAuditRubric({
      strategy,
      evidenceMarkdown: "",
      specsReadCount: 0,
      reqRows: [{ id: "REQ-001", status: "missing", codePaths: [] }],
      findings: [],
      cwd: tmp,
    });
    expect(r.passed).toBe(false);
    expect(r.score).toBeLessThan(GROUNDED_FIDELITY_THRESHOLD);
    const failed = r.items.filter((i) => i.applicable && !i.passed).map((i) => i.id);
    expect(failed).toContain("specs_read");
    expect(failed).toContain("stack_conflict_section");
    expect(failed).toContain("prioritized_findings");
    expect(failed).toContain("recommendations");
  });

  it("Spendy fixture evidence feeds rubric req + specs counts", () => {
    const pack = scanRepoEvidence(REPO, {
      goal: `examine ${REPO} against ${SPEC}`,
      specRoot: SPEC,
    });
    expect(pack.spec?.filesRead.length).toBeGreaterThan(0);
    expect(pack.reqMatrix?.rows.length).toBeGreaterThan(0);
    const strategy = [
      "## Stack conflict: Flutter/FastAPI vs Expo",
      "REQ-001 missing — cite requirements.md.",
      "`src/data/mockData.js` is mock-only.",
      "[P0] Auth not wired. [P1] Missing supabase dep.",
      "## Recommendations",
      "Should wire auth and install @supabase/supabase-js.",
    ].join("\n");
    const r = scoreGroundedAuditRubric({
      strategy,
      evidenceMarkdown: pack.summaryMarkdown,
      specsReadCount: pack.spec?.filesRead.length || 0,
      reqRows: (pack.reqMatrix?.rows || []).map((row) => ({
        id: row.id,
        status: row.status,
        codePaths: row.codePaths,
      })),
      findings: (pack.checklist?.findings || []).map((f) => ({
        severity: f.severity,
        summary: f.summary,
      })),
      cwd: tmp,
    });
    expect(r.items.find((i) => i.id === "specs_read")?.passed).toBe(true);
    expect(r.items.find((i) => i.id === "req_status")?.passed).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(GROUNDED_FIDELITY_THRESHOLD);
  });
});

describe("claim sanitizer rewrite flow — no placeholders", () => {
  it("sanitizeDraftClaims leaves text intact and asks for rewrite", () => {
    const draft =
      "Use SAR pricing. Implement in `packages/mobile/foo.ts` and apps/web. Real: `src/data/mockData.js`.";
    const s = sanitizeDraftClaims(draft, REPO, "EGP");
    expect(s.needsRewrite).toBe(true);
    expect(s.text).toBe(draft);
    expect(s.text).toContain("SAR");
    expect(s.modelErrors.length).toBeGreaterThan(0);
    expect(s.rewritePrompt).toMatch(/INVALID CLAIMS/);
    expect(s.rewritePrompt).not.toMatch(/replace SAR with EGP/i);
  });

  it("buildClaimRewritePrompt includes grounded facts and bans [REMOVED]", () => {
    const invalid = detectInvalidClaims(
      "SAR and `packages/x.ts` are wrong.",
      REPO,
      "EGP"
    ).invalid;
    const prompt = buildClaimRewritePrompt({
      draft: "SAR and packages/x",
      invalid,
      groundedCurrency: "EGP",
      evidenceClip: "src/data/mockData.js uses EGP",
    });
    expect(prompt).toMatch(/GROUNDED CURRENCY: EGP/);
    expect(prompt).toMatch(/Do NOT write the tokens \[REMOVED\]/);
    expect(prompt).toMatch(/mockData/);
  });

  it("finalizeClaimsClean deletes sentences — zero SAR/packages/apps/web/[REMOVED]", () => {
    const draft = [
      "Gulf tenants should pay in SAR.",
      "Put shared code under `packages/core/index.ts`.",
      "Ship the portal via apps/web next week.",
      "Grounded fact: `src/data/mockData.js` already uses EGP.",
    ].join("\n");
    const cleaned = finalizeClaimsClean(draft, REPO, "EGP");
    expect(cleaned.text).not.toMatch(/\bSAR\b/);
    expect(cleaned.text).not.toMatch(/packages\//i);
    expect(cleaned.text).not.toMatch(/apps\/web/i);
    expect(cleaned.text).not.toMatch(/\[REMOVED\]/i);
    expect(cleaned.text).toMatch(/mockData\.js/);
    expect(assertCleanPackClaims(cleaned.text).ok).toBe(true);
  });

  it("assertCleanPackClaims fails loudly on forbidden residues", () => {
    expect(assertCleanPackClaims("hello SAR world").ok).toBe(false);
    expect(assertCleanPackClaims("see packages/foo").violations).toContain("packages/");
    expect(assertCleanPackClaims("apps/web portal").violations).toContain("apps/web");
    expect(assertCleanPackClaims("was [REMOVED] here").violations).toContain("[REMOVED]");
    expect(assertCleanPackClaims("EGP and src/data/mockData.js only").ok).toBe(true);
  });

  it("never auto-substitutes SAR with EGP", () => {
    const draft = "Currency is SAR in the Gulf edition.";
    const s = sanitizeDraftClaims(draft, REPO, "EGP");
    expect(s.text).toContain("SAR");
    expect(s.text).not.toMatch(/\bEGP\b/);
    const cleaned = finalizeClaimsClean(draft, REPO, "EGP");
    // Sentence deleted entirely — not rewritten to EGP
    expect(cleaned.text).not.toMatch(/\bSAR\b/);
    expect(cleaned.text).not.toMatch(/Egyptian Pound/);
  });
});

describe("per-run gates.json isolation", () => {
  let tmp: string;
  let prevCwd: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sam-gates-"));
    prevCwd = process.cwd();
    process.chdir(tmp);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("resetGatesForRun starts a fresh document keyed by runId", () => {
    const a = resetGatesForRun("run-alpha");
    expect(a.runId).toBe("run-alpha");
    expect(a.gates).toEqual([]);
    appendGateEntry(
      {
        at: new Date().toISOString(),
        loop: 1,
        gate: "CLOSED",
        auditPassed: false,
        goalPassed: false,
        rejectReasons: ["loop1"],
      },
      "run-alpha"
    );
    appendGateEntry(
      {
        at: new Date().toISOString(),
        loop: 2,
        gate: "CLOSED",
        auditPassed: false,
        goalPassed: false,
        rejectReasons: ["loop2"],
      },
      "run-alpha"
    );
    const mid = readGates();
    expect(mid?.runId).toBe("run-alpha");
    expect(mid?.gates.length).toBe(2);

    // New pack/run must not inherit prior loops
    const b = resetGatesForRun("run-beta");
    expect(b.runId).toBe("run-beta");
    expect(b.gates.length).toBe(0);
    expect(b.modelErrors.length).toBe(0);
    appendGateEntry(
      {
        at: new Date().toISOString(),
        loop: 1,
        gate: "OPEN",
        auditPassed: true,
        goalPassed: true,
      },
      "run-beta"
    );
    const after = readGates();
    expect(after?.runId).toBe("run-beta");
    expect(after?.gates.length).toBe(1);
    expect(after?.gates[0].loop).toBe(1);
    expect(after?.gates.some((g) => g.rejectReasons?.includes("loop1"))).toBe(false);
  });

  it("appendGateEntry with a new runId resets instead of appending", () => {
    resetGatesForRun("run-3");
    appendGateEntry(
      {
        at: new Date().toISOString(),
        loop: 3,
        gate: "CLOSED",
        auditPassed: false,
        goalPassed: false,
      },
      "run-3"
    );
    // Simulate next pack starting without explicit reset — append with new id
    appendGateEntry(
      {
        at: new Date().toISOString(),
        loop: 1,
        gate: "CLOSED",
        auditPassed: false,
        goalPassed: false,
      },
      "run-4"
    );
    const doc = readGates();
    expect(doc?.runId).toBe("run-4");
    expect(doc?.gates.length).toBe(1);
    expect(doc?.gates[0].loop).toBe(1);
  });

  it("logs model claim errors into gates.json and evidence.json", () => {
    resetGatesForRun("run-err");
    fs.writeFileSync("evidence.json", JSON.stringify({ version: 2, hits: [] }), "utf-8");
    logModelClaimErrors(
      [
        {
          at: new Date().toISOString(),
          kind: "invalid_currency",
          claim: "SAR",
          detail: "conflicts with EGP",
          loop: 1,
        },
        {
          at: new Date().toISOString(),
          kind: "invalid_path",
          claim: "packages/core",
          detail: "path does not exist",
          loop: 1,
        },
      ],
      "run-err"
    );
    const gates = readGates();
    expect(gates?.runId).toBe("run-err");
    expect(gates?.modelErrors.length).toBe(2);
    expect(gates?.modelErrors.some((e) => e.claim === "SAR")).toBe(true);
    const evidence = JSON.parse(fs.readFileSync("evidence.json", "utf-8"));
    expect(evidence.modelErrors.length).toBe(2);
    appendModelErrorsToEvidence([
      {
        at: new Date().toISOString(),
        kind: "placeholder",
        claim: "[REMOVED]",
        detail: "must never appear",
      },
    ]);
    const evidence2 = JSON.parse(fs.readFileSync("evidence.json", "utf-8"));
    expect(evidence2.modelErrors.length).toBe(3);
  });

  it("keeps a stable runId across batched model-error appends without explicit id", () => {
    resetGatesForRun("run-stable");
    // No explicit runId — must reuse gates.json runId, not mint a new Date.now() id
    logModelClaimErrors([
      {
        at: new Date().toISOString(),
        kind: "invalid_currency",
        claim: "SAR",
        detail: "a",
      },
      {
        at: new Date().toISOString(),
        kind: "invalid_path",
        claim: "packages/x",
        detail: "b",
      },
      {
        at: new Date().toISOString(),
        kind: "other",
        claim: "apps/web",
        detail: "c",
      },
    ]);
    const gates = readGates();
    expect(gates?.runId).toBe("run-stable");
    expect(gates?.modelErrors.length).toBe(3);
  });
});
