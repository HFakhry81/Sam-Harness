import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import {
  loadLevel3Plan,
  planFromWrites,
  planHasWork,
} from "../src/agency/delivery/level3Plan.js";
import {
  applyPlanFiles,
  resolveTargetRepo,
  shouldRunLevel3,
} from "../src/agent/level3Implement.js";
import {
  createImplementBranch,
  isGitRepo,
  rollbackToSnapshot,
  runRepoTests,
} from "../src/agency/delivery/gitSnapshot.js";

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sam-l3-"));
}

describe("Level-3 generic plan", () => {
  let dir: string;
  const prevTarget = process.env.TARGET_REPO;

  beforeEach(() => {
    dir = mkTmp();
  });

  afterEach(() => {
    if (prevTarget === undefined) delete process.env.TARGET_REPO;
    else process.env.TARGET_REPO = prevTarget;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("resolveTargetRepo prefers TARGET_REPO and never hardcodes product paths", () => {
    process.env.TARGET_REPO = dir;
    expect(resolveTargetRepo("do something")).toBe(path.normalize(dir));
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/agent/level3Implement.ts"),
      "utf-8"
    );
    expect(src).not.toMatch(/maw3ed|fanni|timeRange\.js|opsPg/i);
  });

  it("loads level3-plan.json and applies writes/patches", () => {
    const pack = path.join(dir, "pack");
    fs.mkdirSync(pack, { recursive: true });
    fs.writeFileSync(
      path.join(pack, "level3-plan.json"),
      JSON.stringify({
        title: "hello helper",
        writes: [
          {
            path: "hello.js",
            content: "module.exports = { n: 1 };\n",
          },
        ],
        patches: [],
        testCommand: process.execPath,
        testArgs: ["-e", "require('./hello.js')"],
      }),
      "utf-8"
    );
    const plan = loadLevel3Plan(pack);
    expect(plan).not.toBeNull();
    expect(planHasWork(plan!)).toBe(true);
    const changed = applyPlanFiles(dir, plan!);
    expect(changed.length).toBe(1);
    expect(fs.readFileSync(path.join(dir, "hello.js"), "utf-8")).toContain("n: 1");
  });

  it("applies find/replace patches", () => {
    fs.writeFileSync(path.join(dir, "a.js"), "const x = 1;\n", "utf-8");
    const plan = planFromWrites([], {
      patches: [{ path: "a.js", find: "const x = 1;", replace: "const x = 2;" }],
    });
    applyPlanFiles(dir, plan);
    expect(fs.readFileSync(path.join(dir, "a.js"), "utf-8")).toContain("x = 2");
  });

  it("git branch + rollback restores prior HEAD", () => {
    execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "t"], { cwd: dir, stdio: "ignore" });
    fs.writeFileSync(path.join(dir, "f.txt"), "v1\n", "utf-8");
    execFileSync("git", ["add", "."], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: dir, stdio: "ignore" });
    expect(isGitRepo(dir)).toBe(true);
    const snap = createImplementBranch(dir, "sam-harness/l3-test");
    expect(snap).not.toBeNull();
    fs.writeFileSync(path.join(dir, "f.txt"), "v2\n", "utf-8");
    rollbackToSnapshot(snap!);
    // Normalize CRLF (Windows git autocrlf) before comparing content
    const restored = fs
      .readFileSync(path.join(dir, "f.txt"), "utf-8")
      .replace(/\r\n/g, "\n");
    expect(restored).toBe("v1\n");
  });

  it("runRepoTests reports failure", () => {
    const r = runRepoTests(dir, process.execPath, ["-e", "process.exit(2)"]);
    expect(r.ok).toBe(false);
  });

  it("shouldRunLevel3 respects report-only wording without product names", () => {
    expect(shouldRunLevel3("REPORT PACK (no code edits)", [])).toBe(false);
    expect(shouldRunLevel3("CODE IMPLEMENTATION now", [])).toBe(true);
    expect(shouldRunLevel3("hello", ["--level3"])).toBe(true);
  });
});
