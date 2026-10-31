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
  mirrorRunArtifacts,
} from "../src/lib/outputHome.js";
import { defaultProjectDocsRoot } from "../src/lib/reviewPackDir.js";

const prevOut = process.env.SAM_OUTPUT_HOME;
let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sh-out-"));
  process.env.SAM_OUTPUT_HOME = tmp;
  __resetActiveRunDirForTests();
});

afterEach(() => {
  endOutputRun();
  __resetActiveRunDirForTests();
  if (prevOut === undefined) delete process.env.SAM_OUTPUT_HOME;
  else process.env.SAM_OUTPUT_HOME = prevOut;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("SAM_OUTPUT_HOME layout", () => {
  it("defaults under Documents/Sam-Harness when unset", () => {
    delete process.env.SAM_OUTPUT_HOME;
    const home = getOutputHome();
    expect(home.toLowerCase()).toContain("documents");
    expect(home.toLowerCase()).toMatch(/sam-harness/i);
  });

  it("creates reports/tasks/state/memory/conversations/backups/logs (+compat)", () => {
    const layout = ensureOutputHome();
    expect(layout.home).toBe(path.normalize(tmp));
    for (const key of [
      "reports",
      "tasks",
      "state",
      "memory",
      "conversations",
      "backups",
      "logs",
      "documents",
      "exports",
      "runs",
      "temp",
    ] as const) {
      expect(fs.existsSync(layout[key])).toBe(true);
    }
  });

  it("beginOutputRun creates dated run folders", () => {
    const run = beginOutputRun("run-test");
    expect(run.runDir).toContain(`${path.sep}runs${path.sep}`);
    expect(fs.existsSync(run.artifacts)).toBe(true);
    expect(fs.existsSync(run.logs)).toBe(true);
  });

  it("mirrors cwd artifacts into the active run", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sh-cwd-"));
    fs.writeFileSync(path.join(cwd, "final-report.md"), "# ok\n", "utf-8");
    beginOutputRun("mirror-1");
    const dest = mirrorRunArtifacts(cwd);
    expect(dest).toBeTruthy();
    expect(fs.existsSync(path.join(dest!, "final-report.md"))).toBe(true);
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("routes every pack root to output reports/ (never <repo>/docs)", () => {
    expect(path.normalize(defaultProjectDocsRoot(process.cwd()))).toBe(
      path.normalize(agentReportPath())
    );
    expect(path.normalize(defaultProjectDocsRoot("/tmp/some-client-repo"))).toBe(
      path.normalize(agentReportPath())
    );
  });
});
