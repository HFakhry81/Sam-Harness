/**
 * Spec folder ingestion: read .md/.txt/.docx/.pdf/.json/.yaml recursively,
 * chunk, and extract feature-level requirements (not bare section headings)
 * with kind classification, near-duplicate merge, and robust text encoding.
 */
import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

export type SpecReqKind = "feature" | "non_functional" | "document_only";

export type SpecRequirementSource = {
  sourceFile: string;
  section: string;
};

export type SpecRequirement = {
  id: string; // REQ-001
  text: string;
  sourceFile: string;
  section: string;
  /** feature = code-checkable; non_functional = soft evidence; document_only = n/a */
  kind: SpecReqKind;
  /** All source citations when near-duplicates were merged. */
  sources: SpecRequirementSource[];
};

export type SpecFileRead = {
  path: string;
  bytes: number;
};

export type SpecIngestResult = {
  root: string;
  filesRead: string[];
  /** Per-file byte sizes for files that were actually read. */
  filesReadMeta?: SpecFileRead[];
  requirements: SpecRequirement[];
  rawChunks: Array<{ file: string; section: string; text: string }>;
  errors: string[];
};

const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next"]);
const EXT = /\.(md|txt|docx|pdf|json|ya?ml)$/i;

/** Document-structure / planning section titles — not code-checkable features. */
const DOCUMENT_ONLY_TITLE_RE =
  /^(?:project\s+overview|introduction|overview|scope|glossary|appendix|table\s+of\s+contents|executive\s+summary|background|document\s+control|references|assumptions|document\s+history|revision\s+history|about\s+this\s+document|preface|acknowledgements?|functional\s+requirements(?:\s+analysis)?|implementation\s+roadmap|roadmap|estimated\s+costs?(?:\s*&\s*|\s+and\s+)?infrastructure|estimated\s+costs?|costs?(?:\s*&\s*|\s+and\s+)?infrastructure|ui\/?ux\s+design\s+guidelines|design\s+guidelines|guidelines|api\s+endpoints?\s+design(?:\s*\(.*\))?|tech\s+stack|technology\s+stack|architecture\s+overview|system\s+architecture|database\s+schema|data\s+model|non[- ]?functional\s+requirements|acceptance\s+criteria|out\s+of\s+scope|milestones?|timeline|budget|infrastructure|voice-to-expense\s+module(?:\s*\(.*\))?)$/i;

const NON_FUNCTIONAL_RE =
  /\b(security|performance|scalability|reliability|availability|latency|throughput|encryption|privacy|gdpr|compliance|accessibility|a11y|uptime|sla|observability|monitoring|backup|disaster\s+recovery|load\s+time|memory\s+footprint)\b|أمن|أداء|خصوصية|تشفير/i;

const FEATURE_MODAL_RE =
  /\b(must|shall|should|will|needs?\s+to|required\s+to|support|provide|enable|allow|implement|include|display|wire|integrate|add|create|record|scan|login|authenticate|cache|sync|export|import)\b|يجب|يلزم|مطلوب|يمكن|ينبغي|لابد/i;

const USER_STORY_RE =
  /^(?:as\s+an?\s+.+\s+i\s+(?:want|need|can)\b|ك(?:ـ)?(?:مستخدم|مدير|عميل)\b)/i;

function walk(dir: string, out: string[], depth = 0): void {
  if (depth > 8 || out.length > 500) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out, depth + 1);
    else if (EXT.test(e.name)) out.push(full);
  }
}

/**
 * Decode spec file bytes with UTF-8 / UTF-16 / Windows-1256 detection.
 * Fixes common UTF-8-as-Latin1 Arabic mojibake.
 */
export function decodeSpecBuffer(buf: Buffer): string {
  if (!buf.length) return "";

  // UTF-8 BOM
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.subarray(3).toString("utf-8");
  }
  // UTF-16 LE BOM
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.subarray(2).toString("utf16le");
  }
  // UTF-16 BE BOM
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.alloc(buf.length - 2);
    for (let i = 2; i + 1 < buf.length; i += 2) {
      swapped[i - 2] = buf[i + 1];
      swapped[i - 1] = buf[i];
    }
    return swapped.toString("utf16le");
  }

  const utf8 = tryUtf8(buf);
  if (utf8 && !looksLikeMojibake(utf8) && hasValidArabicOrAscii(utf8)) {
    return utf8;
  }

  // Windows-1256 (Arabic) when high bytes look like Arabic CP1256
  if (looksLikeWindows1256(buf)) {
    try {
      const ar = new TextDecoder("windows-1256").decode(buf);
      if (ar && /[\u0600-\u06FF]/.test(ar)) return ar;
    } catch {
      /* ignore */
    }
  }

  // Mojibake repair: UTF-8 bytes mis-decoded as latin1
  if (utf8 && looksLikeMojibake(utf8)) {
    const repaired = repairUtf8Mojibake(utf8);
    if (repaired && /[\u0600-\u06FF]/.test(repaired)) return repaired;
  }

  if (utf8) return utf8;

  try {
    return new TextDecoder("windows-1256").decode(buf);
  } catch {
    return buf.toString("utf-8");
  }
}

function tryUtf8(buf: Buffer): string | null {
  try {
    const dec = new TextDecoder("utf-8", { fatal: true });
    return dec.decode(buf);
  } catch {
    try {
      return buf.toString("utf-8");
    } catch {
      return null;
    }
  }
}

function looksLikeMojibake(text: string): boolean {
  // Classic UTF-8 Arabic misread as Latin-1/Windows-1252: Ø / Ù / Ã sequences
  if (/[ØÙÃÂ][\u0080-\u00ff]{1,3}/.test(text)) return true;
  if (/(?:Ã.|Â.|Ø.|Ù.){2,}/.test(text) && !/[\u0600-\u06FF]/.test(text)) {
    return true;
  }
  return false;
}

function repairUtf8Mojibake(text: string): string {
  try {
    const bytes = Buffer.from([...text].map((ch) => ch.charCodeAt(0) & 0xff));
    const fixed = bytes.toString("utf-8");
    if (/[\u0600-\u06FF]/.test(fixed)) return fixed;
  } catch {
    /* ignore */
  }
  return text;
}

function looksLikeWindows1256(buf: Buffer): boolean {
  let hi = 0;
  let arabicish = 0;
  for (let i = 0; i < Math.min(buf.length, 4000); i++) {
    const b = buf[i];
    if (b >= 0x80) {
      hi += 1;
      // CP1256 Arabic letter range roughly 0xC1–0xDA, 0xE1–0xF2
      if ((b >= 0xc1 && b <= 0xda) || (b >= 0xe1 && b <= 0xf2) || b === 0xc7) {
        arabicish += 1;
      }
    }
  }
  return hi >= 4 && arabicish >= 3 && arabicish / hi >= 0.35;
}

function hasValidArabicOrAscii(text: string): boolean {
  if (/[\u0600-\u06FF]/.test(text)) return true;
  // Mostly printable
  const sample = text.slice(0, 2000);
  const bad = (sample.match(/\uFFFD/g) || []).length;
  return bad < 3;
}

export function readSpecTextFile(file: string): string {
  const buf = fs.readFileSync(file);
  return decodeSpecBuffer(buf);
}

async function readDocx(file: string): Promise<string> {
  try {
    const mammoth = require("mammoth") as {
      extractRawText: (opts: { path: string }) => Promise<{ value: string }>;
    };
    const r = await mammoth.extractRawText({ path: file });
    return String(r.value || "");
  } catch {
    return readDocxXmlFallback(file);
  }
}

function readDocxXmlFallback(file: string): string {
  try {
    const buf = fs.readFileSync(file);
    const marker = Buffer.from("word/document.xml");
    const idx = buf.indexOf(marker);
    if (idx < 0) return "";
    let start = -1;
    for (let i = idx; i >= 0; i--) {
      if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x03 && buf[i + 3] === 0x04) {
        start = i;
        break;
      }
    }
    if (start < 0) return "";
    const compMethod = buf.readUInt16LE(start + 8);
    const compSize = buf.readUInt32LE(start + 18);
    const nameLen = buf.readUInt16LE(start + 26);
    const extraLen = buf.readUInt16LE(start + 28);
    const dataStart = start + 30 + nameLen + extraLen;
    const data = buf.subarray(dataStart, dataStart + compSize);
    let xml: Buffer;
    if (compMethod === 0) xml = data;
    else if (compMethod === 8) {
      const zlib = require("zlib") as typeof import("zlib");
      xml = zlib.inflateRawSync(data);
    } else return "";
    return xml
      .toString("utf-8")
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<w:br\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return "";
  }
}

async function readPdf(file: string): Promise<string> {
  try {
    const pdfParseMod = require("pdf-parse") as {
      default?: (buf: Buffer) => Promise<{ text: string }>;
      (buf: Buffer): Promise<{ text: string }>;
    };
    const pdfParse = pdfParseMod.default || pdfParseMod;
    const data = await pdfParse(fs.readFileSync(file));
    return String(data?.text || "");
  } catch {
    return "";
  }
}

async function readSpecFile(file: string): Promise<string> {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".docx") return readDocx(file);
  if (ext === ".pdf") return readPdf(file);
  try {
    return readSpecTextFile(file);
  } catch {
    return "";
  }
}

function sectionize(text: string, file: string): Array<{ section: string; text: string }> {
  const lines = text.replace(/\r/g, "").split("\n");
  const chunks: Array<{ section: string; text: string }> = [];
  let section = path.basename(file);
  let buf: string[] = [];
  const flush = () => {
    const t = buf.join("\n").trim();
    if (t) chunks.push({ section, text: t });
    buf = [];
  };
  for (const line of lines) {
    const h =
      line.match(/^#{1,3}\s+(.+)$/) ||
      line.match(/^([A-Z][A-Za-z0-9 ._/&()-]{3,80})$/);
    if (h && buf.length > 0) {
      flush();
      section = String(h[1]).trim().slice(0, 120);
      continue;
    }
    if (h) {
      section = String(h[1]).trim().slice(0, 120);
      continue;
    }
    buf.push(line);
  }
  flush();
  if (!chunks.length && text.trim()) {
    chunks.push({ section: path.basename(file), text: text.trim().slice(0, 20000) });
  }
  return chunks;
}

/** Normalize title/body for comparison & heading detection. */
export function normalizeReqText(text: string): string {
  return String(text || "")
    .replace(/\uFEFF/g, "")
    .replace(/\s+/g, " ")
    .replace(/["""'']/g, "")
    .replace(/[()[\]{}]/g, " ")
    .trim()
    .toLowerCase();
}

function tokenizeReq(text: string): string[] {
  return normalizeReqText(text)
    .replace(/[^\p{L}\p{N}\-_./]+/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3)
    .slice(0, 24);
}

/** Jaccard similarity over distinctive tokens. */
export function reqTokenSimilarity(a: string, b: string): number {
  const ta = new Set(tokenizeReq(a));
  const tb = new Set(tokenizeReq(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const union = ta.size + tb.size - inter;
  return union ? inter / union : 0;
}

const DEDUPE_STOP = new Set(
  [
    "must",
    "shall",
    "should",
    "with",
    "from",
    "that",
    "this",
    "have",
    "support",
    "provide",
    "enable",
    "allow",
    "across",
    "using",
    "into",
    "per",
  ].map((x) => x.toLowerCase())
);

/** Distinctive stems / compounds used for near-duplicate REQ merging. */
function distinctiveStems(text: string): string[] {
  const n = normalizeReqText(text).replace(/-/g, "");
  const toks = n
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !DEDUPE_STOP.has(t));
  const stems = new Set<string>();
  for (const t of toks) {
    stems.add(t);
    if (t.length >= 6) stems.add(t.slice(0, 6));
  }
  // Prefer hyphenated compounds from original
  const compounds =
    normalizeReqText(text).match(/\b[\p{L}\d]+(?:-[\p{L}\d]+)+\b/gu) || [];
  for (const c of compounds) stems.add(c.replace(/-/g, ""));
  return [...stems];
}

function looksLikeFusedReqBlob(text: string): boolean {
  const t = String(text || "");
  if (/\n/.test(t)) return true;
  // Multiple MUST/SHALL/SHOULD / Arabic modals in one string
  const modals = t.match(
    /\b(?:must|shall|should)\b|يجب|يمكن|يلزم|مطلوب|ينبغي/gi
  );
  return (modals?.length || 0) >= 2;
}

/** True when two REQ texts are near-identical in meaning. */
export function areNearDuplicateReqs(a: string, b: string): boolean {
  const na = normalizeReqText(a);
  const nb = normalizeReqText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Never merge a fused multi-requirement blob into a single feature line
  if (looksLikeFusedReqBlob(a) || looksLikeFusedReqBlob(b)) return false;
  if (na.includes(nb) || nb.includes(na)) {
    // Containment only when the shorter is a real phrase (not a single token)
    const shorter = na.length <= nb.length ? na : nb;
    const longer = na.length > nb.length ? na : nb;
    if (
      shorter.split(/\s+/).length >= 4 &&
      longer.length <= shorter.length * 1.8
    ) {
      return true;
    }
  }
  const sim = reqTokenSimilarity(a, b);
  if (sim >= 0.72) return true;
  const sa = new Set(distinctiveStems(a));
  const sb = new Set(distinctiveStems(b));
  let shared = 0;
  for (const s of sa) if (sb.has(s)) shared += 1;
  // Shared rare stem (e.g. multiwallet) + modest token overlap → same feature
  if (shared >= 2 && sim >= 0.22) return true;
  if (shared >= 1 && sim >= 0.45) return true;
  return false;
}

/**
 * True when text is a bare document/section heading (not a testable feature).
 * Exported for pathFilters / RTM n/a classification.
 */
export function isDocumentOnlyRequirement(text: string): boolean {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return true;
  const stripped = t
    .replace(/^\s*(?:[-*•]|\d+[.)]|REQ[-_]?\d+)\s+/i, "")
    .replace(/\s*\((?:detailed|details|overview)\)\s*$/i, "")
    .trim();
  if (DOCUMENT_ONLY_TITLE_RE.test(stripped)) return true;
  // Short Title Case heading without feature modal verbs
  if (
    stripped.length <= 80 &&
    !FEATURE_MODAL_RE.test(stripped) &&
    !USER_STORY_RE.test(stripped) &&
    /^[A-Z][\w/&()-]*(?:\s+[A-Z][\w/&()-]*){0,8}$/.test(stripped) &&
    /(?:overview|analysis|roadmap|guidelines?|design|costs?|infrastructure|module|endpoints?|stack|schema|summary|appendix|references)/i.test(
      stripped
    )
  ) {
    return true;
  }
  return false;
}

export function classifyReqKind(text: string): SpecReqKind {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (isDocumentOnlyRequirement(t)) return "document_only";
  if (NON_FUNCTIONAL_RE.test(t) && !/\b(screen|button|wallet|expense|otp|ocr|voice|receipt|category|budget|chart|report|login|offline|cache)\b|محفظ|مصروف|ميزاني/i.test(t)) {
    return "non_functional";
  }
  // Pure NFR sentences
  if (
    NON_FUNCTIONAL_RE.test(t) &&
    /(?:must|shall|should|يجب).{0,40}(?:secure|encrypt|perform|scal|latency|uptime|sla)/i.test(
      t
    )
  ) {
    return "non_functional";
  }
  return "feature";
}

function stripBulletPrefix(line: string): string {
  return line
    .replace(/^\s*(?:[-*•]|\d+[.)]|REQ[-_]?\d+)\s+/i, "")
    .replace(/^\s*(?:MUST|SHALL|SHOULD|يمكن|يجب|يلزم|مطلوب|ينبغي)[:\s]+/i, "")
    .trim();
}

function isExtractableFeatureLine(body: string): boolean {
  if (!body || body.length < 8 || body.length > 400) return false;
  if (/^#{1,6}\s/.test(body)) return false;
  if (/\n/.test(body) || looksLikeFusedReqBlob(body)) return false;
  if (isDocumentOnlyRequirement(body)) return false;
  // Bare Title Case without modal → skip (section heading leaked as bullet)
  if (
    body.length <= 70 &&
    /^[A-Z][\w/&()-]*(?:\s+[A-Z/][\w/&()-]*){0,10}$/.test(body) &&
    !FEATURE_MODAL_RE.test(body) &&
    !USER_STORY_RE.test(body) &&
    !/[\u0600-\u06FF]/.test(body)
  ) {
    return false;
  }
  return true;
}

type RawCand = {
  text: string;
  sourceFile: string;
  section: string;
  kind: SpecReqKind;
};

/** Heuristic requirement extraction from bullets / numbered / MUST / يجب / user stories. */
export function extractRequirementsHeuristic(
  chunks: Array<{ file: string; section: string; text: string }>
): SpecRequirement[] {
  const cands: RawCand[] = [];
  const lineRe =
    /^\s*(?:[-*•]|\d+[.)]|REQ[-_]?\d+)\s+(.+)$|^\s*(?:MUST|SHALL|SHOULD|يمكن|يجب|يلزم|مطلوب|ينبغي)[:\s]+(.+)$/i;

  for (const ch of chunks) {
    const lines = ch.text.split("\n");
    for (const line of lines) {
      const m = line.match(lineRe);
      let body = (m?.[1] || m?.[2] || "").trim();
      if (!body && USER_STORY_RE.test(line.trim())) {
        body = line.trim();
      }
      if (!body) continue;
      body = stripBulletPrefix(body.length > 0 && m ? (m[1] || m[2] || body) : body);
      // Keep original matched body for modal lines
      const rawBody = (m?.[1] || m?.[2] || body).trim();
      const text = rawBody.length >= 8 ? rawBody : body;
      if (!isExtractableFeatureLine(text)) continue;
      const kind = classifyReqKind(text);
      cands.push({
        text,
        sourceFile: ch.file,
        section: ch.section,
        kind,
      });
      if (cands.length >= 300) break;
    }
    if (cands.length >= 300) break;
  }

  // Sentences with must/should/shall/يجب/يمكن when few line-level bullets found
  if (cands.length < 5) {
    for (const ch of chunks) {
      // Split on sentence enders AND newlines so multi-bullet blocks never fuse
      const sentences = ch.text.split(/(?<=[.؟!])\s+|\n+/);
      for (const s of sentences) {
        if (!FEATURE_MODAL_RE.test(s)) continue;
        const t = s.trim().replace(/^[-*•\d.)\s]+/, "").trim();
        if (!isExtractableFeatureLine(t) || t.length < 20) continue;
        // Never accept a fused multi-requirement blob
        if (/\n/.test(t) || /(?:^|\s)(?:[-*•]|\d+[.)])\s+\S/.test(t)) continue;
        cands.push({
          text: t,
          sourceFile: ch.file,
          section: ch.section,
          kind: classifyReqKind(t),
        });
        if (cands.length >= 120) break;
      }
    }
  }

  return dedupeRequirements(cands);
}

/**
 * Merge near-identical REQs (exact normalized match or high token similarity),
 * keeping all source citations. Prefers feature over document_only when merging.
 */
export function dedupeRequirements(cands: RawCand[]): SpecRequirement[] {
  const out: SpecRequirement[] = [];
  for (const c of cands) {
    const norm = normalizeReqText(c.text);
    if (!norm) continue;
    let merged = false;
    for (const existing of out) {
      const same = areNearDuplicateReqs(existing.text, c.text);
      if (!same) continue;
      existing.sources.push({ sourceFile: c.sourceFile, section: c.section });
      // Prefer richer / feature kind
      if (existing.kind === "document_only" && c.kind !== "document_only") {
        existing.kind = c.kind;
        existing.text = c.text;
      } else if (
        c.kind === "feature" &&
        existing.kind === "non_functional" &&
        c.text.length > existing.text.length
      ) {
        existing.kind = "feature";
        existing.text = c.text;
      } else if (c.text.length > existing.text.length * 1.15) {
        existing.text = c.text;
      }
      // Prefer first source as primary; already appended
      merged = true;
      break;
    }
    if (merged) continue;
    out.push({
      id: "",
      text: c.text,
      sourceFile: c.sourceFile,
      section: c.section,
      kind: c.kind,
      sources: [{ sourceFile: c.sourceFile, section: c.section }],
    });
    if (out.length >= 200) break;
  }

  let n = 1;
  for (const r of out) {
    r.id = `REQ-${String(n).padStart(3, "0")}`;
    n += 1;
  }
  return out;
}

function readDocxSync(file: string): string {
  return readDocxXmlFallback(file);
}

/** Sync ingest (no pdf-parse / mammoth); used by evidence scout sync path. */
export function ingestSpecFolderSync(rootIn: string): SpecIngestResult {
  const root = path.normalize(rootIn);
  const errors: string[] = [];
  if (!fs.existsSync(root)) {
    return {
      root,
      filesRead: [],
      requirements: [],
      rawChunks: [],
      errors: [`spec root missing: ${root}`],
    };
  }
  const files: string[] = [];
  if (fs.statSync(root).isDirectory()) walk(root, files);
  else files.push(root);

  const rawChunks: SpecIngestResult["rawChunks"] = [];
  const filesRead: string[] = [];
  const filesReadMeta: SpecFileRead[] = [];

  for (const file of files.slice(0, 80)) {
    const ext = path.extname(file).toLowerCase();
    let text = "";
    try {
      if (ext === ".docx") text = readDocxSync(file);
      else if (ext === ".pdf") {
        errors.push(`pdf requires async ingest: ${file}`);
        continue;
      } else text = readSpecTextFile(file);
    } catch (e: any) {
      errors.push(`${file}: ${e?.message || e}`);
      continue;
    }
    if (!text.trim()) continue;
    filesRead.push(file);
    const rel = path.relative(root, file).replace(/\\/g, "/") || path.basename(file);
    let bytes = Buffer.byteLength(text, "utf-8");
    try {
      bytes = fs.statSync(file).size;
    } catch {
      /* keep */
    }
    filesReadMeta.push({ path: rel, bytes });
    for (const ch of sectionize(text, rel)) {
      rawChunks.push({ file: rel, section: ch.section, text: ch.text.slice(0, 12000) });
    }
  }

  return {
    root,
    filesRead,
    filesReadMeta,
    requirements: extractRequirementsHeuristic(rawChunks),
    rawChunks,
    errors,
  };
}

export async function ingestSpecFolder(rootIn: string): Promise<SpecIngestResult> {
  const root = path.normalize(rootIn);
  const errors: string[] = [];
  if (!fs.existsSync(root)) {
    return {
      root,
      filesRead: [],
      requirements: [],
      rawChunks: [],
      errors: [`spec root missing: ${root}`],
    };
  }
  const files: string[] = [];
  if (fs.statSync(root).isDirectory()) walk(root, files);
  else files.push(root);

  const rawChunks: SpecIngestResult["rawChunks"] = [];
  const filesRead: string[] = [];
  const filesReadMeta: SpecFileRead[] = [];
  for (const file of files.slice(0, 80)) {
    try {
      const text = await readSpecFile(file);
      if (!text.trim()) {
        errors.push(`empty or unreadable: ${file}`);
        continue;
      }
      filesRead.push(file);
      let bytes = Buffer.byteLength(text, "utf-8");
      try {
        bytes = fs.statSync(file).size;
      } catch {
        /* keep text byte length */
      }
      filesReadMeta.push({
        path: path.relative(root, file).replace(/\\/g, "/") || path.basename(file),
        bytes,
      });
      const rel = path.relative(root, file).replace(/\\/g, "/") || path.basename(file);
      for (const ch of sectionize(text, rel)) {
        rawChunks.push({ file: rel, section: ch.section, text: ch.text.slice(0, 12000) });
      }
    } catch (e: any) {
      errors.push(`${file}: ${e?.message || e}`);
    }
  }

  const requirements = extractRequirementsHeuristic(rawChunks);
  return { root, filesRead, filesReadMeta, requirements, rawChunks, errors };
}

export function requirementsMarkdown(reqs: SpecRequirement[]): string {
  if (!reqs.length) return "_No requirements extracted._\n";
  return reqs
    .map((r) => {
      const cites =
        r.sources && r.sources.length > 1
          ? r.sources.map((s) => `${s.sourceFile} § ${s.section}`).join("; ")
          : `${r.sourceFile} § ${r.section}`;
      return `- **${r.id}** [${r.kind}] (${cites}): ${r.text}`;
    })
    .join("\n");
}
