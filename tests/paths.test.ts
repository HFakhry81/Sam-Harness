import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertAllowedPath,
  assertShellCommandPathsAllowed,
  listAllowlistRoots,
  parseWorkspaceRootsEnv,
  resolveUserPath,
} from "../src/lib/paths.js";

const prevRoots = process.env.WORKSPACE_ROOTS;

afterEach(() => {
  if (prevRoots === undefined) delete process.env.WORKSPACE_ROOTS;
  else process.env.WORKSPACE_ROOTS = prevRoots;
});

describe("assertAllowedPath / explicit workspace sandbox", () => {
  it("lists cwd among allowlist roots by default", () => {
    delete process.env.WORKSPACE_ROOTS;
    const roots = listAllowlistRoots().map((r) => path.normalize(r).toLowerCase());
    expect(roots).toContain(path.normalize(process.cwd()).toLowerCase());
  });

  it("does not include whole D:/E: drives by default", () => {
    delete process.env.WORKSPACE_ROOTS;
    const roots = listAllowlistRoots().map((r) => path.normalize(r).toLowerCase());
    expect(roots.some((r) => /^[d-e]:\\?$/.test(r.replace(/\\+$/, "") + "\\") || r === "d:\\" || r === "e:\\")).toBe(
      false
    );
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

  it("denies paths outside configured roots", () => {
    delete process.env.WORKSPACE_ROOTS;
    const outsider =
      process.platform === "win32"
        ? "C:\\Temp\\sam-harness-outside-test"
        : "/var/tmp/sam-harness-outside-test";
    expect(() => assertAllowedPath(outsider)).toThrow(/outside allowlist/i);
  });

  it("honors WORKSPACE_ROOTS env allowlist", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sh-roots-"));
    process.env.WORKSPACE_ROOTS = tmp;
    expect(() => assertAllowedPath(path.join(tmp, "file.txt"))).not.toThrow();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("parses semicolon-separated Windows-style roots", () => {
    const parts = parseWorkspaceRootsEnv("D:\\Projects;E:\\UpNexa.com");
    expect(parts).toEqual(["D:\\Projects", "E:\\UpNexa.com"]);
  });

  it("resolves Desktop relative labels (path resolve only)", () => {
    const resolved = resolveUserPath("Desktop/notes.txt");
    expect(resolved.toLowerCase()).toContain("desktop");
    expect(resolved.endsWith("notes.txt")).toBe(true);
  });

  it("refuses targeting home root directly when home is an allowlisted root", () => {
    process.env.WORKSPACE_ROOTS = os.homedir();
    expect(() => assertAllowedPath(os.homedir())).toThrow(/home directory root/i);
  });

  it("blocks shell commands that reference paths outside allowlist", () => {
    delete process.env.WORKSPACE_ROOTS;
    const outsider =
      process.platform === "win32" ? "C:\\Windows\\win.ini" : "/etc/passwd";
    expect(() => assertShellCommandPathsAllowed(`type ${outsider}`)).toThrow(
      /Shell path blocked|outside allowlist|blocked/i
    );
  });

  it("rejects symlink escape when possible", () => {
    if (process.platform === "win32") {
      // Symlink creation often needs admin on Windows CI — skip soft
      return;
    }
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
