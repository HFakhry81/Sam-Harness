/**
 * Extract filesystem paths from owner prompts (Windows paths with spaces,
 * quotes, Arabic surrounding text). Classify as target repo vs spec/docs.
 */
import * as fs from "fs";
import * as path from "path";

export type ExtractedPathKind = "target_repo" | "spec_docs" | "unknown";

export type ExtractedPath = {
  raw: string;
  normalized: string;
  kind: ExtractedPathKind;
  exists: boolean;
  isDirectory: boolean;
  reason: string;
};

export type GoalPaths = {
  targetRepos: ExtractedPath[];
  specRoots: ExtractedPath[];
  other: ExtractedPath[];
  /** Human-readable goal text with paths preserved. */
  goalText: string;
};

const SPEC_HINT =
  /spec|docs?|document|مستند|مواصفات|مواصفة|متطلبات|requirement|brief|تصميم/i;
const REPO_HINT =
  /repo|project|code|كود|مشروع|مستودع|examine|حلل|افحص|against|مقابل/i;

/** Words that end an unquoted Windows path (English + Arabic). */
const PATH_STOP =
  /^(against|and|or|to|for|with|from|into|onto|produce|generate|create|write|run|then|that|which|while|when|where|the|a|an|of|on|at|by|as|vs|versus|مقابل|ضد|و|ثم|في|من|إلى|على|مع|حتى|لإنتاج|وانتج)$/i;

const QUOTE_CHARS = `"'«»“”‘’`;

/**
 * Truncate a path candidate that swallowed markdown / RTM prose
 * (e.g. `D:\...\Expensa\1. ## 3. Deterministic Requirement…`).
 */
export function sanitizeExtractedPath(raw: string): string {
  let p = String(raw || "").replace(/\r/g, "");
  // Hard stop at line breaks
  p = p.split("\n")[0] || "";
  // Stop before markdown heading / bold / table / backtick glue
  const mdCut = p.search(
    /(?:\s|^)(?:#{1,6}\s|\*\*|__|`|\|(?=\s)|\[REQ[-_]?\d)/i
  );
  if (mdCut > 2) p = p.slice(0, mdCut);
  // Stop before numbered-list marker glued after a path segment: `\1. ##` or ` 1. Text`
  const numCut = p.search(/[\\/\s]\d+\.\s+(?:#|\*\*|[A-Z])/);
  if (numCut > 2) p = p.slice(0, numCut);
  return cleanRaw(p);
}

function cleanRaw(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/^["'«»“”‘’]+|["'»«“”‘’]+$/g, "")
    .replace(/[.,;:!?]+$/g, "")
    .trim();
}

function isPathChar(ch: string): boolean {
  // Allow typical path characters including space (trimmed later via stopwords).
  // Never continue into markdown tokens (# * | ?) or newlines.
  return !/[<>|*?#`\r\n]/.test(ch);
}

function isPathStopToken(tok: string): boolean {
  const t = String(tok || "").replace(/[.,;:!?]+$/, "");
  if (!t) return true;
  if (PATH_STOP.test(t)) return true;
  if (/^[A-Za-z]:[\\/]/.test(t)) return true;
  if (/^#{1,6}/.test(t) || /^\*\*/.test(t) || /^\|/.test(t)) return true;
  // Numbered list / RTM glue: "1." "3." "12."
  if (/^\d+\.$/.test(t)) return true;
  // Coverage / RTM prose words that must never extend a filesystem path
  if (
    /^(coverage|summary|deterministic|requirement|traceability|matrix|implemented|partial|missing|status)$/i.test(
      t
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Scan text for Windows drive paths, honoring quotes and spaces.
 */
function findWindowsPaths(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let i = 0;
  while (i < text.length) {
    // Quoted Windows path: "E:\foo\bar" or 'D:\My Documents\Spendy'
    const q = text[i];
    if (QUOTE_CHARS.includes(q)) {
      const endQ = text.indexOf(q, i + 1);
      if (endQ > i + 1) {
        const inner = text.slice(i + 1, endQ);
        if (/^[A-Za-z]:[\\/]/.test(inner)) {
          const cleaned = sanitizeExtractedPath(inner);
          if (cleaned.length >= 3) {
            const key = cleaned.toLowerCase();
            if (!seen.has(key)) {
              seen.add(key);
              out.push(cleaned);
            }
          }
          i = endQ + 1;
          continue;
        }
      }
    }

    // Unquoted: drive letter + :\ or :/
    if (
      i + 2 < text.length &&
      /[A-Za-z]/.test(text[i]) &&
      text[i + 1] === ":" &&
      (text[i + 2] === "\\" || text[i + 2] === "/")
    ) {
      // Don't start mid-quote content already handled
      let j = i + 3;
      let lastGood = i + 3; // at least "E:\"
      while (j < text.length && isPathChar(text[j]) && !QUOTE_CHARS.includes(text[j])) {
        if (text[j] === " " || text[j] === "\t") {
          // Peek next token — stop if it's a prose stopword or another drive path
          const rest = text.slice(j + 1);
          const nextTok = rest.match(/^([^\s\\/]+)/);
          if (!nextTok) break;
          if (isPathStopToken(nextTok[1])) break;
          // Space + path segment (e.g. "My Documents") — keep going
          j += 1;
          continue;
        }
        j += 1;
        lastGood = j;
      }
      // Trim trailing spaces / punctuation
      let raw = text.slice(i, lastGood).replace(/[.,;:\s]+$/, "");
      // If we ended mid-segment after spaces, include through last non-space
      if (j > lastGood && text[lastGood] === " ") {
        // Include space-separated segments already validated
        raw = text.slice(i, j).replace(/[.,;:\s]+$/, "");
      }
      const cleaned = sanitizeExtractedPath(raw);
      if (cleaned.length >= 3) {
        const key = cleaned.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          out.push(cleaned);
        }
      }
      i = Math.max(j, i + 3);
      continue;
    }
    i += 1;
  }
  return out;
}

/**
 * Scan for Unix absolute paths (quoted or whitespace-bounded).
 */
function findUnixPaths(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  // Quoted first
  const quoted =
    /["'«»“”‘’](\/(?:[\w.@+-]+\/)+[\w.@+-]+)["'«»“”‘’]/g;
  let m: RegExpExecArray | null;
  while ((m = quoted.exec(text))) {
    const cleaned = cleanRaw(m[1]);
    const key = cleaned.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(cleaned);
    }
  }
  // Unquoted after whitespace / start / open paren
  const unquoted = /(?:^|[\s(])(\/(?:[\w.@+-]+\/)+[\w.@+-]+)/g;
  while ((m = unquoted.exec(text))) {
    const cleaned = cleanRaw(m[1]);
    const key = cleaned.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(cleaned);
    }
  }
  return out;
}

function contextAround(prompt: string, needle: string): string {
  const lower = prompt.toLowerCase();
  const idx = lower.indexOf(needle.toLowerCase());
  if (idx < 0) {
    // Try with backslash/forward slash normalization
    const n2 = needle.replace(/\//g, "\\");
    const idx2 = lower.indexOf(n2.toLowerCase());
    if (idx2 < 0) {
      const n3 = needle.replace(/\\/g, "/");
      const idx3 = lower.indexOf(n3.toLowerCase());
      if (idx3 < 0) return prompt.slice(0, 120);
      return prompt.slice(Math.max(0, idx3 - 48), idx3 + needle.length + 80);
    }
    return prompt.slice(Math.max(0, idx2 - 48), idx2 + needle.length + 80);
  }
  return prompt.slice(Math.max(0, idx - 48), idx + needle.length + 80);
}

function locateInPrompt(prompt: string, needle: string): number {
  const lower = prompt.toLowerCase();
  const n = needle.toLowerCase();
  let idx = lower.indexOf(n);
  if (idx >= 0) return idx;
  idx = lower.indexOf(n.replace(/\//g, "\\"));
  if (idx >= 0) return idx;
  return lower.indexOf(n.replace(/\\/g, "/"));
}

function classifyPath(
  normalized: string,
  prompt: string,
  exists: boolean,
  isDirectory: boolean
): { kind: ExtractedPathKind; reason: string } {
  const base = path.basename(normalized);
  const lower = normalized.toLowerCase();
  const idx = locateInPrompt(prompt, normalized);
  const before =
    idx >= 0 ? prompt.slice(Math.max(0, idx - 64), idx) : prompt.slice(0, 64);
  const after =
    idx >= 0
      ? prompt.slice(idx + normalized.length, idx + normalized.length + 64)
      : "";
  const ctx = `${before}${normalized}${after}`;

  // Path basename / path itself is the strongest cue
  if (SPEC_HINT.test(base) || /[/\\]docs?[/\\]|documents/i.test(lower)) {
    return { kind: "spec_docs", reason: "spec/docs cue in path name" };
  }

  // Prefer text BEFORE the path (examine project X … / spec docs in Y)
  if (
    /(?:spec|docs?|document|مواصفات|مستند|متطلبات)\b/i.test(before) ||
    (/(?:in|في)\s*$/i.test(before.trim()) && SPEC_HINT.test(before))
  ) {
    return { kind: "spec_docs", reason: "spec/docs cue before path" };
  }
  if (
    /(?:project|repo|code|مشروع|كود|مستودع)\b/i.test(before) ||
    /(?:examine|افحص|حلل)\b/i.test(before)
  ) {
    return { kind: "target_repo", reason: "repo cue before path" };
  }

  if (
    exists &&
    isDirectory &&
    (fs.existsSync(path.join(normalized, "package.json")) ||
      fs.existsSync(path.join(normalized, "pnpm-workspace.yaml")) ||
      fs.existsSync(path.join(normalized, ".git")))
  ) {
    return { kind: "target_repo", reason: "directory looks like a code repo" };
  }

  // Broader context (weaker)
  if (SPEC_HINT.test(ctx) && !REPO_HINT.test(before)) {
    return { kind: "spec_docs", reason: "spec/docs cue in surrounding text" };
  }
  if (REPO_HINT.test(ctx) && !SPEC_HINT.test(before)) {
    return { kind: "target_repo", reason: "repo cue in surrounding text" };
  }
  if (exists && isDirectory) {
    if (SPEC_HINT.test(base)) return { kind: "spec_docs", reason: "directory name" };
    return { kind: "target_repo", reason: "existing directory default repo" };
  }
  return { kind: "unknown", reason: "unclassified path" };
}

/**
 * Parse all filesystem paths from a prompt and classify them.
 */
export function extractGoalPaths(prompt: string): GoalPaths {
  const text = String(prompt || "");
  const found: ExtractedPath[] = [];
  const seen = new Set<string>();

  const push = (rawIn: string) => {
    const raw = sanitizeExtractedPath(rawIn);
    if (!raw || raw.length < 3) return;
    // Skip bare drive roots like "E:\"
    if (/^[A-Za-z]:[\\/]?$/.test(raw)) return;
    // Reject leftover markdown pollution
    if (/#{1,6}|\*\*|\|/.test(raw)) return;
    const normalized = path.normalize(raw);
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    let exists = false;
    let isDirectory = false;
    try {
      exists = fs.existsSync(normalized);
      if (exists) isDirectory = fs.statSync(normalized).isDirectory();
    } catch {
      exists = false;
    }
    const { kind, reason } = classifyPath(normalized, text, exists, isDirectory);
    found.push({ raw, normalized, kind, exists, isDirectory, reason });
  };

  for (const p of findWindowsPaths(text)) push(p);
  for (const p of findUnixPaths(text)) push(p);

  // Order-based fallback: first path near "project/repo" → target; near "spec/docs" → spec
  let targetRepos = found.filter((p) => p.kind === "target_repo");
  let specRoots = found.filter((p) => p.kind === "spec_docs");
  let other = found.filter((p) => p.kind === "unknown");

  // If two+ paths and none classified as spec, promote later path with docs cue or second dir
  if (found.length >= 2 && specRoots.length === 0) {
    for (let i = 1; i < found.length; i++) {
      const p = found[i];
      const ctx = contextAround(text, p.normalized);
      if (SPEC_HINT.test(ctx) || /documents|مواصفات|مستند/i.test(ctx)) {
        p.kind = "spec_docs";
        p.reason = "later path with spec/docs context";
      } else if (targetRepos.length >= 1 && p.kind === "unknown") {
        p.kind = "spec_docs";
        p.reason = "second path treated as spec/docs source";
      }
    }
    targetRepos = found.filter((p) => p.kind === "target_repo");
    specRoots = found.filter((p) => p.kind === "spec_docs");
    other = found.filter((p) => p.kind === "unknown");
  }

  // If we have 2+ dirs and only one classified as repo, rest existing dirs → spec
  if (targetRepos.length >= 1 && specRoots.length === 0) {
    for (const p of other) {
      if (p.exists && p.isDirectory && p.normalized !== targetRepos[0].normalized) {
        p.kind = "spec_docs";
        p.reason = "second directory treated as spec/docs source";
        specRoots.push(p);
      }
    }
  }

  // First unclassified existing package.json dir → target
  if (targetRepos.length === 0) {
    for (const p of found) {
      if (
        p.exists &&
        p.isDirectory &&
        fs.existsSync(path.join(p.normalized, "package.json"))
      ) {
        p.kind = "target_repo";
        p.reason = "package.json directory promoted to target repo";
        break;
      }
    }
    // Or first path when prompt says examine/افحص
    if (!found.some((p) => p.kind === "target_repo") && found.length >= 1 && REPO_HINT.test(text)) {
      if (found[0].kind !== "spec_docs") {
        found[0].kind = "target_repo";
        found[0].reason = "first path promoted to target repo";
      }
    }
  }

  targetRepos = found.filter((p) => p.kind === "target_repo");
  specRoots = found.filter((p) => p.kind === "spec_docs");
  const used = new Set(
    [...targetRepos, ...specRoots].map((p) => p.normalized.toLowerCase())
  );
  const otherFinal = found.filter((p) => !used.has(p.normalized.toLowerCase()));

  return {
    targetRepos,
    specRoots,
    other: otherFinal,
    goalText: text.trim(),
  };
}

/** Pick primary target repo path (first existing, else first). */
export function primaryTargetRepo(
  paths: GoalPaths,
  fallback?: string
): string | undefined {
  const hit =
    paths.targetRepos.find((p) => p.exists) ||
    paths.targetRepos[0] ||
    paths.other.find((p) => p.exists && p.isDirectory);
  return hit?.normalized || fallback;
}

export function primarySpecRoot(paths: GoalPaths): string | undefined {
  const hit = paths.specRoots.find((p) => p.exists) || paths.specRoots[0];
  return hit?.normalized;
}
