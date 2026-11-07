/**
 * Scan git-tracked (or provided) text files for PEM private-key material.
 * Reports paths only — never prints key material.
 *
 * Short truncated armor used by redaction fixtures/evals is ignored; real
 * keys (substantial PEM bodies) and high-risk paths (*.key under certs/, etc.)
 * always fail.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** PEM private key begin markers (RSA / EC / OPENSSH / generic PKCS#8). */
export const PRIVATE_KEY_BEGIN_RE =
  /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/;

const PRIVATE_KEY_BLOCK_RE =
  /-----BEGIN ((?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY)-----([\s\S]*?)-----END \1-----/g;

/** Base64 body length above which a PEM block is treated as a real key. */
export const SUBSTANTIAL_PEM_BODY_CHARS = 200;

export type TrackedSecretHit = {
  path: string;
  kind: "pem_private_key" | "high_risk_key_path";
};

export type ScanTrackedSecretsResult = {
  ok: boolean;
  hits: TrackedSecretHit[];
  scanned: number;
};

const SKIP_NAME_RE =
  /(^|\/)(node_modules|\.git|dist|coverage|\.pnpm-store)(\/|$)/i;

/** High-risk tracked paths that must never hold key/cert material. */
export function isHighRiskSecretPath(relPath: string): boolean {
  const p = relPath.replace(/\\/g, "/");
  if (/(^|\/)certs\/README\.md$/i.test(p)) return false;
  if (/(^|\/)certs\//i.test(p)) return true;
  if (/\.(?:key|p12|pfx)$/i.test(p)) return true;
  if (/(^|\/)id_(?:rsa|ecdsa|ed25519|dsa)$/i.test(p)) return true;
  if (/\.private\.key$/i.test(p)) return true;
  // Allow *.pem only outside certs/ when content is not a private key —
  // high-risk path check for bare *.pem under certs already covered.
  return false;
}

/** True when content contains any PEM private-key armor (including fixtures). */
export function contentHasPemPrivateKey(text: string): boolean {
  return PRIVATE_KEY_BEGIN_RE.test(String(text ?? ""));
}

/**
 * True when content contains a PEM private-key block with a substantial body
 * (likely a real key, not a truncated redaction fixture).
 */
export function contentHasSubstantialPemPrivateKey(text: string): boolean {
  const input = String(text ?? "");
  PRIVATE_KEY_BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PRIVATE_KEY_BLOCK_RE.exec(input)) !== null) {
    const body = String(m[2] ?? "").replace(/\s+/g, "");
    if (body.length >= SUBSTANTIAL_PEM_BODY_CHARS) return true;
  }
  return false;
}

/**
 * List tracked files via `git ls-files`. Returns [] when not in a git work tree.
 */
export function listGitTrackedFiles(cwd: string): string[] {
  const probe = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (probe.status !== 0 || String(probe.stdout).trim() !== "true") {
    return [];
  }
  const listed = spawnSync("git", ["ls-files", "-z"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (listed.status !== 0) {
    return [];
  }
  return String(listed.stdout)
    .split("\0")
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !SKIP_NAME_RE.test(p));
}

/**
 * Scan paths for real PEM private keys / high-risk key paths.
 * On hit, records path only (no body).
 */
export function scanPathsForPemPrivateKeys(
  root: string,
  relPaths: string[]
): ScanTrackedSecretsResult {
  const hits: TrackedSecretHit[] = [];
  let scanned = 0;
  for (const rel of relPaths) {
    if (SKIP_NAME_RE.test(rel)) continue;
    const norm = rel.replace(/\\/g, "/");
    const abs = resolve(root, rel);

    if (isHighRiskSecretPath(norm)) {
      // Tracked high-risk path is itself a violation (even if empty/missing body).
      hits.push({ path: norm, kind: "high_risk_key_path" });
      scanned += 1;
      continue;
    }

    let buf: Buffer;
    try {
      buf = readFileSync(abs);
    } catch {
      continue;
    }
    // Skip obvious binaries (NUL in first 8KiB)
    const sample = buf.subarray(0, Math.min(buf.length, 8192));
    if (sample.includes(0)) continue;
    scanned += 1;
    const text = buf.toString("utf8");
    if (contentHasSubstantialPemPrivateKey(text)) {
      hits.push({ path: norm, kind: "pem_private_key" });
    }
  }
  return { ok: hits.length === 0, hits, scanned };
}

/** Scan all git-tracked files under `cwd` for PEM private keys. */
export function scanGitTrackedForPemPrivateKeys(
  cwd: string
): ScanTrackedSecretsResult {
  const files = listGitTrackedFiles(cwd);
  return scanPathsForPemPrivateKeys(cwd, files);
}
