/**
 * Guard: pack path resolution never lands inside the Sam-Harness repo,
 * and stubbed agency/chat/task flows must not create files in cwd/repo.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetActiveRunDirForTests,
  agentReportPath,
  beginOutputRun,
  endOutputRun,
  ensureOutputHome,
  getOutputHome,
  isUnderOutputHome,
} from "../src/lib/outputHome.js";
import {
  assertPackDirOutsideRepo,
  defaultProjectDocsRoot,
  resolveNextSamHarnessReviewDir,
} from "../src/lib/reviewPackDir.js";
import {
  __setPackWriteRootForTests,
  assertNoPackFilesInCwd,
  getPackWriteRoot,
  writePackArtifact,
} from "../src/lib/packWorkspace.js";
import { writeTaskFiles, buildTaskDraft } from "../src/controlplane/taskWriter.js";
import { getTaskDir } from "../src/lib/taskPaths.js";
import {
  __resetLegacyWarnForTests,
  scanLegacyRepoArtifacts,
  warnLegacyRepoArtifacts,
} from "../src/lib/legacyArtifacts.js";
import { saveSession, loadSession } from "../src/controlplane/session.js";
import { findLatestPackDir } from "../src/controlplane/artifacts.js";

const prevOut = process.env.SAM_OUTPUT_HOME;
let outHome: string;
let fakeRepo: string;

function snapshotTree(root: string): Set<string> {
  const out = new Set<string>();
  const walk = (dir: string, rel = "") => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        out.add(childRel + "/");
        walk(abs, childRel);
      } else if (e.isFile()) {
        out.add(childRel);
      }
    }
  };
  walk(root);
  return out;
}

beforeEach(() => {
  outHome = fs.mkdtempSync(path.join(os.tmpdir(), "sh-out-"));
  fakeRepo = fs.mkdtempSync(path.join(os.tmpdir(), "sh-repo-"));
  process.env.SAM_OUTPUT_HOME = outHome;
  __resetActiveRunDirForTests();
  __setPackWriteRootForTests(null);
  __resetLegacyWarnForTests();
  // Minimal "repo-like" tree
  fs.mkdirSync(path.join(fakeRepo, "docs"), { recursive: true });
  fs.mkdirSync(path.join(fakeRepo, "config"), { recursive: true });
  fs.writeFileSync(
    path.join(fakeRepo, "package.json"),
    JSON.stringify({ name: "Sam-Harness", version: "0.0.0" }),
    "utf-8"
  );
  fs.writeFileSync(path.join(fakeRepo, "SamHarness.bat"), "@echo off\n", "utf-8");
  fs.writeFileSync(
    path.join(fakeRepo, "docs", "README.md"),
    "# docs\n",
    "utf-8"
  );
});

afterEach(() => {
  endOutputRun();
  __resetActiveRunDirForTests();
  __setPackWriteRootForTests(null);
  if (prevOut === undefined) delete process.env.SAM_OUTPUT_HOME;
  else process.env.SAM_OUTPUT_HOME = prevOut;
  fs.rmSync(outHome, { recursive: true, force: true });
  fs.rmSync(fakeRepo, { recursive: true, force: true });
});

describe("pack path resolution never inside repo", () => {
  it("defaultProjectDocsRoot always resolves under SAM_OUTPUT_HOME/reports", () => {
    const docs = defaultProjectDocsRoot(fakeRepo);
    expect(isUnderOutputHome(docs)).toBe(true);
    expect(path.normalize(docs)).toBe(path.normalize(agentReportPath()));
    expect(docs.toLowerCase().includes(path.normalize(fakeRepo).toLowerCase())).toBe(
      false
    );
  });

  it("resolveNextSamHarnessReviewDir ignores legacy <repo>/docs roots", () => {
    const legacy = path.join(fakeRepo, "docs");
    const { dir } = resolveNextSamHarnessReviewDir(legacy);
    expect(isUnderOutputHome(dir)).toBe(true);
    expect(dir.toLowerCase().startsWith(path.normalize(fakeRepo).toLowerCase())).toBe(
      false
    );
    assertPackDirOutsideRepo(dir, fakeRepo);
  });

  it("assertPackDirOutsideRepo rejects a pack path inside the repo", () => {
    const bad = path.join(fakeRepo, "docs", "Sam-Harness no.1");
    fs.mkdirSync(bad, { recursive: true });
    expect(() => assertPackDirOutsideRepo(bad, fakeRepo)).toThrow(/SAM_OUTPUT_HOME|repo/i);
  });

  it("findLatestPackDir does not fall back to project docs/", () => {
    const decoy = path.join(fakeRepo, "docs", "Sam-Harness no.99");
    fs.mkdirSync(decoy, { recursive: true });
    fs.writeFileSync(path.join(decoy, "PACK_HANDOFF.md"), "# decoy\n", "utf-8");
    expect(findLatestPackDir(fakeRepo)).toBeNull();

    const real = resolveNextSamHarnessReviewDir().dir;
    fs.writeFileSync(path.join(real, "PACK_HANDOFF.md"), "# real\n", "utf-8");
    expect(path.normalize(findLatestPackDir(fakeRepo)!)).toBe(path.normalize(real));
  });
});

describe("stubbed flows leave no files in repo cwd", () => {
  it("task + pack + session writes stay under output home", () => {
    const before = snapshotTree(fakeRepo);
    const prevCwd = process.cwd();
    try {
      process.chdir(fakeRepo);
      ensureOutputHome();
      beginOutputRun("guard-run");
      __setPackWriteRootForTests(getPackWriteRoot("guard-run"));

      const draft = buildTaskDraft({
        prompt: "Write a short Sam-Harness capability report",
        title: "Self report",
        route: "architecture",
        targetRepo: fakeRepo,
      });
      // Force ready for write
      (draft as { ready: boolean }).ready = true;
      draft.needsClarification = [];
      writeTaskFiles(fakeRepo, draft);

      writePackArtifact("agency-verdict.md", "# verdict\n", { bom: true });
      writePackArtifact("evidence-pack.md", "# evidence\n", { bom: true });
      const { dir } = resolveNextSamHarnessReviewDir(defaultProjectDocsRoot(fakeRepo));
      fs.writeFileSync(path.join(dir, "PACK_HANDOFF.md"), "# pack\n", "utf-8");

      const session = loadSession(fakeRepo);
      session.entries.push({
        id: "e1",
        title: "t",
        route: "architecture",
        mode: "agency",
        promptPreview: "x",
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        exitCode: 0,
        success: true,
        summary: "ok",
        artifacts: [],
        logTail: "",
      });
      saveSession(fakeRepo, session);

      const after = snapshotTree(fakeRepo);
      const added = [...after].filter((x) => !before.has(x));
      expect(added).toEqual([]);

      const stray = assertNoPackFilesInCwd(fakeRepo);
      expect(stray.ok).toBe(true);

      expect(fs.existsSync(path.join(getTaskDir(), "task.ts"))).toBe(true);
      expect(isUnderOutputHome(dir)).toBe(true);
      expect(path.normalize(getOutputHome())).toBe(path.normalize(outHome));
    } finally {
      process.chdir(prevCwd);
    }
  });
});

describe("legacy artifact warning", () => {
  it("detects leftover packs under docs/ and warns in English ASCII", () => {
    fs.mkdirSync(path.join(fakeRepo, "docs", "Sam-Harness no.1"), {
      recursive: true,
    });
    fs.writeFileSync(path.join(fakeRepo, "evidence-pack.md"), "x", "utf-8");
    fs.writeFileSync(
      path.join(fakeRepo, "config", "team.backup-old.json"),
      "{}",
      "utf-8"
    );
    const scan = scanLegacyRepoArtifacts(fakeRepo);
    expect(scan.found.some((f) => f.includes("Sam-Harness no.1"))).toBe(true);
    expect(scan.found).toContain("evidence-pack.md");
    expect(scan.found.some((f) => f.includes("team.backup"))).toBe(true);

    const lines: string[] = [];
    warnLegacyRepoArtifacts(fakeRepo, (l) => lines.push(l));
    expect(lines.length).toBe(1);
    expect(lines[0]).toMatch(/WARNING: legacy run artifacts/i);
    expect(lines[0]).toMatch(/reports\//);
    // English ASCII only
    expect(/[^\x00-\x7F]/.test(lines[0])).toBe(false);
  });
});
