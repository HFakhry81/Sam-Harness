/**
 * Goal-aware Evidence Scout — Control Plane paths must appear for memory/UI goals.
 */
import * as path from "path";
import { scanRepoEvidence } from "../src/agency/evidence.js";

const root = path.resolve(".");
const cpGoal =
  "راجع project-memory و Daily Ops وعارض التقارير على صفحة الانتهاء في Control Plane";
const bookingGoal = "حلّل BookingType triad و QR check-in في منتج الحجز";

console.log("eval-evidence-scout");
const cp = scanRepoEvidence(root, { goal: cpGoal });
const book = scanRepoEvidence(root, { goal: bookingGoal });

const need = [
  "src/controlplane/projectMemory.ts",
  "src/controlplane/dailyOps.ts",
  "src/controlplane/artifacts.ts",
];
const cpPaths = new Set(cp.hits.map((h) => h.path.replace(/\\/g, "/")));
let pass = 0;
let total = 0;
for (const p of need) {
  total += 1;
  if (cpPaths.has(p)) {
    pass += 1;
    console.log(`  ✓ control-plane goal includes ${p}`);
  } else {
    console.log(`  ✗ missing ${p} in CP evidence (hits=${cp.hits.length})`);
  }
}
total += 1;
if (cp.hits.length >= need.length) {
  pass += 1;
  console.log(`  ✓ CP hit count ${cp.hits.length}`);
} else {
  console.log(`  ✗ CP hit count too low ${cp.hits.length}`);
}
total += 1;
const bookHasForced = need.every((p) =>
  book.hits.some((h) => h.path.replace(/\\/g, "/") === p && /goal-aware/i.test(h.note))
);
if (!bookHasForced) {
  pass += 1;
  console.log(`  ✓ booking goal does not force-inject all CP paths as goal-aware`);
} else {
  console.log(`  ✗ booking goal unexpectedly force-injected CP paths`);
}

const acc = pass / total;
console.log(`\naccuracy ${pass}/${total} = ${(acc * 100).toFixed(1)}%`);
if (acc < 1) process.exitCode = 1;
else console.log("PASS");
