/**
 * Explicit workspace-root sandbox for operator tools.
 * Deny-by-default: only cwd + WORKSPACE_ROOTS / workspace-roots.json.
 * Windows + POSIX paths; realpath/symlink escape checks.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const CONFIG_FILE = "workspace-roots.json";

function homeDir(): string {
  return process.env.USERPROFILE || process.env.HOME || os.homedir();
}

function desktopDir(): string {
  const home = homeDir();
  if (process.platform === "darwin") {
    return path.join(home, "Desktop");
  }
  return path.join(home, "Desktop");
}

const DENY_PREFIXES = [
  path.normalize("C:\\Windows"),
  path.normalize("C:\\Program Files"),
  path.normalize("C:\\Program Files (x86)"),
  path.normalize("C:\\ProgramData"),
  path.normalize("/etc"),
  path.normalize("/bin"),
  path.normalize("/sbin"),
  path.normalize("/usr"),
  path.normalize("/System"),
  path.normalize("/Library"),
  path.normalize("/private/etc"),
  path.normalize("/boot"),
  path.normalize("/dev"),
  path.normalize("/proc"),
  path.normalize("/sys"),
  path.normalize("/root"),
].map((p) => p.toLowerCase());

/**
 * Env allowlist split: prefer `;` and newlines (Windows-safe for `D:\...`).
 * Also accepts `path.delimiter` when no `;` is present.
 */
export function parseWorkspaceRootsEnv(raw: string | undefined): string[] {
  const text = String(raw || "").trim();
  if (!text) return [];
  if (/[;\n\r]/.test(text)) {
    return text
      .split(/[;\n\r]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (path.delimiter !== ";" && text.includes(path.delimiter)) {
    return text
      .split(path.delimiter)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [text];
}

function readConfigRoots(cwd: string): string[] {
  const p = path.join(cwd, CONFIG_FILE);
  try {
    if (!fs.existsSync(p)) return [];
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as {
      roots?: unknown;
      workspaceRoots?: unknown;
    };
    const list = raw.roots ?? raw.workspaceRoots;
    if (!Array.isArray(list)) return [];
    return list.map((x) => String(x).trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeRoot(raw: string): string {
  let cleaned = raw.replace(/^["']|["']$/g, "").trim();
  if (cleaned.startsWith("~/") || cleaned === "~") {
    cleaned = path.join(homeDir(), cleaned.slice(2));
  }
  if (process.platform === "win32" && /^[A-Za-z]:$/.test(cleaned)) {
    cleaned = cleaned + "\\";
  }
  return path.normalize(path.resolve(cleaned));
}

/**
 * Explicit allowlist roots. Always includes process.cwd().
 * Extra roots from WORKSPACE_ROOTS env and workspace-roots.json only.
 * Whole-drive D:\\ / E:\\ are NOT included unless explicitly configured.
 */
export function userRoots(cwd: string = process.cwd()): string[] {
  const roots = [
    normalizeRoot(cwd),
    ...parseWorkspaceRootsEnv(process.env.WORKSPACE_ROOTS).map(normalizeRoot),
    ...readConfigRoots(cwd).map(normalizeRoot),
  ];
  return [...new Set(roots)];
}

/** Public allowlist roots for Control Plane Operator panel. */
export function listAllowlistRoots(cwd: string = process.cwd()): string[] {
  return userRoots(cwd);
}

/** Resolve Desktop / ~ / relative / absolute paths into a normalized absolute path. */
export function resolveUserPath(rawPath: string): string {
  let cleaned = rawPath.replace(/^["']|["']$/g, "").trim();
  const home = homeDir();

  if (cleaned.startsWith("~/") || cleaned === "~") {
    cleaned = path.join(home, cleaned.slice(2));
  }

  if (/^(desktop|سطح المكتب)/i.test(cleaned)) {
    const rest = cleaned.replace(/^(desktop|سطح المكتب)[\\/]?/i, "");
    return path.normalize(path.join(desktopDir(), rest || ""));
  }

  if (/^(documents|المستندات)/i.test(cleaned)) {
    const rest = cleaned.replace(/^(documents|المستندات)[\\/]?/i, "");
    return path.normalize(path.join(home, "Documents", rest || ""));
  }

  if (/^(downloads|التنزيلات)/i.test(cleaned)) {
    const rest = cleaned.replace(/^(downloads|التنزيلات)[\\/]?/i, "");
    return path.normalize(path.join(home, "Downloads", rest || ""));
  }

  if (process.platform === "win32" && /^[A-Za-z]:$/.test(cleaned)) {
    return path.normalize(cleaned + "\\");
  }

  if (path.isAbsolute(cleaned)) {
    return path.normalize(cleaned);
  }

  return path.normalize(path.resolve(process.cwd(), cleaned));
}

function isDenied(normalizedLower: string): boolean {
  for (const deny of DENY_PREFIXES) {
    if (
      normalizedLower === deny ||
      normalizedLower.startsWith(deny + path.sep) ||
      normalizedLower.startsWith(deny + "/") ||
      normalizedLower.startsWith(deny + "\\")
    ) {
      return true;
    }
  }
  return false;
}

function isUnderRoot(candidateLower: string, root: string): boolean {
  const r = path.normalize(root).toLowerCase();
  const sep = r.endsWith("\\") || r.endsWith("/") ? "" : path.sep;
  return (
    candidateLower === r ||
    candidateLower.startsWith(r + sep) ||
    candidateLower.startsWith(r + "/") ||
    candidateLower.startsWith(r + "\\")
  );
}

/**
 * Resolve symlinks / .. escapes: realpath of existing path, or deepest existing ancestor.
 * Rejects when the real path escapes the allowlist even if the lexical path looked allowed.
 */
export function resolveSandboxPath(absPath: string): string {
  const normalized = path.normalize(absPath);
  // Reject embedded nulls / alternate streams tricks lightly
  if (normalized.includes("\0")) {
    throw new Error(`Path blocked by safety policy: null byte`);
  }

  let probe = normalized;
  const segments: string[] = [];
  while (probe && !fs.existsSync(probe)) {
    segments.unshift(path.basename(probe));
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }

  let realBase = probe;
  try {
    if (fs.existsSync(probe)) {
      realBase = fs.realpathSync(probe);
    }
  } catch {
    realBase = path.normalize(probe);
  }

  const rebuilt = segments.length ? path.normalize(path.join(realBase, ...segments)) : path.normalize(realBase);
  return rebuilt;
}

export function assertAllowedPath(absPath: string, cwd: string = process.cwd()): void {
  const normalized = path.normalize(absPath);
  const lower = normalized.toLowerCase();

  if (isDenied(lower)) {
    throw new Error(`Path blocked by safety policy: ${normalized}`);
  }

  const home = path.normalize(homeDir()).toLowerCase();
  if (lower === home) {
    throw new Error(`Refusing to target home directory root directly: ${normalized}`);
  }

  // Lexical allowlist check first
  const roots = userRoots(cwd);
  const lexicallyAllowed = roots.some((root) => isUnderRoot(lower, root));
  if (!lexicallyAllowed) {
    throw new Error(
      `Path outside allowlist (workspace roots only — set WORKSPACE_ROOTS or workspace-roots.json). Got: ${normalized}`
    );
  }

  // Symlink / realpath escape check
  let real: string;
  try {
    real = resolveSandboxPath(normalized);
  } catch (e: any) {
    throw new Error(e?.message || `Path sandbox resolve failed: ${normalized}`);
  }
  const realLower = real.toLowerCase();
  if (isDenied(realLower)) {
    throw new Error(`Path blocked by safety policy (realpath): ${real}`);
  }
  const reallyAllowed = roots.some((root) => {
    // Compare against realpath of root when possible
    let rootReal = root;
    try {
      if (fs.existsSync(root)) rootReal = fs.realpathSync(root);
    } catch {
      /* keep */
    }
    return isUnderRoot(realLower, rootReal) || isUnderRoot(realLower, root);
  });
  if (!reallyAllowed) {
    throw new Error(
      `Path escapes allowlist via symlink/realpath. Got: ${normalized} → ${real}`
    );
  }
}

/**
 * Extract filesystem path-like tokens from a shell command and assert each.
 * Used by run_shell so commands cannot target paths outside the sandbox.
 */
export function assertShellCommandPathsAllowed(
  command: string,
  cwd: string = process.cwd()
): void {
  const paths: string[] = [];

  // Quoted paths
  const quoted = command.match(/["']([^"']+)["']/g) || [];
  for (const q of quoted) {
    const inner = q.slice(1, -1).trim();
    if (looksLikeFsPath(inner)) paths.push(inner);
  }

  // Windows drives / UNC-ish / absolute posix
  const bare =
    command.match(/(?:^|[\s=])((?:[A-Za-z]:\\|\\\\|\/)[^\s&|<>"']+)/g) || [];
  for (const m of bare) {
    const p = m.trim().replace(/^[\s=]+/, "");
    if (looksLikeFsPath(p)) paths.push(p);
  }

  // type/dir first argument
  const typeDir = command.match(/^(?:type|dir)\s+(\S+)/i);
  if (typeDir?.[1] && looksLikeFsPath(typeDir[1].replace(/^["']|["']$/g, ""))) {
    paths.push(typeDir[1].replace(/^["']|["']$/g, ""));
  }

  const unique = [...new Set(paths)];
  for (const raw of unique) {
    // Skip pure switches / wildcards-only that are not rooted
    if (/^-\w/.test(raw)) continue;
    try {
      const abs = resolveUserPath(raw);
      assertAllowedPath(abs, cwd);
    } catch (e: any) {
      throw new Error(`Shell path blocked: ${raw} — ${e?.message || e}`);
    }
  }
}

function looksLikeFsPath(s: string): boolean {
  if (!s || s.length < 2) return false;
  if (/^[A-Za-z]:[\\/]/.test(s)) return true;
  if (s.startsWith("/") || s.startsWith("\\\\")) return true;
  if (/^(desktop|documents|downloads|~[/\\])/i.test(s)) return true;
  if (/[\\/]/.test(s) && /\.\w{1,8}$/.test(s)) return true;
  return false;
}

export function isDriveRoot(absPath: string): boolean {
  const n = path.normalize(absPath);
  if (process.platform === "win32") {
    return /^[A-Za-z]:\\?$/.test(n.replace(/\\+$/, "") + "\\") || n === path.parse(n).root;
  }
  return n === "/";
}

export function ensureParentDir(absFile: string): void {
  const dir = path.dirname(absFile);
  if (!dir || isDriveRoot(dir) || dir === path.parse(absFile).root) return;
  fs.mkdirSync(dir, { recursive: true });
}
