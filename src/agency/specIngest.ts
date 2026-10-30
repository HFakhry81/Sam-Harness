/**
 * Spec folder ingestion: read .md/.txt/.docx/.pdf/.json/.yaml recursively,
 * chunk, and extract numbered requirements REQ-001… with source file+section.
 */
import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

export type SpecRequirement = {
  id: string; // REQ-001
  text: string;
  sourceFile: string;
  section: string;
};

export type SpecIngestResult = {
  root: string;
  filesRead: string[];
  requirements: SpecRequirement[];
  rawChunks: Array<{ file: string; section: string; text: string }>;
  errors: string[];
};

const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next"]);
const EXT = /\.(md|txt|docx|pdf|json|ya?ml)$/i;

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

async function readDocx(file: string): Promise<string> {
  try {
    const mammoth = require("mammoth") as {
      extractRawText: (opts: { path: string }) => Promise<{ value: string }>;
    };
    const r = await mammoth.extractRawText({ path: file });
    return String(r.value || "");
  } catch {
    // Fallback: unzip document.xml via crude string extract
    try {
      const { execSync } = require("child_process") as typeof import("child_process");
      // Prefer pure-JS: read zip entries with zlib — keep simple fallback empty
      void execSync;
    } catch {
      /* ignore */
    }
    return readDocxXmlFallback(file);
  }
}

function readDocxXmlFallback(file: string): string {
  try {
    // Minimal ZIP local-file scan for word/document.xml
    const buf = fs.readFileSync(file);
    const marker = Buffer.from("word/document.xml");
    const idx = buf.indexOf(marker);
    if (idx < 0) return "";
    // Find PK\x03\x04 before marker
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
  } catch (e: any) {
    return "";
  }
}

async function readSpecFile(file: string): Promise<string> {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".docx") return readDocx(file);
  if (ext === ".pdf") return readPdf(file);
  try {
    return fs.readFileSync(file, "utf-8");
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
    const h = line.match(/^#{1,3}\s+(.+)$/) || line.match(/^([A-Z][A-Za-z0-9 ._-]{3,80})$/);
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

/** Heuristic requirement extraction from bullets / numbered / MUST / يجب. */
export function extractRequirementsHeuristic(
  chunks: Array<{ file: string; section: string; text: string }>
): SpecRequirement[] {
  const reqs: SpecRequirement[] = [];
  const lineRe =
    /^\s*(?:[-*•]|\d+[.)]|REQ[-_]?\d+)\s+(.+)$|^\s*(?:MUST|SHALL|SHOULD|يجب|يلزم|مطلوب)[:\s]+(.+)$/i;
  for (const ch of chunks) {
    for (const line of ch.text.split("\n")) {
      const m = line.match(lineRe);
      const body = (m?.[1] || m?.[2] || "").trim();
      if (!body || body.length < 8 || body.length > 400) continue;
      // Skip pure headings
      if (/^#{1,6}\s/.test(body)) continue;
      reqs.push({
        id: "",
        text: body,
        sourceFile: ch.file,
        section: ch.section,
      });
      if (reqs.length >= 200) break;
    }
    if (reqs.length >= 200) break;
  }
  // Also split sentences with "must" in longer paragraphs when few bullets
  if (reqs.length < 5) {
    for (const ch of chunks) {
      const sentences = ch.text.split(/(?<=[.؟!])\s+/);
      for (const s of sentences) {
        if (!/(must|shall|should|يجب|يلزم|required|support|provide)/i.test(s)) continue;
        const t = s.trim();
        if (t.length < 20 || t.length > 400) continue;
        reqs.push({ id: "", text: t, sourceFile: ch.file, section: ch.section });
        if (reqs.length >= 80) break;
      }
    }
  }
  // Dedup by text
  const seen = new Set<string>();
  const out: SpecRequirement[] = [];
  let n = 1;
  for (const r of reqs) {
    const key = r.text.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...r,
      id: `REQ-${String(n).padStart(3, "0")}`,
    });
    n += 1;
  }
  return out;
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
  for (const file of files.slice(0, 80)) {
    try {
      const text = await readSpecFile(file);
      if (!text.trim()) {
        errors.push(`empty or unreadable: ${file}`);
        continue;
      }
      filesRead.push(file);
      const rel = path.relative(root, file).replace(/\\/g, "/") || path.basename(file);
      for (const ch of sectionize(text, rel)) {
        rawChunks.push({ file: rel, section: ch.section, text: ch.text.slice(0, 12000) });
      }
    } catch (e: any) {
      errors.push(`${file}: ${e?.message || e}`);
    }
  }

  const requirements = extractRequirementsHeuristic(rawChunks);
  return { root, filesRead, requirements, rawChunks, errors };
}

export function requirementsMarkdown(reqs: SpecRequirement[]): string {
  if (!reqs.length) return "_No requirements extracted._\n";
  return reqs
    .map((r) => `- **${r.id}** (${r.sourceFile} § ${r.section}): ${r.text}`)
    .join("\n");
}
