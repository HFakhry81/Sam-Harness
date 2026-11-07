/**
 * Guard: no git-tracked PEM private keys; local cert generation stays gitignored.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  contentHasPemPrivateKey,
  contentHasSubstantialPemPrivateKey,
  isHighRiskSecretPath,
  scanGitTrackedForPemPrivateKeys,
  scanPathsForPemPrivateKeys,
} from "../src/lib/security/trackedSecrets.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("tracked PEM private key detection", () => {
  it("detects PEM armor without requiring a full parse", () => {
    expect(
      contentHasPemPrivateKey(
        "-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----\n"
      )
    ).toBe(true);
    expect(
      contentHasPemPrivateKey(
        "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n"
      )
    ).toBe(true);
    expect(
      contentHasPemPrivateKey(
        "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n"
      )
    ).toBe(false);
    expect(contentHasPemPrivateKey("no secrets here")).toBe(false);
  });

  it("ignores truncated fixture armor but flags substantial bodies", () => {
    const fixture =
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA1234\n-----END RSA PRIVATE KEY-----\n";
    expect(contentHasPemPrivateKey(fixture)).toBe(true);
    expect(contentHasSubstantialPemPrivateKey(fixture)).toBe(false);
    const substantial =
      "-----BEGIN RSA PRIVATE KEY-----\n" +
      "A".repeat(240) +
      "\n-----END RSA PRIVATE KEY-----\n";
    expect(contentHasSubstantialPemPrivateKey(substantial)).toBe(true);
  });

  it("treats certs/* and *.key as high-risk paths", () => {
    expect(isHighRiskSecretPath("certs/server.key")).toBe(true);
    expect(isHighRiskSecretPath("certs/server.crt")).toBe(true);
    expect(isHighRiskSecretPath("certs/README.md")).toBe(false);
    expect(isHighRiskSecretPath("notes/planted.key")).toBe(true);
    expect(isHighRiskSecretPath("tests/phase1-hybrid.test.ts")).toBe(false);
  });

  it("reports path only for a planted key file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sh-secrets-"));
    tmpDirs.push(dir);
    const rel = "planted.key";
    // High-risk path alone is enough — body optional
    fs.writeFileSync(path.join(dir, rel), "placeholder\n", "utf8");
    fs.writeFileSync(path.join(dir, "ok.txt"), "hello\n", "utf8");
    const result = scanPathsForPemPrivateKeys(dir, [rel, "ok.txt"]);
    expect(result.ok).toBe(false);
    expect(result.hits).toEqual([{ path: rel, kind: "high_risk_key_path" }]);
    expect(JSON.stringify(result.hits)).not.toMatch(/BEGIN /);
  });

  it("flags substantial PEM hidden in a markdown note", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sh-secrets-md-"));
    tmpDirs.push(dir);
    const rel = "docs/note.md";
    fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, rel),
      "# oops\n-----BEGIN PRIVATE KEY-----\n" +
        "B".repeat(240) +
        "\n-----END PRIVATE KEY-----\n",
      "utf8"
    );
    const result = scanPathsForPemPrivateKeys(dir, [rel]);
    expect(result.ok).toBe(false);
    expect(result.hits).toEqual([{ path: rel, kind: "pem_private_key" }]);
  });

  it("repo HEAD has no git-tracked real PEM private keys", () => {
    const result = scanGitTrackedForPemPrivateKeys(repoRoot);
    expect(result.ok, JSON.stringify(result.hits)).toBe(true);
    expect(result.scanned).toBeGreaterThan(10);
  });
});

describe("local cert generation", () => {
  it("generate-dev-certs writes key+crt under a temp HOME-style certs dir via openssl when available", () => {
    const openssl = spawnSync("openssl", ["version"], { encoding: "utf8" });
    if (openssl.status !== 0) {
      // Environment without openssl — skip generation integration
      expect(openssl.status).not.toBe(0);
      return;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sh-certs-"));
    tmpDirs.push(dir);
    const keyPath = path.join(dir, "server.key");
    const crtPath = path.join(dir, "server.crt");
    const gen = spawnSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-keyout",
        keyPath,
        "-out",
        crtPath,
        "-days",
        "1",
        "-nodes",
        "-subj",
        "/CN=localhost",
      ],
      { encoding: "utf8" }
    );
    expect(gen.status).toBe(0);
    expect(fs.existsSync(keyPath)).toBe(true);
    expect(fs.existsSync(crtPath)).toBe(true);
    const keyText = fs.readFileSync(keyPath, "utf8");
    expect(contentHasPemPrivateKey(keyText)).toBe(true);
    // Matching moduli prove key/cert pair without dumping material
    const keyMod = spawnSync(
      "openssl",
      ["rsa", "-in", keyPath, "-noout", "-modulus"],
      { encoding: "utf8" }
    );
    const crtMod = spawnSync(
      "openssl",
      ["x509", "-in", crtPath, "-noout", "-modulus"],
      { encoding: "utf8" }
    );
    expect(keyMod.status).toBe(0);
    expect(crtMod.status).toBe(0);
    expect(String(keyMod.stdout).trim()).toBe(String(crtMod.stdout).trim());
    expect(String(keyMod.stdout)).toMatch(/^Modulus=/);
  });

  it("gitignore ignores certs/server.key and certs/server.crt", () => {
    const check = spawnSync(
      "git",
      ["check-ignore", "-v", "certs/server.key", "certs/server.crt"],
      { cwd: repoRoot, encoding: "utf8" }
    );
    // Both paths should be ignored (exit 0); output mentions each path
    expect(check.status).toBe(0);
    expect(check.stdout).toMatch(/server\.key/);
    expect(check.stdout).toMatch(/server\.crt/);
  });
});
