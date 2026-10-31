/**
 * Phase 10: feature-level REQ extraction (not section headings), kind
 * classification, near-duplicate merge, Arabic encoding, pack cwd isolation.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { fileURLToPath } from "url";
import {
  areNearDuplicateReqs,
  classifyReqKind,
  decodeSpecBuffer,
  dedupeRequirements,
  docxXmlToText,
  extractRequirementsHeuristic,
  ingestSpecFolder,
  isDocumentOnlyRequirement,
  isNoiseRequirementLine,
  MAX_FEATURE_REQS,
  normalizeReqText,
  preserveUnicodeText,
} from "../src/agency/specIngest.js";
import { isSpecHeadingNotRequirement } from "../src/agency/pathFilters.js";
import {
  buildReqTraceMatrix,
  distinctiveReqTokens,
  MAX_EVIDENCE_PATHS_PER_REQ,
} from "../src/agency/reqTrace.js";
import { indexRepo } from "../src/agency/repoIndex.js";
import {
  __setPackWriteRootForTests,
  assertNoPackFilesInCwd,
  PACK_CWD_FORBIDDEN,
  packArtifactExists,
  packArtifactPath,
  writePackArtifact,
} from "../src/lib/packWorkspace.js";
import { resetGatesForRun } from "../src/agency/gatesStore.js";
import { writeGoNoGoTemplate } from "../src/agency/delivery/goNoGo.js";
import { saveBoard } from "../src/agency/delivery/store.js";
import type { DeliveryBoard } from "../src/agency/delivery/types.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, "fixtures", "grounded-audit");
const FEATURE_SPEC = path.join(FIX, "feature-extract-spec");
const JUNK_REPO = path.join(FIX, "junk-paths-repo");
const HEADING_SPEC = path.join(FIX, "heading-reqs-spec");
const IDF_REPO = path.join(FIX, "idf-partial-repo");
const IDF_SPEC = path.join(FIX, "idf-partial-spec");

describe("feature-level REQ extraction", () => {
  it("extracts feature bullets and marks document headings as document_only / n/a", async () => {
    const spec = await ingestSpecFolder(FEATURE_SPEC);
    expect(spec.requirements.length).toBeGreaterThanOrEqual(8);

    const features = spec.requirements.filter((r) => r.kind === "feature");
    const docs = spec.requirements.filter((r) => r.kind === "document_only");

    // Feature capabilities present
    expect(features.some((r) => /add expense/i.test(r.text))).toBe(true);
    expect(features.some((r) => /multi-?wallet/i.test(r.text))).toBe(true);
    expect(features.some((r) => /categor/i.test(r.text))).toBe(true);
    expect(features.some((r) => /budget/i.test(r.text))).toBe(true);
    expect(features.some((r) => /report|chart/i.test(r.text))).toBe(true);
    expect(features.some((r) => /team member|permission/i.test(r.text))).toBe(
      true
    );
    expect(features.some((r) => /otp/i.test(r.text))).toBe(true);
    expect(features.some((r) => /offline|cache/i.test(r.text))).toBe(true);
    expect(features.some((r) => /voice/i.test(r.text))).toBe(true);
    expect(features.some((r) => /ocr|receipt/i.test(r.text))).toBe(true);
    expect(features.some((r) => /EGP/i.test(r.text))).toBe(true);

    // Bare section headings must not become feature REQs
    for (const bad of [
      "Project Overview",
      "Functional Requirements Analysis",
      "Implementation Roadmap",
      "Estimated Costs & Infrastructure",
      "UI/UX Design Guidelines",
      "API Endpoints Design",
      "Voice-to-Expense Module",
    ]) {
      expect(
        features.some(
          (r) => normalizeReqText(r.text) === normalizeReqText(bad)
        )
      ).toBe(false);
      expect(isDocumentOnlyRequirement(bad)).toBe(true);
      expect(isSpecHeadingNotRequirement(bad)).toBe(true);
    }

    const matrix = buildReqTraceMatrix(
      spec.requirements,
      indexRepo(JUNK_REPO),
      []
    );
    // document_only rows are n/a and excluded from eligible coverage
    for (const r of matrix.rows.filter((x) => x.kind === "document_only")) {
      expect(r.status).toBe("n/a");
    }
    expect(matrix.eligibleCount).toBe(
      matrix.rows.filter((r) => r.status !== "n/a").length
    );
    expect(matrix.eligibleCount).toBeGreaterThanOrEqual(features.length - 2);

    // Non-functional security → unverified or evidence-backed, not raw missing inflation alone
    const sec = matrix.rows.find((r) => /encrypt|security/i.test(r.text));
    if (sec) {
      expect(["unverified", "partial", "implemented", "missing"]).toContain(
        sec.status
      );
      expect(sec.kind).toBe("non_functional");
    }
  });

  it("dedupes near-identical multi-wallet REQs and keeps all source citations", () => {
    const merged = dedupeRequirements([
      {
        text: "MUST provide multi-wallet support with balance per wallet",
        sourceFile: "a.md",
        section: "Features",
        kind: "feature",
      },
      {
        text: "MUST support multi-wallet balances across accounts",
        sourceFile: "b.md",
        section: "Wallets",
        kind: "feature",
      },
      {
        text: "API Endpoints Design",
        sourceFile: "a.md",
        section: "API",
        kind: "document_only",
      },
      {
        text: "API Endpoints Design",
        sourceFile: "b.md",
        section: "API",
        kind: "document_only",
      },
    ]);
    expect(
      areNearDuplicateReqs(
        "MUST provide multi-wallet support with balance per wallet",
        "MUST support multi-wallet balances across accounts"
      )
    ).toBe(true);
    const wallet = merged.filter((r) => /wallet/i.test(r.text));
    expect(wallet.length).toBe(1);
    expect(wallet[0].sources.length).toBe(2);
    const api = merged.filter((r) => /api endpoints/i.test(r.text));
    expect(api.length).toBe(1);
    expect(api[0].sources.length).toBe(2);
  });

  it("heading-reqs fixture yields feature MUST lines, not bare heading features", async () => {
    const spec = await ingestSpecFolder(HEADING_SPEC);
    const features = spec.requirements.filter((r) => r.kind === "feature");
    expect(features.some((r) => /voice/i.test(r.text))).toBe(true);
    expect(features.some((r) => /ocr/i.test(r.text))).toBe(true);
    expect(features.some((r) => /EGP/i.test(r.text))).toBe(true);
    expect(
      features.every(
        (r) =>
          !isDocumentOnlyRequirement(r.text) &&
          !isSpecHeadingNotRequirement(r.text)
      )
    ).toBe(true);
    // Bare heading bullets skipped at extract time
    expect(
      spec.requirements.some(
        (r) => normalizeReqText(r.text) === "project overview"
      )
    ).toBe(false);
  });

  it("extracts Word list paragraphs (w:numPr) from .docx and skips module headings", async () => {
    const docxPath = path.join(FEATURE_SPEC, "word-lists.docx");
    expect(fs.existsSync(docxPath)).toBe(true);
    const spec = await ingestSpecFolder(docxPath);
    const features = spec.requirements.filter((r) => r.kind === "feature");
    expect(features.some((r) => /add expense/i.test(r.text))).toBe(true);
    expect(features.some((r) => /multi-?wallet/i.test(r.text))).toBe(true);
    expect(features.some((r) => /otp/i.test(r.text))).toBe(true);
    expect(features.some((r) => /voice/i.test(r.text))).toBe(true);
    expect(features.some((r) => /ocr|receipt/i.test(r.text))).toBe(true);
    expect(features.some((r) => /EGP/i.test(r.text))).toBe(true);
    // Section headings must not be feature REQs
    for (const h of [
      "Database Architecture (Multi-Wallet & Teams)",
      "System Architecture & Tech Stack",
      "OCR & Receipt Scanning Module",
      "Team & Permissions Module",
      "Security & Compliance",
    ]) {
      expect(isDocumentOnlyRequirement(h)).toBe(true);
      expect(
        features.some((r) => normalizeReqText(r.text) === normalizeReqText(h))
      ).toBe(false);
    }
  });

  it("docxXmlToText prefixes w:numPr / ListParagraph with '- '", () => {
    const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Features</w:t></w:r></w:p>
      <w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Add expense with amount</w:t></w:r></w:p>
      <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>OTP login</w:t></w:r></w:p>
    </w:body></w:document>`;
    const text = docxXmlToText(xml);
    expect(text).toContain("# Features");
    expect(text).toMatch(/^- Add expense with amount$/m);
    expect(text).toMatch(/^- OTP login$/m);
  });
});

describe("Arabic encoding for REQ titles", () => {
  it("decodes UTF-8 BOM, UTF-16 LE, Windows-1256, and mojibake", () => {
    const utf8 = fs.readFileSync(
      path.join(FEATURE_SPEC, "arabic-utf8.txt")
    );
    const utf16 = fs.readFileSync(
      path.join(FEATURE_SPEC, "arabic-utf16.txt")
    );
    const cp1256 = fs.readFileSync(
      path.join(FEATURE_SPEC, "arabic-cp1256.txt")
    );
    const mojibake = fs.readFileSync(
      path.join(FEATURE_SPEC, "arabic-mojibake.txt")
    );

    const t8 = decodeSpecBuffer(utf8);
    const t16 = decodeSpecBuffer(utf16);
    const t1256 = decodeSpecBuffer(cp1256);
    const tFix = decodeSpecBuffer(mojibake);

    expect(t8).toMatch(/[\u0600-\u06FF]/);
    expect(t16).toMatch(/[\u0600-\u06FF]/);
    expect(t1256).toMatch(/[\u0600-\u06FF]/);
    expect(tFix).toMatch(/[\u0600-\u06FF]/);
    // Must not leave classic mojibake markers as the only content
    expect(tFix).not.toMatch(/^Ø|^Ù/);
  });

  it("never reinterprets valid UTF-8 Arabic as Windows-1256", () => {
    const utf8Features = fs.readFileSync(
      path.join(FEATURE_SPEC, "arabic-features-utf8.txt")
    );
    const decoded = decodeSpecBuffer(utf8Features);
    expect(decoded).toContain("يمكن إضافة مصروف");
    expect(decoded).not.toMatch(/Ø.|Ù./);
    // Strict UTF-8 must win even though high bytes look CP1256-ish
    expect(decoded).toMatch(/[\u0600-\u06FF]{4,}/);
  });

  it("ingests Arabic REQ titles intact from UTF-8 and CP1256 .txt", async () => {
    const spec = await ingestSpecFolder(FEATURE_SPEC);
    const arabic = spec.requirements.filter((r) =>
      /[\u0600-\u06FF]/.test(r.text)
    );
    expect(arabic.length).toBeGreaterThanOrEqual(2);
    for (const r of arabic) {
      expect(r.text).toMatch(/[\u0600-\u06FF]/);
      expect(r.text).not.toMatch(/Ø.|Ù./);
      expect(classifyReqKind(r.text)).not.toBe("document_only");
    }
    expect(arabic.some((r) => /مصروف/.test(r.text))).toBe(true);
    expect(arabic.some((r) => /محافظ/.test(r.text))).toBe(true);
  });
});

describe("pack artifacts never land in cwd", () => {
  let tmpPack: string;
  let tmpCwd: string;
  let prevCwd: string;

  beforeEach(() => {
    tmpPack = fs.mkdtempSync(path.join(os.tmpdir(), "sam-pack-ws-"));
    tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), "sam-cwd-"));
    prevCwd = process.cwd();
    process.chdir(tmpCwd);
    __setPackWriteRootForTests(tmpPack);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    __setPackWriteRootForTests(null);
    fs.rmSync(tmpPack, { recursive: true, force: true });
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  });

  it("writePackArtifact + gates write under pack workspace, not cwd", () => {
    const written = [
      "REQ_TRACEABILITY.md",
      "AUDIT_CHECKLIST.md",
      "agency-verdict.md",
      "evidence.json",
      "gates.json",
    ];
    writePackArtifact("REQ_TRACEABILITY.md", "# matrix\n");
    writePackArtifact("AUDIT_CHECKLIST.md", "# checklist\n");
    writePackArtifact("agency-verdict.md", "# verdict\n");
    writePackArtifact("evidence.json", JSON.stringify({ version: 2 }));
    resetGatesForRun("run-cwd-isolation");

    for (const name of written) {
      expect(fs.existsSync(path.join(tmpCwd, name))).toBe(false);
      expect(packArtifactExists(name)).toBe(true);
      expect(fs.existsSync(packArtifactPath(name))).toBe(true);
    }
    // Markdown gets UTF-8 BOM for Windows Notepad-friendly reads
    const bom = fs.readFileSync(packArtifactPath("REQ_TRACEABILITY.md"));
    expect(bom[0]).toBe(0xef);
    expect(bom[1]).toBe(0xbb);
    expect(bom[2]).toBe(0xbf);

    const check = assertNoPackFilesInCwd(tmpCwd);
    expect(check.ok).toBe(true);
    expect(check.found).toEqual([]);
    // Expanded forbidden list includes delivery-board / go-nogo names
    expect(PACK_CWD_FORBIDDEN).toEqual(
      expect.arrayContaining([
        "delivery-board.json",
        "DELIVERY_BOARD.md",
        "go-nogo.example.json",
      ])
    );
  });

  it("extractRequirementsHeuristic does not write any files", () => {
    const before = new Set(fs.readdirSync(tmpCwd));
    extractRequirementsHeuristic([
      {
        file: "spec.md",
        section: "Features",
        text: "- MUST support OTP login\n- Project Overview\n",
      },
    ]);
    expect(fs.readdirSync(tmpCwd).sort()).toEqual([...before].sort());
  });

  it("delivery-board / go-nogo.example write to pack workspace, not cwd", () => {
    writeGoNoGoTemplate();
    const board: DeliveryBoard = {
      version: 1,
      engagementId: "eng-test",
      targetRepo: tmpCwd,
      updatedAt: new Date().toISOString(),
      goNoGo: {
        decision: "PENDING",
        by: "system",
        at: new Date().toISOString(),
        reason: "test",
      },
      tickets: [],
    };
    saveBoard(board);

    for (const name of [
      "delivery-board.json",
      "DELIVERY_BOARD.md",
      "go-nogo.example.json",
    ]) {
      expect(fs.existsSync(path.join(tmpCwd, name))).toBe(false);
      expect(packArtifactExists(name)).toBe(true);
    }
    expect(assertNoPackFilesInCwd(tmpCwd).ok).toBe(true);
  });
});

describe("noise filter + feature cap", () => {
  it("drops examples, schema field lists, intro prose, vendor lines, short chips", () => {
    expect(
      isNoiseRequirementLine(
        "This document provides a comprehensive technical blueprint for Spendy"
      )
    ).toBe(true);
    expect(
      isNoiseRequirementLine(
        "Example (English): Spent fifty dollars at Starbucks yesterday"
      )
    ).toBe(true);
    expect(
      isNoiseRequirementLine("id, user_id/team_id, name, type, created_at")
    ).toBe(true);
    expect(
      isNoiseRequirementLine("Speech-to-Text: Deepgram Nova-3 API [^2^]")
    ).toBe(true);
    expect(
      isNoiseRequirementLine(
        "Multi-Wallet ? Voice AI ? Team Collaboration"
      )
    ).toBe(true);
    expect(isNoiseRequirementLine("OCR only")).toBe(true);
    expect(
      isNoiseRequirementLine(
        "MUST provide multi-wallet support with balance per wallet"
      )
    ).toBe(false);
  });

  it("caps feature REQs at MAX_FEATURE_REQS (tens, not hundreds)", async () => {
    expect(MAX_FEATURE_REQS).toBeGreaterThanOrEqual(20);
    expect(MAX_FEATURE_REQS).toBeLessThanOrEqual(80);
    // Force more than MAX_FEATURE_REQS distinct feature candidates through the cap.
    // Avoid shared 6-char stems / "must" so near-dupe merge does not collapse the set.
    const cands = Array.from({ length: MAX_FEATURE_REQS + 25 }, (_, i) => ({
      text: `Ww${i}Axqq Yy${i}Bzrr Cc${i}Ddee Ee${i}Ffgg`,
      sourceFile: "a.md",
      section: "Features",
      kind: "feature" as const,
    }));
    expect(isNoiseRequirementLine(cands[0].text)).toBe(false);
    expect(areNearDuplicateReqs(cands[0].text, cands[1].text)).toBe(false);
    const merged = dedupeRequirements(cands);
    const features = merged.filter((r) => r.kind === "feature");
    expect(features.length).toBe(MAX_FEATURE_REQS);

    // Real fixture stays in the tens, not hundreds
    const spec = await ingestSpecFolder(FEATURE_SPEC);
    const realFeatures = spec.requirements.filter((r) => r.kind === "feature");
    expect(realFeatures.length).toBeLessThanOrEqual(MAX_FEATURE_REQS);
    expect(realFeatures.length).toBeGreaterThan(5);
    expect(realFeatures.every((r) => !isNoiseRequirementLine(r.text))).toBe(
      true
    );
  });
});

describe("IDF-style partial scoring (no generic HomeScreen false partials)", () => {
  it("Bank Integration / NLU stay missing; PDF/Excel reports can be partial; paths capped at 3", async () => {
    const spec = await ingestSpecFolder(IDF_SPEC);
    const index = indexRepo(IDF_REPO);
    const matrix = buildReqTraceMatrix(spec.requirements, index, []);

    const bank = matrix.rows.find((r) => /bank|plaid/i.test(r.text));
    const tax = matrix.rows.find((r) => /pdf|excel|tax/i.test(r.text));
    const nlu = matrix.rows.find((r) => /nlu|vendor/i.test(r.text));

    expect(bank).toBeTruthy();
    expect(tax).toBeTruthy();
    expect(nlu).toBeTruthy();

    // Generic HomeScreen/SettingsScreen words must NOT mint partial for bank/NLU
    expect(bank!.status).toBe("missing");
    expect(bank!.codePaths.length).toBe(0);
    expect(nlu!.status).toBe("missing");
    expect(nlu!.codePaths.length).toBe(0);

    // Tax/PDF/Excel has ReportsScreen with distinctive tokens → code-backed
    expect(["partial", "implemented"]).toContain(tax!.status);
    expect(tax!.codePaths.some((p) => /ReportsScreen/i.test(p))).toBe(true);
    expect(tax!.codePaths.length).toBeLessThanOrEqual(MAX_EVIDENCE_PATHS_PER_REQ);
    expect(tax!.codePaths.some((p) => /HomeScreen|SettingsScreen/i.test(p))).toBe(
      false
    );
    expect(tax!.kind).toBe("feature");
    expect(bank!.kind).toBe("feature");

    // Distinctive tokens drop always-generic amount/date/category/user
    const toks = distinctiveReqTokens(
      "NLU extract amount/vendor from voice utterances"
    );
    expect(toks).not.toContain("amount");
    expect(toks.some((t) => /vendor|voice|nlu/i.test(t))).toBe(true);

    // Audit assessed coverage still 100% when every eligible REQ was searched
    expect(matrix.assessedCoverageRatio).toBe(1);
    expect(matrix.markdown).toMatch(/## By module/);
  });
});

describe("Arabic docx → REQ_TRACEABILITY.md UTF-8 byte round-trip", () => {
  let tmpPack: string;

  beforeEach(() => {
    tmpPack = fs.mkdtempSync(path.join(os.tmpdir(), "sam-ar-rtm-"));
    __setPackWriteRootForTests(tmpPack);
  });

  afterEach(() => {
    __setPackWriteRootForTests(null);
    fs.rmSync(tmpPack, { recursive: true, force: true });
  });

  it("exact Arabic string from real docx lands in REQ_TRACEABILITY.md bytes", async () => {
    const arabicLine = "يمكن إضافة مصروف بالمحفظة";
    const docxPath = path.join(FEATURE_SPEC, "arabic-features.docx");
    expect(fs.existsSync(docxPath)).toBe(true);

    const spec = await ingestSpecFolder(docxPath);
    const hit = spec.requirements.find((r) => r.text.includes(arabicLine));
    expect(hit).toBeTruthy();
    expect(hit!.text).toBe(arabicLine);
    // Must be real Arabic codepoints, not ØÙ mojibake
    expect(hit!.text).toMatch(/[\u0600-\u06FF]/);
    expect(hit!.text).not.toMatch(/Ø.|Ù./);
    expect(preserveUnicodeText(hit!.text)).toBe(arabicLine);

    const matrix = buildReqTraceMatrix(
      spec.requirements,
      indexRepo(JUNK_REPO),
      []
    );
    expect(matrix.markdown).toContain(arabicLine);

    writePackArtifact("REQ_TRACEABILITY.md", matrix.markdown, { bom: true });
    const bytes = fs.readFileSync(packArtifactPath("REQ_TRACEABILITY.md"));
    // UTF-8 BOM
    expect(bytes[0]).toBe(0xef);
    expect(bytes[1]).toBe(0xbb);
    expect(bytes[2]).toBe(0xbf);
    // Exact UTF-8 sequence for the Arabic REQ title must appear in file bytes
    const needle = Buffer.from(arabicLine, "utf8");
    expect(bytes.includes(needle)).toBe(true);
    // Classic mojibake UTF-8 of ØÙ… must NOT appear as the title encoding
    const mojibakeNeedle = Buffer.from(
      Buffer.from(arabicLine, "utf8").toString("latin1"),
      "utf8"
    );
    // File may contain other latin1-looking bytes; assert the decoded markdown is clean
    const decoded = bytes.subarray(3).toString("utf8");
    expect(decoded).toContain(arabicLine);
    expect(decoded).not.toContain(Buffer.from(arabicLine, "utf8").toString("latin1"));
    void mojibakeNeedle;
  });

  it("reads a Windows-style path whose directory name is Arabic", async () => {
    const arDir = path.join(tmpPack, "مواصفات", "docs");
    fs.mkdirSync(arDir, { recursive: true });
    const arFile = path.join(arDir, "متطلبات.txt");
    const body = "- يمكن إضافة مصروف بالمحفظة\n- دعم تعدد المحافظ مع الرصيد\n";
    fs.writeFileSync(arFile, Buffer.from(body, "utf8"));

    const spec = await ingestSpecFolder(path.join(tmpPack, "مواصفات"));
    expect(spec.filesRead.some((f) => f.includes("متطلبات") || /[\u0600-\u06FF]/.test(f))).toBe(
      true
    );
    const arabic = spec.requirements.filter((r) => /[\u0600-\u06FF]/.test(r.text));
    expect(arabic.length).toBeGreaterThanOrEqual(1);
    expect(arabic[0].text).toMatch(/مصروف|محافظ/);
    expect(arabic[0].text).not.toMatch(/Ø.|Ù./);

    // decodeSpecBuffer must not reinterpret valid UTF-8 Arabic as CP1256
    const decoded = decodeSpecBuffer(fs.readFileSync(arFile));
    expect(decoded).toContain("يمكن إضافة مصروف");
  });
});
