import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertAllowedPath,
  assertShellCommandPathsAllowed,
  denyPrefixes,
  isAgentWorkspace,
  listAllowlistRoots,
  parseWorkspaceRootsEnv,
  resolveUserPath,
} from "../src/lib/paths.js";
import { getOutputHome } from "../src/lib/outputHome.js";

const prevRoots = process.env.WORKSPACE_ROOTS;
const prevDeny = process.env.WORKSPACE_DENY;
const prevOut = process.env.SAM_OUTPUT_HOME;

afterEach(() => {
  if (prevRoots === undefined) delete process.env.WORKSPACE_ROOTS;
  else process.env.WORKSPACE_ROOTS = prevRoots;
  if (prevDeny === undefined) delete process.env.WORKSPACE_DENY;
  else process.env.WORKSPACE_DENY = prevDeny;
  if (prevOut === undefined) delete process.env.SAM_OUTPUT_HOME;
  else process.env.SAM_OUTPUT_HOME = prevOut;
});

describe("assertAllowedPath / desktop-controller sandbox", () => {
  it("lists cwd, home, and output home among default roots", () => {
    delete process.env.WORKSPACE_ROOTS;
    const roots = listAllowlistRoots().map((r) => path.normalize(r).toLowerCase());
    expect(roots).toContain(path.normalize(process.cwd()).toLowerCase());
    expect(roots).toContain(path.normalize(os.homedir()).toLowerCase());
    expect(roots).toContain(path.normalize(getOutputHome()).toLowerCase());
  });

  it("allows Desktop under the user environment by default", () => {
    delete process.env.WORKSPACE_ROOTS;
    const desk = path.join(os.homedir(), "Desktop", "sam-harness-allow-test.txt");
    expect(() => assertAllowedPath(desk)).not.toThrow();
  });

  it("allows paths under cwd", () => {
    expect(() =>
      assertAllowedPath(path.join(process.cwd(), "src", "lib", "paths.ts"))
    ).not.toThrow();
  });

  it("blocks OS-critical roots", () => {
    const blocked =
      process.platform === "win32"
        ? "C:\\Windows\\System32\\drivers"
        : "/etc/passwd";
    expect(() => assertAllowedPath(blocked)).toThrow(/blocked|outside allowlist/i);
  });

  it("blocks credential stores like ~/.ssh", () => {
    const ssh = path.join(os.homedir(), ".ssh", "id_rsa");
    expect(() => assertAllowedPath(ssh)).toThrow(/blocked/i);
  });

  it("blocks harness secret files under cwd", () => {
    expect(() =>
      assertAllowedPath(path.join(process.cwd(), ".controlplane-token"))
    ).toThrow(/blocked/i);
    expect(() =>
      assertAllowedPath(path.join(process.cwd(), "cost-ledger.json"))
    ).toThrow(/blocked/i);
  });

  it("WORKSPACE_ROOTS restricts the allowlist", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sh-roots-"));
    process.env.WORKSPACE_ROOTS = tmp;
    expect(() => assertAllowedPath(path.join(tmp, "file.txt"))).not.toThrow();
    const outsider = path.join(os.homedir(), "Desktop", "outside-restricted.txt");
    // Desktop may still be denied when roots are restricted (unless under cwd/output)
    if (!outsider.toLowerCase().startsWith(path.normalize(process.cwd()).toLowerCase())) {
      expect(() => assertAllowedPath(outsider)).toThrow(/outside allowlist/i);
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("WORKSPACE_DENY extends the deny list", () => {
    delete process.env.WORKSPACE_ROOTS;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sh-deny-"));
    process.env.WORKSPACE_DENY = tmp;
    const target = path.join(tmp, "secret.txt");
    expect(
      denyPrefixes().some(
        (d) =>
          d === path.normalize(tmp).toLowerCase() ||
          path.normalize(tmp).toLowerCase().startsWith(d + path.sep)
      )
    ).toBe(true);
    expect(() => assertAllowedPath(target)).toThrow(/blocked/i);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("parses semicolon-separated Windows-style roots", () => {
    const parts = parseWorkspaceRootsEnv("D:\\Projects;E:\\UpNexa.com");
    expect(parts).toEqual(["D:\\Projects", "E:\\UpNexa.com"]);
  });

  it("resolves Desktop relative labels", () => {
    const resolved = resolveUserPath("Desktop/notes.txt");
    expect(resolved.toLowerCase()).toContain("desktop");
    expect(resolved.endsWith("notes.txt")).toBe(true);
  });

  it("refuses targeting home root directly", () => {
    delete process.env.WORKSPACE_ROOTS;
    expect(() => assertAllowedPath(os.homedir())).toThrow(/home directory root/i);
  });

  it("blocks shell commands targeting denied OS paths", () => {
    delete process.env.WORKSPACE_ROOTS;
    const outsider =
      process.platform === "win32" ? "C:\\Windows\\win.ini" : "/etc/passwd";
    expect(() => assertShellCommandPathsAllowed(`type ${outsider}`)).toThrow(
      /Shell path blocked|outside allowlist|blocked/i
    );
  });

  it("marks cwd and output home as agent workspace", () => {
    expect(isAgentWorkspace(path.join(process.cwd(), "src"))).toBe(true);
    expect(isAgentWorkspace(path.join(getOutputHome(), "reports", "x.md"))).toBe(true);
  });

  it("rejects symlink escape into denied paths when possible", () => {
    if (process.platform === "win32") return;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sh-sym-"));
    process.env.WORKSPACE_ROOTS = tmp;
    const link = path.join(tmp, "escape");
    try {
      fs.symlinkSync("/etc", link);
      expect(() => assertAllowedPath(path.join(link, "passwd"))).toThrow(
        /blocked|escapes allowlist|outside allowlist/i
      );
    } catch (e: any) {
      if (/EPERM|operation not permitted/i.test(String(e?.message || e))) return;
      throw e;
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
