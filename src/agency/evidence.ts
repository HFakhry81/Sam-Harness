/**
 * Evidence scout v2 — path-aware, spec ingestion, repo indexing, REQ matrix,
 * locale/currency grounding. Emits evidence-pack.md + evidence.json.
 */
import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";
import type { EvidenceHit, EvidencePack } from "./types.js";
import {
  extractGoalPaths,
  primarySpecRoot,
  primaryTargetRepo,
  type GoalPaths,
} from "./pathExtract.js";
import {
  extractRequirementsHeuristic,
  ingestSpecFolder,
  requirementsMarkdown,
  type SpecIngestResult,
} from "./specIngest.js";
import { indexRepo, type RepoIndexResult } from "./repoIndex.js";
import { buildReqTraceMatrix, type ReqTraceMatrix } from "./reqTrace.js";
import {
  inferLocaleCurrency,
  localeCurrencyMarkdown,
  type LocaleCurrencyProfile,
} from "./localeCurrency.js";

const require = createRequire(import.meta.url);

export type EvidencePackV2 = EvidencePack & {
  version: 2;
  goalPaths: GoalPaths;
  specRoot?: string;
  spec?: SpecIngestResult;
  repoIndex?: RepoIndexResult;
  reqMatrix?: ReqTraceMatrix;
  localeCurrency?: LocaleCurrencyProfile;
  json: object;
};

export type ScanEvidenceOpts = {
  goal?: string;
  specRoot?: string;
  includeSpec?: boolean;
};

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  "vendor",
]);

const INTERESTING = [
  { re: /occupancy_mode|RESOURCE_RENTAL|BATCH_SCHEDULE/i, note: "booking/occupancy keyword (legacy)" },
  { re: /supabase|firebase|appwrite/i, note: "backend SDK keyword" },
  { re: /mockData|mocks?\//i, note: "mock-data keyword" },
];

function walk(dir: string, out: string[], depth = 0): void {
  if (depth > 6 || out.length > 4000) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out, depth + 1);
    else out.push(full);
  }
}

function legacyKeywordHits(root: string): EvidenceHit[] {
  const files: string[] = [];
  walk(root, files);
  const hits: EvidenceHit[] = [];
  for (const file of files.slice(0, 2000)) {
    const rel = path.relative(root, file).replace(/\\/g, "/");
    const base = path.basename(file);
    for (const rule of INTERESTING) {
      if (rule.re.test(rel) || rule.re.test(base)) {
        hits.push({ path: rel, kind: "file", note: rule.note });
        break;
      }
    }
    if (hits.length >= 20) break;
  }
  return hits;
}

function toEvidenceHits(index: RepoIndexResult): EvidenceHit[] {
  return index.hits.map((h) => ({
    path: h.path,
    kind: "file" as const,
    note: `[${h.category}] ${h.note}`,
  }));
}

function readDocxSync(file: string): string {
  try {
    const zlib = require("zlib") as typeof import("zlib");
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
    const xml =
      compMethod === 0
        ? data
        : compMethod === 8
          ? zlib.inflateRawSync(data)
          : Buffer.alloc(0);
    return xml
      .toString("utf-8")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return "";
  }
}

function ingestSpecFolderSync(root: string): SpecIngestResult {
  const files: string[] = [];
  const walkSync = (dir: string, depth = 0) => {
    if (depth > 8 || files.length > 200) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walkSync(full, depth + 1);
      else if (/\.(md|txt|json|ya?ml|docx|pdf)$/i.test(e.name)) files.push(full);
    }
  };
  if (fs.statSync(root).isDirectory()) walkSync(root);
  else files.push(root);

  const rawChunks: SpecIngestResult["rawChunks"] = [];
  const filesRead: string[] = [];
  const errors: string[] = [];

  for (const file of files.slice(0, 80)) {
    const ext = path.extname(file).toLowerCase();
    let text = "";
    try {
      if (ext === ".docx") text = readDocxSync(file);
      else if (ext === ".pdf") {
        errors.push(`pdf requires async ingest: ${file}`);
        continue;
      } else text = fs.readFileSync(file, "utf-8");
    } catch (e: any) {
      errors.push(`${file}: ${e?.message || e}`);
      continue;
    }
    if (!text.trim()) continue;
    filesRead.push(file);
    const rel = path.relative(root, file).replace(/\\/g, "/") || path.basename(file);
    rawChunks.push({
      file: rel,
      section: path.basename(file),
      text: text.slice(0, 20000),
    });
  }

  return {
    root,
    filesRead,
    requirements: extractRequirementsHeuristic(rawChunks),
    rawChunks,
    errors,
  };
}

function buildMarkdown(input: {
  root: string;
  scannedAt: string;
  hits: EvidenceHit[];
  goalPaths: GoalPaths;
  specRoot?: string;
  spec?: SpecIngestResult;
  repoIndex: RepoIndexResult;
  reqMatrix?: ReqTraceMatrix;
  localeCurrency: LocaleCurrencyProfile;
}): string {
  const {
    root,
    scannedAt,
    hits,
    goalPaths,
    specRoot,
    spec,
    repoIndex,
    reqMatrix,
    localeCurrency,
  } = input;
  return [
    `# Evidence pack v2 (grounded scout)`,
    ``,
    `Target repo: \`${root}\``,
    `Spec root: \`${specRoot || "(none detected)"}\``,
    `Scanned: ${scannedAt}`,
    `Hits: ${hits.length}`,
    ``,
    `## Goal paths`,
    ...goalPaths.targetRepos.map(
      (p) => `- target_repo: \`${p.normalized}\` exists=${p.exists} (${p.reason})`
    ),
    ...goalPaths.specRoots.map(
      (p) => `- spec_docs: \`${p.normalized}\` exists=${p.exists} (${p.reason})`
    ),
    goalPaths.targetRepos.length || goalPaths.specRoots.length
      ? ""
      : "- (no filesystem paths parsed from goal)",
    ``,
    localeCurrencyMarkdown(localeCurrency),
    `## Repo index highlights`,
    `- packages: ${repoIndex.packageNames.join(", ") || "—"}`,
    `- mock data: ${repoIndex.usesMockData ? "YES" : "no"}`,
    `- missing imports: ${repoIndex.missingImports.length}`,
    ...repoIndex.missingImports
      .slice(0, 12)
      .map((m) => `  - \`${m.file}\` imports \`${m.specifier}\` (not in package.json deps)`),
    ``,
    `## Spec requirements`,
    spec ? requirementsMarkdown(spec.requirements) : "_No spec folder ingested._",
    ``,
    reqMatrix ? reqMatrix.markdown : "",
    ``,
    `## Citable file hits (real paths only)`,
    `Auditor MUST cite these paths (or mark "not found") — do not invent frameworks or folders.`,
    ``,
    ...hits.slice(0, 80).map((h) => `- \`${h.path}\` — ${h.note}`),
    ``,
  ].join("\n");
}

function assemblePack(
  root: string,
  goalPaths: GoalPaths,
  specRoot: string | undefined,
  spec: SpecIngestResult | undefined
): EvidencePackV2 {
  const scannedAt = new Date().toISOString();
  const repoIndex = indexRepo(root);
  const localeCurrency = inferLocaleCurrency(repoIndex);
  const reqMatrix =
    spec && spec.requirements.length
      ? buildReqTraceMatrix(spec.requirements, repoIndex)
      : undefined;

  const hitsMap = new Map<string, EvidenceHit>();
  for (const h of toEvidenceHits(repoIndex)) {
    if (!hitsMap.has(h.path)) hitsMap.set(h.path, h);
  }
  for (const h of legacyKeywordHits(root)) {
    if (!hitsMap.has(h.path)) hitsMap.set(h.path, h);
  }
  const hits: EvidenceHit[] = [];
  for (const h of hitsMap.values()) {
    const full = path.join(root, h.path);
    if (fs.existsSync(full) || h.note.startsWith("[import_gap]")) hits.push(h);
  }

  const summaryMarkdown = buildMarkdown({
    root,
    scannedAt,
    hits,
    goalPaths,
    specRoot,
    spec,
    repoIndex,
    reqMatrix,
    localeCurrency,
  });

  const json = {
    version: 2,
    targetRepo: root,
    scannedAt,
    goalPaths,
    specRoot: specRoot || null,
    requirements: spec?.requirements || [],
    reqMatrix: reqMatrix?.json || null,
    localeCurrency,
    hits,
    missingImports: repoIndex.missingImports,
    usesMockData: repoIndex.usesMockData,
    currencies: repoIndex.currencies,
    locales: repoIndex.locales,
  };

  return {
    version: 2,
    targetRepo: root,
    scannedAt,
    hits: hits.slice(0, 120),
    summaryMarkdown,
    goalPaths,
    specRoot,
    spec,
    repoIndex,
    reqMatrix,
    localeCurrency,
    json,
  };
}

/**
 * Sync evidence scan (md/txt/json/yaml + docx zip fallback). Preferred by runner.
 */
export function scanRepoEvidence(
  targetRepo: string,
  opts?: ScanEvidenceOpts
): EvidencePackV2 {
  const goal = opts?.goal || "";
  const goalPaths = extractGoalPaths(goal);
  const root = path.normalize(
    primaryTargetRepo(goalPaths, targetRepo) || targetRepo
  );

  if (!fs.existsSync(root)) {
    return {
      version: 2,
      targetRepo: root,
      scannedAt: new Date().toISOString(),
      hits: [],
      summaryMarkdown: `# Evidence pack v2\n\nTarget missing: \`${root}\`\n`,
      goalPaths,
      json: { targetRepo: root, missing: true, goalPaths },
    };
  }

  const specRoot = opts?.specRoot || primarySpecRoot(goalPaths);
  const spec =
    opts?.includeSpec !== false && specRoot && fs.existsSync(specRoot)
      ? ingestSpecFolderSync(specRoot)
      : undefined;

  return assemblePack(root, goalPaths, specRoot, spec);
}

/** Async variant with mammoth/pdf-parse for richer docx/pdf. */
export async function scanRepoEvidenceAsync(
  targetRepo: string,
  opts?: ScanEvidenceOpts
): Promise<EvidencePackV2> {
  const goal = opts?.goal || "";
  const goalPaths = extractGoalPaths(goal);
  const root = path.normalize(
    primaryTargetRepo(goalPaths, targetRepo) || targetRepo
  );
  if (!fs.existsSync(root)) {
    return scanRepoEvidence(targetRepo, opts);
  }
  const specRoot = opts?.specRoot || primarySpecRoot(goalPaths);
  const spec =
    opts?.includeSpec !== false && specRoot && fs.existsSync(specRoot)
      ? await ingestSpecFolder(specRoot)
      : undefined;
  return assemblePack(root, goalPaths, specRoot, spec);
}
