import * as path from "path";
import { describe, expect, it } from "vitest";
import { scanRepoEvidence } from "../src/agency/evidence.js";

describe("evidence collection", () => {
  const root = path.resolve(".");

  it("returns empty pack when target is missing", () => {
    const pack = scanRepoEvidence(path.join(root, "__missing_repo__"));
    expect(pack.hits).toEqual([]);
    expect(pack.summaryMarkdown).toMatch(/Target missing/);
  });

  it("includes Control Plane paths for memory/UI goals", () => {
    const pack = scanRepoEvidence(root, {
      goal: "راجع project-memory و Daily Ops وعارض التقارير على صفحة الانتهاء في Control Plane",
    });
    const paths = new Set(pack.hits.map((h) => h.path.replace(/\\/g, "/")));
    expect(paths.has("src/controlplane/projectMemory.ts")).toBe(true);
    expect(paths.has("src/controlplane/dailyOps.ts")).toBe(true);
    expect(paths.has("src/controlplane/artifacts.ts")).toBe(true);
    expect(pack.hits.length).toBeGreaterThanOrEqual(3);
  });

  it("produces citable relative paths under the repo", () => {
    const pack = scanRepoEvidence(root, { goal: "analyze src and docs" });
    for (const hit of pack.hits.slice(0, 20)) {
      expect(hit.path.includes("\\")).toBe(false);
      expect(path.isAbsolute(hit.path)).toBe(false);
      expect(["file", "dir"]).toContain(hit.kind);
    }
  });
});
