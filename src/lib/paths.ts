/**
 * Cross-platform path allowlist for real-PC operator tools.
 * Windows + macOS + Linux user spaces; block OS-critical roots.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

function homeDir(): string {
  return process.env.USERPROFILE || process.env.HOME || os.homedir();
}

function desktopDir(): string {
  const home = homeDir();
  if (process.platform === "darwin") {
    return path.join(home, "Desktop");
  }
  // Linux: prefer XDG user-dirs if present later; Desktop fallback
  return path.join(home, "Desktop");
}

const DENY_PREFIXES = [
  // Windows
  path.normalize("C:\\Windows"),
  path.normalize("C:\\Program Files"),
  path.normalize("C:\\Program Files (x86)"),
  path.normalize("C:\\ProgramData"),
  // Unix / macOS critical
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

function userRoots(): string[] {
  const home = homeDir();
  const roots = [
    path.normalize(process.cwd()),
    path.normalize(desktopDir()),
    path.normalize(path.join(home, "Documents")),
    path.normalize(path.join(home, "Downloads")),
    path.normalize(path.join(home, "Desktop")),
    path.normalize(home),
  ];
  if (process.platform === "win32") {
    roots.push(path.normalize("D:\\"), path.normalize("E:\\"));
  } else {
    // Common extra mounts (still must pass allowlist checks)
    roots.push(path.normalize("/tmp"), path.normalize(path.join(home, "tmp")));
  }
  return roots;
}

/** Public allowlist roots for Control Plane Operator panel (Computer Use style). */
export function listAllowlistRoots(): string[] {
  return [...new Set(userRoots())];
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

  // Windows drive letter without slash: D: → D:\
  if (process.platform === "win32" && /^[A-Za-z]:$/.test(cleaned)) {
    return path.normalize(cleaned + "\\");
  }

  if (path.isAbsolute(cleaned)) {
    return path.normalize(cleaned);
  }

  return path.normalize(path.resolve(process.cwd(), cleaned));
}

export function assertAllowedPath(absPath: string): void {
  const normalized = path.normalize(absPath);
  const lower = normalized.toLowerCase();

  for (const deny of DENY_PREFIXES) {
    if (lower === deny || lower.startsWith(deny + path.sep) || lower.startsWith(deny + "/")) {
      throw new Error(`Path blocked by safety policy: ${normalized}`);
    }
  }

  // Never allow deleting/writing the home root itself as a target file op via empty path tricks
  const home = path.normalize(homeDir()).toLowerCase();
  if (lower === home) {
    throw new Error(`Refusing to target home directory root directly: ${normalized}`);
  }

  const allowed = userRoots().some((root) => {
    const r = root.toLowerCase();
    const sep = r.endsWith("\\") || r.endsWith("/") ? "" : path.sep;
    return lower === r || lower.startsWith(r + sep) || lower.startsWith(r + "/") || lower.startsWith(r + "\\");
  });

  if (!allowed) {
    throw new Error(
      `Path outside allowlist (cwd/Desktop/Documents/Downloads/home` +
        (process.platform === "win32" ? "/D:/E:" : "/tmp") +
        `). Got: ${normalized}`
    );
  }
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
