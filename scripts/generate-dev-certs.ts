#!/usr/bin/env tsx
/**
 * Generate local development TLS material under certs/ (gitignored).
 * English-only ASCII console output. Never prints private key material.
 *
 * Prefers openssl when available; falls back to Node crypto key + openssl
 * req when needed. Control Plane TLS wiring is separate — this only produces
 * files for local experiments without committing secrets.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateKeyPairSync } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const certsDir = join(root, "certs");
const keyPath = join(certsDir, "server.key");
const crtPath = join(certsDir, "server.crt");

function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; input?: string } = {}
) {
  return spawnSync(cmd, args, {
    cwd: opts.cwd ?? root,
    encoding: "utf8",
    input: opts.input,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function hasOpenssl(): boolean {
  const r = run("openssl", ["version"]);
  return r.status === 0;
}

mkdirSync(certsDir, { recursive: true });

if (existsSync(keyPath) || existsSync(crtPath)) {
  if (process.env.SAM_CERTS_FORCE !== "1") {
    console.error(
      "[certs] Refusing to overwrite existing certs/server.key or certs/server.crt."
    );
    console.error("[certs] Set SAM_CERTS_FORCE=1 to regenerate.");
    process.exit(1);
  }
}

if (!hasOpenssl()) {
  // Still emit a PKCS#8 key so local tooling can experiment; cert needs openssl.
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  writeFileSync(keyPath, pem, { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(keyPath, 0o600);
  } catch {
    /* windows may ignore mode */
  }
  console.error(
    "[certs] openssl not found; wrote certs/server.key only (no certificate)."
  );
  console.error(
    "[certs] Install openssl and re-run with SAM_CERTS_FORCE=1 to create server.crt."
  );
  process.exit(1);
}

const gen = run("openssl", [
  "req",
  "-x509",
  "-newkey",
  "rsa:2048",
  "-keyout",
  keyPath,
  "-out",
  crtPath,
  "-days",
  "365",
  "-nodes",
  "-subj",
  "/CN=localhost",
]);

if (gen.status !== 0) {
  console.error("[certs] openssl failed to generate local certs.");
  const err = String(gen.stderr || gen.stdout || "").trim();
  if (err) {
    // Avoid echoing anything that looks like key armor
    const safe = err
      .split(/\r?\n/)
      .filter((l) => !/PRIVATE KEY|BEGIN |END /i.test(l))
      .slice(0, 8)
      .join("\n");
    if (safe) console.error(safe);
  }
  process.exit(1);
}

try {
  chmodSync(keyPath, 0o600);
} catch {
  /* windows may ignore mode */
}

console.log("[certs] Wrote certs/server.key and certs/server.crt (gitignored).");
console.log("[certs] CN=localhost, self-signed, 365 days. Do not commit these files.");
process.exit(0);
