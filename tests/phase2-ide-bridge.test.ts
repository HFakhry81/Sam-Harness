/**
 * Phase 2 — editor-agnostic IDE bridge: queue/transport, diff applier, safety gates.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetIdeBridgeForTests,
  completeIdeCommand,
  enqueueIdeCommand,
  ideApplyDiff,
  ideOpenFile,
  isIdeConnected,
  pendingIdeCommandCount,
  pollIdeCommands,
  waitForIdeCommand,
} from "../src/ide/bridge.js";
import { registerSourceRoots, resetWritePolicy } from "../src/lib/writePolicy.js";

const requireCjs = createRequire(import.meta.url);
const { applyUnifiedDiff } = requireCjs(
  fileURLToPath(new URL("../ide/shared/unifiedDiff.cjs", import.meta.url))
) as { applyUnifiedDiff: (original: string, diff: string) => string };

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sh-ide-"));
  __resetIdeBridgeForTests();
  resetWritePolicy();
  delete process.env.SAM_IDE_ALLOW_WRITE;
  delete process.env.SAM_IDE_AUTO_APPROVE;
});

afterEach(() => {
  __resetIdeBridgeForTests();
  resetWritePolicy();
  delete process.env.SAM_IDE_ALLOW_WRITE;
  delete process.env.SAM_IDE_AUTO_APPROVE;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("phase 2 — unified diff applier", () => {
  it("applies a single hunk", () => {
    const before = "line1\nline2\nline3\n";
    const diff = ["@@ -1,3 +1,3 @@", " line1", "-line2", "+LINE2", " line3"].join("\n");
    expect(applyUnifiedDiff(before, diff)).toBe("line1\nLINE2\nline3\n");
  });

  it("applies multiple hunks", () => {
    const before = "a\nb\nc\nd\ne\n";
    const diff = ["@@ -1,1 +1,1 @@", "-a", "+A", "@@ -5,1 +5,1 @@", "-e", "+E"].join("\n");
    expect(applyUnifiedDiff(before, diff)).toBe("A\nb\nc\nd\nE\n");
  });

  it("refuses malformed or overlapping diffs", () => {
    expect(() => applyUnifiedDiff("x\n", "")).toThrow(/empty diff/);
    expect(() => applyUnifiedDiff("x\n", "no hunks here")).toThrow(/no @@ hunk/);
    expect(() =>
      applyUnifiedDiff("a\nb\n", ["@@ -2,1 +2,1 @@", "-b", "+B", "@@ -1,1 +1,1 @@", "-a", "+A"].join("\n"))
    ).toThrow(/overlapping/i);
  });
});

describe("phase 2 — command queue", () => {
  it("delivers pending commands and resolves on completion", async () => {
    const cmd = enqueueIdeCommand("openFile", { path: "/tmp/x.ts" });
    expect(pendingIdeCommandCount()).toBe(1);
    const polled = pollIdeCommands();
    expect(polled).toHaveLength(1);
    expect(polled[0].id).toBe(cmd.id);
    expect(isIdeConnected()).toBe(true);

    const waiting = waitForIdeCommand(cmd.id, 5000);
    completeIdeCommand(cmd.id, { ok: true, result: { opened: true } });
    await expect(waiting).resolves.toEqual({ ok: true, result: { opened: true } });
    expect(pollIdeCommands()).toHaveLength(0);
  });

  it("returns an error when the editor never answers", async () => {
    const cmd = enqueueIdeCommand("diagnostics", { path: "/tmp/x.ts" });
    await expect(waitForIdeCommand(cmd.id, 500)).resolves.toMatchObject({ ok: false });
  });

  it("ignores unknown result ids", () => {
    expect(completeIdeCommand("missing", { ok: true })).toBe(false);
  });
});

describe("phase 2 — IDE safety gates", () => {
  it("refuses to queue a repo edit at all (immutability)", async () => {
    const repoFile = path.join(process.cwd(), "src", "index.ts");
    const res = await ideApplyDiff(repoFile, "@@ -1,1 +1,1 @@\n-a\n+b", { timeoutMs: 500 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Sam-Harness repository/i);
  });

  it("requires approval for edits inside prompt sources", async () => {
    const project = path.join(tmp, "client");
    fs.mkdirSync(project, { recursive: true });
    const file = path.join(project, "app.ts");
    fs.writeFileSync(file, "export const a = 1;\n");
    registerSourceRoots([project]);

    const res = await ideApplyDiff(file, "@@ -1,1 +1,1 @@\n-export const a = 1;\n+export const a = 2;", {
      timeoutMs: 500,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/approval|SAM_IDE_ALLOW_WRITE/i);
  });

  it("queues an approved edit when auto-approve + allow-write are on", async () => {
    process.env.SAM_IDE_AUTO_APPROVE = "1";
    process.env.SAM_IDE_ALLOW_WRITE = "1";
    const project = path.join(tmp, "client");
    fs.mkdirSync(project, { recursive: true });
    const file = path.join(project, "app.ts");
    fs.writeFileSync(file, "export const a = 1;\n");
    registerSourceRoots([project]);

    const res = await ideApplyDiff(file, "@@ -1,1 +1,1 @@\n-export const a = 1;\n+export const a = 2;", {
      timeoutMs: 600,
    });
    // No editor connected in tests: the command was queued, then timed out.
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no IDE connected|did not answer/i);
  });

  it("validates paths before queueing", async () => {
    const res = await ideOpenFile(path.join(process.cwd(), ".env"), { timeoutMs: 500 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/blocked/i);
  });
});
