/**
 * Phase 2 grounded-audit: stall detector, claim sanitizer, checklist,
 * pack completeness on rejection.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { fileURLToPath } from "url";
import {
  detectStall,
  draftHash,
  draftSimilarity,
  MAX_CONSECUTIVE_STALLS,
  STALL_SIMILARITY_THRESHOLD,
} from "../src/agency/stallDetect.js";
import {
  sanitizeDraftClaims,
  verifyCitationsAgainstRepo,
} from "../src/agency/claimVerify.js";
import {
  runAuditChecklist,
  scanMissingHandlers,
} from "../src/agency/auditChecklist.js";
import { scanRepoEvidence } from "../src/agency/evidence.js";
import { indexRepo } from "../src/agency/repoIndex.js";
import { ingestSpecFolder } from "../src/agency/specIngest.js";
import { searchCodeForReq } from "../src/agency/reqTrace.js";
import { routeAfterAudit } from "../src/agency/reviewGraph.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, "fixtures", "grounded-audit");
const REPO = path.join(FIX, "spendy-repo");
const SPEC = path.join(FIX, "spendy-spec");

describe("stall detector", () => {
  it("flags byte-identical drafts as stalled", () => {
    const a = "Gap matrix for Spendy with EGP and mock-data findings.\n".repeat(20);
    const b = a;
    const r = detectStall(a, b);
    expect(r.identical).toBe(true);
    expect(r.stalled).toBe(true);
    expect(r.hashA).toBe(r.hashB);
    expect(draftHash(a)).toBe(draftHash(b));
  });

  it("flags near-identical drafts above 0.95 similarity", () => {
    const a = Array.from({ length: 40 }, (_, i) => `Finding line ${i} about Spendy EGP auth gaps.`).join(
      "\n"
    );
    const b = a.replace("Finding line 3", "Finding line 3x");
    expect(draftSimilarity(a, b)).toBeGreaterThanOrEqual(STALL_SIMILARITY_THRESHOLD);
    expect(detectStall(a, b).stalled).toBe(true);
  });

  it("does not stall on materially different drafts", () => {
    const a = "Strategy about booking types and clinic QR invoices.";
    const b =
      "Grounded gap report: mockData.js, missing @supabase/supabase-js, logout without onPress, stack Flutter vs Expo.";
    expect(detectStall(a, b).stalled).toBe(false);
  });

  it("routeAfterAudit fails after MAX_CONSECUTIVE_STALLS", () => {
    expect(MAX_CONSECUTIVE_STALLS).toBe(2);
    expect(
      routeAfterAudit({ auditPassed: false, loop: 2, stallCount: 2 })
    ).toBe("failed");
    expect(
      routeAfterAudit({ auditPassed: false, loop: 2, stallCount: 1 })
    ).toBe("remediate");
  });
});

describe("claim path verifier + currency sanitizer", () => {
  it("rejects packages/ and apps/web that do not exist", () => {
    const text =
      "Implement in `packages/mobile/src/foo.ts` and `apps/web/pages/index.tsx`. Real: `src/data/mockData.js`.";
    const v = verifyCitationsAgainstRepo(text, REPO);
    expect(v.missing.some((m) => /packages\//.test(m.raw))).toBe(true);
    expect(v.missing.some((m) => /apps\/web/.test(m.raw))).toBe(true);
  });

  it("strips missing paths and replaces SAR with EGP", () => {
    const draft = [
      "Currency should be SAR for Gulf users.",
      "See `packages/core/index.ts` and apps/web for tenant isolation.",
      "Also `src/data/mockData.js` uses EGP already.",
    ].join("\n");
    const s = sanitizeDraftClaims(draft, REPO, "EGP");
    expect(s.removedCurrencies.length).toBeGreaterThan(0);
    expect(s.text).not.toMatch(/\bSAR\b/);
    expect(s.text).toMatch(/EGP/);
    expect(s.removedPaths.some((p) => /packages\//.test(p))).toBe(true);
    expect(s.text).toMatch(/REMOVED: path not found/);
  });
});

describe("audit checklist — handlers + stack conflict", () => {
  it("detects Pressable without onPress (logout)", () => {
    const findings = scanMissingHandlers(REPO);
    expect(findings.some((f) => /onPress/i.test(f.summary))).toBe(true);
    expect(findings.some((f) => /HomeScreen|Logout|Pressable/i.test(f.summary + f.detail))).toBe(
      true
    );
  });

  it("detects Flutter/FastAPI spec vs Expo/RN repo stack conflict", async () => {
    const spec = await ingestSpecFolder(SPEC);
    const index = indexRepo(REPO);
    const blob = [
      ...spec.requirements.map((r) => r.text),
      ...spec.rawChunks.map((c) => c.text),
    ].join("\n");
    expect(/flutter|fastapi/i.test(blob)).toBe(true);
    const checklist = runAuditChecklist({
      targetRepo: REPO,
      index,
      spec,
      specTextBlob: blob,
      localeCurrency: { locale: "ar-EG", currency: "EGP", source: "code", evidence: [] },
    });
    expect(checklist.stackConflict || checklist.findings.some((f) => f.category === "stack_conflict")).toBe(
      true
    );
    expect(checklist.findings.some((f) => f.category === "dependency")).toBe(true);
    expect(checklist.findings.some((f) => f.category === "mock_data")).toBe(true);
  });

  it("search_code-style REQ scan returns paths for mock/auth tokens", () => {
    const pack = scanRepoEvidence(REPO, { goal: `examine ${REPO}`, specRoot: SPEC });
    expect(pack.reqMatrix).toBeTruthy();
    // Ensure search helper works on fixture bodies
    const bodies = new Map<string, string>();
    bodies.set(
      "src/screens/HomeScreen.js",
      fs.readFileSync(path.join(REPO, "src/screens/HomeScreen.js"), "utf-8")
    );
    const hit = searchCodeForReq(bodies, "MUST wire real authentication mock");
    expect(hit.hitCount).toBeGreaterThan(0);
  });
});

describe("pack completeness on rejection", () => {
  let tmp: string;
  let prevCwd: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sam-pack-"));
    prevCwd = process.cwd();
    process.chdir(tmp);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("copies evidence.json, REQ_TRACEABILITY.md, gates.json into pack dir", () => {
    // Simulate cwd artifacts after a failed audit
    fs.writeFileSync("evidence.json", JSON.stringify({ version: 2, findings: [] }), "utf-8");
    fs.writeFileSync("REQ_TRACEABILITY.md", "# REQ matrix\n", "utf-8");
    fs.writeFileSync(
      "gates.json",
      JSON.stringify({ latest: { gate: "CLOSED", auditPassed: false } }),
      "utf-8"
    );
    fs.writeFileSync("evidence-pack.md", "# evidence\n", "utf-8");
    fs.writeFileSync("final-report.md", "# FAILED_AUDIT_GATE\n", "utf-8");

    const packDir = path.join(tmp, "Sam-Harness no.99");
    fs.mkdirSync(packDir, { recursive: true });
    const packFiles = [
      "evidence-pack.md",
      "evidence.json",
      "REQ_TRACEABILITY.md",
      "gates.json",
      "final-report.md",
    ];
    for (const name of packFiles) {
      if (fs.existsSync(name)) fs.copyFileSync(name, path.join(packDir, name));
    }
    for (const name of packFiles) {
      expect(fs.existsSync(path.join(packDir, name))).toBe(true);
    }
    const gates = JSON.parse(fs.readFileSync(path.join(packDir, "gates.json"), "utf-8"));
    expect(gates.latest.gate).toBe("CLOSED");
  });
});
