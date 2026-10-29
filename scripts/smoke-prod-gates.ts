/**
 * Production hardening gates — run critical evals in one shot.
 * Usage: pnpm run smoke:prod-gates
 */
import { spawnSync } from "child_process";
import * as path from "path";

const root = process.cwd();
const gates = [
  "eval:task-spec",
  "eval:goal-fidelity",
  "eval:evidence-scout",
  "eval:pack-home",
];

console.log("smoke:prod-gates — Sam-Harness production hardening\n");
let failed = 0;
for (const g of gates) {
  console.log(`── ${g} ──`);
  const r = spawnSync(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    ["run", g],
    { cwd: root, encoding: "utf-8", shell: true }
  );
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    failed += 1;
    console.error(`GATE FAIL: ${g} (exit ${r.status})\n`);
  } else {
    console.log(`GATE OK: ${g}\n`);
  }
}

if (failed) {
  console.error(`smoke:prod-gates FAILED (${failed}/${gates.length})`);
  process.exitCode = 1;
} else {
  console.log(`smoke:prod-gates PASS (${gates.length}/${gates.length})`);
  console.log(`cwd=${path.normalize(root)}`);
}
