#!/usr/bin/env node
/**
 * Point this clone at versioned hooks: git config core.hooksPath .githooks
 * Safe to run repeatedly. Skips (exit 0) when not inside a git work tree.
 * English-only ASCII console output.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const hooksDir = join(root, ".githooks");

function run(cmd, args) {
  return spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const probe = run("git", ["rev-parse", "--is-inside-work-tree"]);
if (probe.status !== 0 || String(probe.stdout).trim() !== "true") {
  console.log("[branch-flow] setup-hooks: skip (not a git work tree)");
  process.exit(0);
}

if (!existsSync(hooksDir)) {
  console.warn("[branch-flow] setup-hooks: .githooks missing; skip");
  process.exit(0);
}

const current = run("git", ["config", "--get", "core.hooksPath"]);
const cur = String(current.stdout || "").trim();
if (cur === ".githooks") {
  console.log("[branch-flow] setup-hooks: core.hooksPath already .githooks");
  process.exit(0);
}

const set = run("git", ["config", "core.hooksPath", ".githooks"]);
if (set.status !== 0) {
  console.warn(
    "[branch-flow] setup-hooks: could not set core.hooksPath:",
    String(set.stderr || set.stdout || "unknown error").trim(),
  );
  process.exit(0);
}

console.log("[branch-flow] setup-hooks: core.hooksPath=.githooks");
process.exit(0);
