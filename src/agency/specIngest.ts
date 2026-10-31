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
  /^(?:project\s+overview|introduction|overview|scope|glossary|appendix|table\s+of\s+contents|executive\s+summary|background|document\s+control|references|assumptions|document\s+history|revision\s+history|about\s+this\s+document|preface|acknowledgements?|functional\s+requirements(?:\s+analysis)?|implementation\s+roadmap|roadmap|estimated\s+costs?(?:\s*&\s*|\s+and\s+)?infrastructure|estimated\s+costs?|costs?(?:\s*&\s*|\s+and\s+)?infrastructure|ui\/?ux\s+design\s+guidelines|design\s+guidelines|guidelines|api\s+endpoints?\s+design(?:\s*\(.*\))?|tech\s+stack|technology\s+stack|architecture\s+overview|system\s+architecture(?:\s*&\s*|\s+and\s+)?(?:tech\s+stack)?|database\s+architecture(?:\s*\(.*\))?|database\s+schema|data\s+model|non[- ]?functional\s+requirements|acceptance\s+criteria|out\s+of\s+scope|milestones?|timeline|budget|infrastructure|security\s*&\s*compliance|security\s+and\s+compliance|voice-to-expense\s+module(?:\s*\(.*\))?|[A-Za-z0-9/&().,\s-]{2,60}\s+module(?:\s*\(.*\))?)$/i;

/** Bullet / numbered-list line prefixes (ASCII, Unicode, Arabic-Indic digits). */
const BULLET_PREFIX_RE =
  /^\s*(?:[-*•●○■▪▫‣⁃◦·⋅]|[\u2022\u25CF\u25E6\u2043\u2219]|[0-9]{1,3}[.)]|[٠-٩]{1,3}[.)]|[۰-۹]{1,3}[.)]|REQ[-_]?\d+)\s+/i;

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
 * Prefer strict UTF-8 whenever valid — never reinterpret valid UTF-8 as CP1256
 * (that is the main Arabic mojibake source on real Spendy .txt specs).
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

  // Strict UTF-8 first — valid UTF-8 (incl. Arabic) wins unconditionally.
  // Never latin1-mask a string that already contains Arabic letters.
  const utf8Strict = tryUtf8Strict(buf);
  if (utf8Strict != null) {
    if (
      looksLikeMojibake(utf8Strict) &&
      !/[\u0600-\u06FF]/.test(utf8Strict)
    ) {
      const repaired = repairUtf8Mojibake(utf8Strict);
      if (
        repaired &&
        /[\u0600-\u06FF]/.test(repaired) &&
        !looksLikeMojibake(repaired)
      ) {
        return repaired;
      }
    }
    return utf8Strict;
  }

  // UTF-8 failed → try Windows-1256 for legacy Arabic .txt
  try {
    const ar = new TextDecoder("windows-1256").decode(buf);
    if (ar && scoreDecodedText(ar) > 0) return ar;
  } catch {
    /* ignore */
  }

  // Last resort: lossy UTF-8
  return buf.toString("utf-8");
}

function tryUtf8Strict(buf: Buffer): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return null;
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

/**
 * Repair classic UTF-8-as-Latin1 mojibake (ØÙÃ…).
 * NEVER call this on text that already contains Arabic letters — masking
 * charCodeAt&0xff destroys valid Arabic into ASCII garbage.
 */
function repairUtf8Mojibake(text: string): string {
  if (/[\u0600-\u06FF]/.test(text)) return text;
  try {
    const bytes = Buffer.from([...text].map((ch) => ch.charCodeAt(0) & 0xff));
    const fixed = bytes.toString("utf-8");
    if (/[\u0600-\u06FF]/.test(fixed) && !looksLikeMojibake(fixed)) return fixed;
  } catch {
    /* ignore */
  }
  return text;
}

/** Higher is better — used when choosing among fallbacks. */
function scoreDecodedText(text: string): number {
  if (!text) return -1;
  let score = 0;
  const arabic = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const mojibake = (text.match(/[ØÙÃÂ]/g) || []).length;
  const repl = (text.match(/\uFFFD/g) || []).length;
  score += arabic * 3;
  score -= mojibake * 5;
  score -= repl * 10;
  if (/[A-Za-z]{3,}/.test(text)) score += 1;
  return score;
}

export function readSpecTextFile(file: string): string {
  const buf = fs.readFileSync(file);
  return decodeSpecBuffer(buf);
}

/**
 * Prefer list-aware OOXML extraction (w:numPr / ListParagraph → "- " prefix).
 * Mammoth extractRawText drops list markers, which made Spendy feature bullets vanish.
 */
async function readDocx(file: string): Promise<string> {
  const fromXml = readDocxXmlWithLists(file);
  if (fromXml.trim()) return fromXml;
  try {
    const mammoth = require("mammoth") as {
      extractRawText: (opts: { path: string }) => Promise<{ value: string }>;
    };
    const r = await mammoth.extractRawText({ path: file });
    return preserveUnicodeText(String(r.value || ""));
  } catch {
    return "";
  }
}

/** Unpack word/document.xml from a .docx (ZIP). */
function extractDocumentXml(file: string): string {
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
  return xml.toString("utf-8");
}

/**
 * Convert OOXML paragraphs to plain text, prefixing Word list paragraphs with "- ".
 * Detects w:numPr and ListParagraph / ListBullet / ListNumber styles.
 */
export function docxXmlToText(xml: string): string {
  if (!xml) return "";
  const paras = xml.split(/<\/w:p>/i);
  const lines: string[] = [];
  for (const raw of paras) {
    if (!/<w:p[\s>]/i.test(raw) && !/<w:p\b/i.test(raw)) continue;
    const pPr = raw.match(/<w:pPr\b[^>]*>([\s\S]*?)<\/w:pPr>/i)?.[1] || "";
    const isList =
      /<w:numPr\b/i.test(pPr) ||
      /<w:pStyle\b[^>]*w:val="[^"]*List[^"]*"/i.test(pPr) ||
      /<w:pStyle\b[^>]*w:val="[^"]*Bullet[^"]*"/i.test(pPr);
    const isHeading = /<w:pStyle\b[^>]*w:val="[^"]*Heading[^"]*"/i.test(pPr);
    // Collect visible text runs (skip deleted revisions)
    let text = "";
    const tRe = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi;
    let m: RegExpExecArray | null;
    while ((m = tRe.exec(raw))) {
      text += m[1]
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
    }
    text = text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (isHeading) {
      lines.push(`# ${text}`);
    } else if (isList) {
      lines.push(`- ${text}`);
    } else {
      lines.push(text);
    }
  }
  return lines.join("\n").trim();
}

function readDocxXmlWithLists(file: string): string {
  try {
    const raw = docxXmlToText(extractDocumentXml(file));
    // Repair whole-doc mojibake if OOXML/mammoth path somehow latin1-decoded UTF-8
    return preserveUnicodeText(raw);
  } catch {
    return "";
  }
}

/** @deprecated name kept for callers — now list-aware. */
function readDocxXmlFallback(file: string): string {
  return readDocxXmlWithLists(file);
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

/**
 * True when a line is a section heading — NOT a feature sentence.
 * Avoid matching "Multi-wallet support with balance…" as a heading.
 */
function isSectionHeadingLine(line: string): string | null {
  const md = line.match(/^#{1,3}\s+(.+)$/);
  if (md) return md[1].trim().slice(0, 120);
  const t = line.trim();
  if (!t || t.length < 4 || t.length > 90) return null;
  if (BULLET_PREFIX_RE.test(t)) return null;
  if (FEATURE_MODAL_RE.test(t) && !isDocumentOnlyRequirement(t)) return null;
  if (USER_STORY_RE.test(t)) return null;
  // Known document-only titles (Module / Architecture / Tech Stack / …)
  if (isDocumentOnlyRequirement(t)) return t.slice(0, 120);
  // Short Title Case / ALL CAPS labels without commas (not prose)
  if (
    /^[A-Z][A-Za-z0-9_/&()-]*(?:\s+[A-Z][A-Za-z0-9_/&()-]*){0,8}$/.test(t) &&
    !/,/.test(t) &&
    t.split(/\s+/).length <= 8
  ) {
    return t.slice(0, 120);
  }
  return null;
}

function sectionize(text: string, file: string): Array<{ section: string; text: string }> {
  const lines = text.replace(/\r/g, "").split("\n");
  const chunks: Array<{ section: string; text: string }> = [];
  // Use basename as context only — never as a REQ body
  let section = path.basename(file).replace(/\.[^.]+$/, "") || path.basename(file);
  let buf: string[] = [];
  const flush = () => {
    const t = buf.join("\n").trim();
    if (t) chunks.push({ section, text: t });
    buf = [];
  };
  for (const line of lines) {
    const heading = isSectionHeadingLine(line);
    if (heading) {
      if (buf.length > 0) flush();
      section = heading;
      continue;
    }
    buf.push(line);
  }
  flush();
  if (!chunks.length && text.trim()) {
    chunks.push({
      section: path.basename(file).replace(/\.[^.]+$/, "") || path.basename(file),
      text: text.trim().slice(0, 20000),
    });
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
    .replace(BULLET_PREFIX_RE, "")
    .replace(/\s*\((?:detailed|details|overview)\)\s*$/i, "")
    .trim();
  if (DOCUMENT_ONLY_TITLE_RE.test(stripped)) return true;
  // Module / Architecture / Tech Stack / Compliance section labels
  if (
    /^(?:[\w/&().,\s-]{2,70})\s+module$/i.test(stripped) ||
    (/^security\s*(&|and)\s*compliance$/i.test(stripped)) ||
    (/\barchitecture\b/i.test(stripped) &&
      /(?:database|system|software|app(?:lication)?)/i.test(stripped) &&
      stripped.length <= 90 &&
      !FEATURE_MODAL_RE.test(stripped)) ||
    (/tech\s*stack/i.test(stripped) &&
      stripped.length <= 90 &&
      !FEATURE_MODAL_RE.test(stripped))
  ) {
    return true;
  }
  // Short Title Case heading without feature modal verbs
  if (
    stripped.length <= 80 &&
    !FEATURE_MODAL_RE.test(stripped) &&
    !USER_STORY_RE.test(stripped) &&
    /^[A-Z][\w/&()-]*(?:\s+[A-Z][\w/&()-]*){0,8}$/.test(stripped) &&
    /(?:overview|analysis|roadmap|guidelines?|design|costs?|infrastructure|module|endpoints?|stack|schema|summary|appendix|references|architecture|compliance)/i.test(
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
  // Footnoted / catalog-style vendor recommendations → non_functional
  // (e.g. "Speech-to-Text: Deepgram Nova-3 API [^2^]"). Do NOT classify
  // product features like "Bank Integration with Plaid import" as NFR.
  if (
    (/\[\^\d+\^\]/.test(t) ||
      /^(?:speech-to-text|stt|tts|ocr\s*engine|nlp|nlu|llm|provider|vendor)\s*:/i.test(
        t
      )) &&
    /\b(?:deepgram|openai|whisper|nova-?\d|stripe|plaid|firebase|aws|azure|gcp)\b/i.test(
      t
    )
  ) {
    return "non_functional";
  }
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

/**
 * Drop intro prose, examples, schema field lists, feature-summary chips,
 * footnoted vendor lines (as extractable features), and tiny fragments.
 */
export function isNoiseRequirementLine(text: string): boolean {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 4) return true;
  // Examples
  if (
    /^(?:example|e\.g\.|eg\.|for example|sample|demo)\b/i.test(t) ||
    /\bexample\s*\(/i.test(t) ||
    /\bspent (?:fifty|\$?\d+)/i.test(t)
  ) {
    return true;
  }
  // Schema / column field lists (id, user_id, name, type…)
  if (
    /^(?:[\w./-]+\s*,\s*){2,}[\w./-]+$/.test(t) ||
    /\b(?:user_id|team_id|created_at|updated_at|varchar|uuid|primary key)\b/i.test(
      t
    )
  ) {
    return true;
  }
  // Intro / blueprint / summary prose
  if (
    /\b(this document|comprehensive technical|blueprint|provides an? overview|executive summary|the following (?:sections?|chapters?)|feature summary)\b/i.test(
      t
    )
  ) {
    return true;
  }
  // Chip / summary lines joined by ? · | / arrows
  if (
    /(?:^|[\s])(?:Multi-Wallet|Voice AI|Team Collaboration|OCR|OTP)(?:\s*[?·|/→\-–—]\s*(?:Multi-Wallet|Voice AI|Team Collaboration|OCR|OTP)){1,}/i.test(
      t
    ) &&
    t.length < 120
  ) {
    return true;
  }
  // Footnoted citations only (vendor catalog)
  if (/\[\^\d+\^\]/.test(t) && !FEATURE_MODAL_RE.test(t) && words.length < 16) {
    return true;
  }
  // Vendor / tech recommendation lines (Speech-to-Text: Deepgram…)
  if (
    /^(?:speech-to-text|stt|tts|ocr\s*engine|nlp|nlu|llm|provider|vendor)\s*:/i.test(
      t
    ) ||
    (/\b(?:deepgram|nova-?\d|openai|whisper|stripe|plaid)\b/i.test(t) &&
      /(?:api|sdk|service|provider|:)/i.test(t) &&
      !FEATURE_MODAL_RE.test(t) &&
      words.length < 14)
  ) {
    return true;
  }
  return false;
}

/**
 * Keep Arabic / Unicode intact — never latin1-roundtrip valid Unicode.
 * If the string is pure mojibake (ØÙ… with no Arabic letters), repair it.
 */
export function preserveUnicodeText(text: string): string {
  const t = String(text || "");
  if (!t) return t;
  // Already has Arabic script → leave untouched (repair would destroy it)
  if (/[\u0600-\u06FF]/.test(t)) return t;
  if (looksLikeMojibake(t)) {
    const repaired = repairUtf8Mojibake(t);
    if (/[\u0600-\u06FF]/.test(repaired)) return repaired;
  }
  return t;
}

/**
 * Ensure a REQ title / RTM cell is UTF-8 Unicode Arabic when the source
 * was mis-decoded. Safe to call on every write path.
 */
export function ensureUtf8ReqText(text: string): string {
  return preserveUnicodeText(String(text || "").replace(/\uFEFF/g, "").trim());
}

function stripBulletPrefix(line: string): string {
  return line
    .replace(BULLET_PREFIX_RE, "")
    .replace(/^\s*(?:MUST|SHALL|SHOULD|يمكن|يجب|يلزم|مطلوب|ينبغي)[:\s]+/i, "")
    .trim();
}

/** Feature vocabulary for unmarked (no bullet) lines from mammoth/plain prose. */
const FEATURE_TOPIC_RE =
  /\b(expense|wallet|categor(?:y|ies)|budget|report|chart|otp|login|auth|offline|cache|voice|ocr|receipt|currency|egp|permission|team\s+member|transaction|microphone|camera)\b|مصروف|محفظ|فئ|ميزاني|تقرير|رسم|دخول|صوت|إيصال|جنيه/i;

function isExtractableFeatureLine(body: string): boolean {
  if (!body || body.length < 8 || body.length > 400) return false;
  if (/^#{1,6}\s/.test(body)) return false;
  if (/\n/.test(body) || looksLikeFusedReqBlob(body)) return false;
  if (isDocumentOnlyRequirement(body)) return false;
  if (isNoiseRequirementLine(body)) return false;
  // Bare Title Case without modal → skip (section heading leaked as bullet)
  if (
    body.length <= 70 &&
    /^[A-Z][\w/&()-]*(?:\s+[A-Z/][\w/&()-]*){0,10}$/.test(body) &&
    !FEATURE_MODAL_RE.test(body) &&
    !USER_STORY_RE.test(body) &&
    !FEATURE_TOPIC_RE.test(body) &&
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

function pushCand(
  cands: RawCand[],
  text: string,
  ch: { file: string; section: string }
): void {
  const t = preserveUnicodeText(text.replace(/\s+/g, " ").trim());
  if (!isExtractableFeatureLine(t)) return;
  cands.push({
    text: t,
    sourceFile: ch.file,
    section: ch.section,
    kind: classifyReqKind(t),
  });
}

/** Soft cap — prefer tens of features, never hundreds of prose fragments. */
export const MAX_FEATURE_REQS = 50;

/** Heuristic requirement extraction from bullets / numbered / MUST / يجب / user stories. */
export function extractRequirementsHeuristic(
  chunks: Array<{ file: string; section: string; text: string }>
): SpecRequirement[] {
  const cands: RawCand[] = [];
  const modalLineRe =
    /^\s*(?:MUST|SHALL|SHOULD|يمكن|يجب|يلزم|مطلوب|ينبغي)[:\s]+(.+)$/i;

  for (const ch of chunks) {
    const lines = ch.text.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let text = "";
      const bullet = trimmed.match(BULLET_PREFIX_RE);
      if (bullet) {
        text = trimmed.replace(BULLET_PREFIX_RE, "").trim();
      } else {
        const modal = trimmed.match(modalLineRe);
        if (modal) text = modal[1].trim();
        else if (USER_STORY_RE.test(trimmed)) text = trimmed;
        else if (
          // Unmarked feature lines (docx list markers stripped by mammoth).
          // Require a concrete feature topic — bare "must deliver capabilities"
          // overview prose is not a REQ.
          FEATURE_TOPIC_RE.test(trimmed) &&
          trimmed.length >= 12 &&
          trimmed.length <= 200 &&
          !isDocumentOnlyRequirement(trimmed) &&
          !/\b(overview|description|capabilities|estimates?\s+only|guidelines?)\b/i.test(
            trimmed
          )
        ) {
          text = trimmed;
        }
      }
      if (!text) continue;
      pushCand(cands, text, ch);
      if (cands.length >= 300) break;
    }
    if (cands.length >= 300) break;
  }

  // Sentences with must/should/shall/يجب/يمكن when few line-level hits found
  if (cands.length < 5) {
    for (const ch of chunks) {
      const sentences = ch.text.split(/(?<=[.؟!])\s+|\n+/);
      for (const s of sentences) {
        if (!FEATURE_MODAL_RE.test(s) && !FEATURE_TOPIC_RE.test(s)) continue;
        const t = s.trim().replace(BULLET_PREFIX_RE, "").trim();
        if (!isExtractableFeatureLine(t) || t.length < 12) continue;
        if (/\n/.test(t)) continue;
        pushCand(cands, t, ch);
        if (cands.length >= 120) break;
      }
    }
  }

  return dedupeRequirements(cands);
}

/**
 * Merge near-identical REQs (exact normalized match or high token similarity),
 * keeping all source citations. Prefers feature over document_only when merging.
 * Caps feature REQs so RTM stays in the tens, not hundreds.
 */
export function dedupeRequirements(cands: RawCand[]): SpecRequirement[] {
  const out: SpecRequirement[] = [];
  for (const c of cands) {
    const norm = normalizeReqText(c.text);
    if (!norm) continue;
    if (isNoiseRequirementLine(c.text) && c.kind === "feature") continue;
    let merged = false;
    for (const existing of out) {
      const same = areNearDuplicateReqs(existing.text, c.text);
      if (!same) continue;
      existing.sources.push({ sourceFile: c.sourceFile, section: c.section });
      // Prefer richer / feature kind; prefer English feature phrasing when merging AR/EN
      if (existing.kind === "document_only" && c.kind !== "document_only") {
        existing.kind = c.kind;
        existing.text = c.text;
      } else if (
        c.kind === "feature" &&
        existing.kind === "non_functional"
      ) {
        existing.kind = "feature";
        existing.text = c.text;
      } else if (
        c.kind === existing.kind &&
        /[A-Za-z]/.test(c.text) &&
        !/[A-Za-z]/.test(existing.text) &&
        /[\u0600-\u06FF]/.test(existing.text)
      ) {
        // Keep Arabic in sources; surface English title when both describe same feature
        existing.text = c.text;
      } else if (c.text.length > existing.text.length * 1.15) {
        existing.text = c.text;
      }
      merged = true;
      break;
    }
    if (merged) continue;
    out.push({
      id: "",
      text: preserveUnicodeText(c.text),
      sourceFile: c.sourceFile,
      section: c.section,
      kind: c.kind,
      sources: [{ sourceFile: c.sourceFile, section: c.section }],
    });
  }

  // Prefer features with modal/topic signal; drop lowest-value extras beyond cap
  const features = out.filter((r) => r.kind === "feature");
  const others = out.filter((r) => r.kind !== "feature");
  const scored = features
    .map((r) => {
      let score = 0;
      if (FEATURE_MODAL_RE.test(r.text)) score += 3;
      if (FEATURE_TOPIC_RE.test(r.text)) score += 2;
      if (USER_STORY_RE.test(r.text)) score += 2;
      if (r.sources.length > 1) score += 1; // cross-file agreement
      if (/\[\^\d+\^\]/.test(r.text)) score -= 2;
      score += Math.min(3, Math.floor(r.text.split(/\s+/).length / 4));
      return { r, score };
    })
    .sort((a, b) => b.score - a.score);
  const keptFeatures = scored.slice(0, MAX_FEATURE_REQS).map((x) => x.r);
  const capped = [...keptFeatures, ...others];

  let n = 1;
  for (const r of capped) {
    r.id = `REQ-${String(n).padStart(3, "0")}`;
    n += 1;
  }
  return capped;
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
