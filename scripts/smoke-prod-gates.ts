/**
 * Production hardening gates — run critical evals in one shot.
 * Cross-platform: invokes local tsx via node (no pnpm subprocess).
 * Usage: pnpm run smoke:prod-gates
 */
import { spawnSync } from "child_process";
import { createRequire } from "module";
import * as path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const tsxCli = require.resolve("tsx/cli");

const gates: Array<{ name: string; script: string }> = [
  { name: "eval:task-spec", script: "scripts/eval-task-spec.ts" },
  { name: "eval:goal-fidelity", script: "scripts/eval-goal-fidelity.ts" },
  { name: "eval:evidence-scout", script: "scripts/eval-evidence-scout.ts" },
  { name: "eval:pack-home", script: "scripts/eval-pack-home.ts" },
];

console.log("smoke:prod-gates — Sam-Harness production hardening\n");
let failed = 0;
for (const g of gates) {
  console.log(`── ${g.name} ──`);
  const r = spawnSync(process.execPath, [tsxCli, path.join(root, g.script)], {
    cwd: root,
    encoding: "utf-8",
    env: process.env,
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    failed += 1;
    console.error(`GATE FAIL: ${g.name} (exit ${r.status})\n`);
  } else {
    console.log(`GATE OK: ${g.name}\n`);
  }
}

if (failed) {
  console.error(`smoke:prod-gates FAILED (${failed}/${gates.length})`);
  process.exitCode = 1;
} else {
  console.log(`smoke:prod-gates PASS (${gates.length}/${gates.length})`);
  console.log(`cwd=${path.normalize(root)}`);
}
