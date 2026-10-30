import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import {
  assertAllowedPath,
  listAllowlistRoots,
  resolveUserPath,
} from "../src/lib/paths.js";

describe("assertAllowedPath / path allowlist", () => {
  it("lists cwd among allowlist roots", () => {
    const roots = listAllowlistRoots().map((r) => path.normalize(r).toLowerCase());
    expect(roots).toContain(path.normalize(process.cwd()).toLowerCase());
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

  it("resolves Desktop relative labels", () => {
    const resolved = resolveUserPath("Desktop/notes.txt");
    expect(resolved.toLowerCase()).toContain("desktop");
    expect(resolved.endsWith(`notes.txt`) || resolved.endsWith(`notes.txt`)).toBe(
      true
    );
  });

  it("refuses targeting home root directly", () => {
    expect(() => assertAllowedPath(os.homedir())).toThrow(/home directory root/i);
  });
});
