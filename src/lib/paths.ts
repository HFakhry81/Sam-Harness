/**
 * Desktop-controller filesystem sandbox.
 * Default: allow normal user environment (home, user folders, accessible drives).
 * Protected DENY list for OS / credentials / harness secrets.
 * WORKSPACE_ROOTS (optional) restricts to an explicit allowlist.
 * WORKSPACE_DENY extends the deny list.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { getOutputHome } from "./outputHome.js";

const CONFIG_FILE = "workspace-roots.json";

function homeDir(): string {
  return process.env.USERPROFILE || process.env.HOME || os.homedir();
}

function desktopDir(): string {
  return path.join(homeDir(), "Desktop");
}

/** Built-in sensitive / system locations — always denied. */
function builtinDenyPrefixes(): string[] {
  const home = homeDir();
  const list = [
    // Windows OS
    "C:\\Windows",
    "C:\\Program Files",
    "C:\\Program Files (x86)",
    "C:\\ProgramData",
    "C:\\Recovery",
    "C:\\$Recycle.Bin",
    "C:\\System Volume Information",
    // Unix / macOS critical
    "/etc",
    "/bin",
    "/sbin",
    "/usr",
    "/System",
    "/Library",
    "/private/etc",
    "/private/var/db",
    "/boot",
    "/dev",
    "/proc",
    "/sys",
    "/root",
    // Credential / secret stores (home-relative)
    path.join(home, ".ssh"),
    path.join(home, ".gnupg"),
    path.join(home, ".aws"),
    path.join(home, ".azure"),
    path.join(home, ".config", "gcloud"),
    path.join(home, ".config", "gh"),
    path.join(home, ".docker"),
    path.join(home, ".kube"),
    path.join(home, ".netrc"),
    path.join(home, ".npmrc"),
    // Browser profiles / credential DBs
    path.join(home, "AppData", "Local", "Google", "Chrome", "User Data"),
    path.join(home, "AppData", "Local", "Microsoft", "Edge", "User Data"),
    path.join(home, "AppData", "Roaming", "Mozilla", "Firefox", "Profiles"),
    path.join(home, "Library", "Application Support", "Google", "Chrome"),
    path.join(home, "Library", "Application Support", "Firefox", "Profiles"),
    path.join(home, ".config", "google-chrome"),
    path.join(home, ".mozilla", "firefox"),
    path.join(home, "Library", "Keychains"),
    path.join(home, "AppData", "Roaming", "Microsoft", "Credentials"),
    path.join(home, "AppData", "Local", "Microsoft", "Credentials"),
  ];
  return list.map((p) => path.normalize(p).toLowerCase());
}

/**
 * Env path list: prefer `;` and newlines (Windows-safe for `D:\...`).
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

export const parseWorkspaceDenyEnv = parseWorkspaceRootsEnv;

type WorkspaceConfig = {
  roots?: unknown;
  workspaceRoots?: unknown;
  deny?: unknown;
  workspaceDeny?: unknown;
};

function readWorkspaceConfig(cwd: string): WorkspaceConfig {
  const p = path.join(cwd, CONFIG_FILE);
  try {
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, "utf-8")) as WorkspaceConfig;
  } catch {
    return {};
  }
}

function configList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => String(x).trim()).filter(Boolean);
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

/** Existing Windows drive roots (A:\ … Z:\). */
export function listWindowsDriveRoots(): string[] {
  if (process.platform !== "win32") return [];
  const drives: string[] = [];
  for (let code = 65; code <= 90; code++) {
    const root = `${String.fromCharCode(code)}:\\`;
    try {
      if (fs.existsSync(root)) drives.push(path.normalize(root));
    } catch {
      /* ignore */
    }
  }
  return drives;
}

/**
 * Default allowlist: normal user environment (desktop-controller style).
 * When WORKSPACE_ROOTS / config.roots is set, that list *restricts* access
 * (plus cwd + output home so the agent can still operate).
 */
export function userRoots(cwd: string = process.cwd()): string[] {
  const cfg = readWorkspaceConfig(cwd);
  const explicit = [
    ...parseWorkspaceRootsEnv(process.env.WORKSPACE_ROOTS),
    ...configList(cfg.roots ?? cfg.workspaceRoots),
  ].map(normalizeRoot);

  const always = [
    normalizeRoot(cwd),
    normalizeRoot(getOutputHome()),
  ];

  if (explicit.length) {
    return [...new Set([...always, ...explicit])];
  }

  const home = homeDir();
  const defaults = [
    ...always,
    normalizeRoot(home),
    normalizeRoot(desktopDir()),
    normalizeRoot(path.join(home, "Documents")),
    normalizeRoot(path.join(home, "Downloads")),
    normalizeRoot(path.join(home, "Desktop")),
  ];

  if (process.platform === "win32") {
    defaults.push(...listWindowsDriveRoots());
  } else {
    defaults.push(
      normalizeRoot("/tmp"),
      normalizeRoot(path.join(home, "tmp")),
      normalizeRoot("/home"),
      normalizeRoot("/media"),
      normalizeRoot("/mnt"),
      normalizeRoot("/Volumes")
    );
  }

  return [...new Set(defaults)];
}

/** Effective deny prefixes (builtin + WORKSPACE_DENY + config + harness secrets). */
export function denyPrefixes(cwd: string = process.cwd()): string[] {
  const cfg = readWorkspaceConfig(cwd);
  const extra = [
    ...parseWorkspaceDenyEnv(process.env.WORKSPACE_DENY),
    ...configList(cfg.deny ?? cfg.workspaceDeny),
  ].map((p) => normalizeRoot(p).toLowerCase());

  const harnessSecrets = [
    path.join(cwd, ".controlplane-token"),
    path.join(cwd, ".env"),
    path.join(cwd, "cost-ledger.json"),
    path.join(cwd, "hybrid-profile.json"),
  ].map((p) => path.normalize(p).toLowerCase());

  return [...new Set([...builtinDenyPrefixes(), ...extra, ...harnessSecrets])];
}

/** Public allowlist roots for Control Plane Operator panel. */
export function listAllowlistRoots(cwd: string = process.cwd()): string[] {
  return userRoots(cwd);
}

/** True when path is under the harness project cwd or the agent output home. */
export function isAgentWorkspace(absPath: string, cwd: string = process.cwd()): boolean {
  const lower = path.normalize(absPath).toLowerCase();
  return (
    isUnderRoot(lower, cwd) ||
    isUnderRoot(lower, getOutputHome())
  );
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

function isDenied(normalizedLower: string, cwd: string): boolean {
  for (const deny of denyPrefixes(cwd)) {
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
 */
export function resolveSandboxPath(absPath: string): string {
  const normalized = path.normalize(absPath);
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

  return segments.length
    ? path.normalize(path.join(realBase, ...segments))
    : path.normalize(realBase);
}

export function assertAllowedPath(absPath: string, cwd: string = process.cwd()): void {
  const normalized = path.normalize(absPath);
  const lower = normalized.toLowerCase();

  if (isDenied(lower, cwd)) {
    throw new Error(`Path blocked by safety policy: ${normalized}`);
  }

  const home = path.normalize(homeDir()).toLowerCase();
  if (lower === home) {
    throw new Error(`Refusing to target home directory root directly: ${normalized}`);
  }

  const roots = userRoots(cwd);
  const lexicallyAllowed = roots.some((root) => isUnderRoot(lower, root));
  if (!lexicallyAllowed) {
    throw new Error(
      `Path outside allowlist (user environment / WORKSPACE_ROOTS). Got: ${normalized}`
    );
  }

  let real: string;
  try {
    real = resolveSandboxPath(normalized);
  } catch (e: any) {
    throw new Error(e?.message || `Path sandbox resolve failed: ${normalized}`);
  }
  const realLower = real.toLowerCase();
  if (isDenied(realLower, cwd)) {
    throw new Error(`Path blocked by safety policy (realpath): ${real}`);
  }
  const reallyAllowed = roots.some((root) => {
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
 */
export function assertShellCommandPathsAllowed(
  command: string,
  cwd: string = process.cwd()
): void {
  const paths: string[] = [];

  const quoted = command.match(/["']([^"']+)["']/g) || [];
  for (const q of quoted) {
    const inner = q.slice(1, -1).trim();
    if (looksLikeFsPath(inner)) paths.push(inner);
  }

  const bare =
    command.match(/(?:^|[\s=])((?:[A-Za-z]:\\|\\\\|\/)[^\s&|<>"']+)/g) || [];
  for (const m of bare) {
    const p = m.trim().replace(/^[\s=]+/, "");
    if (looksLikeFsPath(p)) paths.push(p);
  }

  const typeDir = command.match(/^(?:type|dir)\s+(\S+)/i);
  if (typeDir?.[1] && looksLikeFsPath(typeDir[1].replace(/^["']|["']$/g, ""))) {
    paths.push(typeDir[1].replace(/^["']|["']$/g, ""));
  }

  const unique = [...new Set(paths)];
  for (const raw of unique) {
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
