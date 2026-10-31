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
  normalizeReqText,
} from "../src/agency/specIngest.js";
import { isSpecHeadingNotRequirement } from "../src/agency/pathFilters.js";
import { buildReqTraceMatrix } from "../src/agency/reqTrace.js";
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
