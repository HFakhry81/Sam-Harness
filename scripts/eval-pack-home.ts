/**
 * Pack-home guards: self goals must not resolve under Maw3ed.
 */
import * as path from "path";
import { buildTaskSpec } from "../src/controlplane/taskSpec.js";
import {
  defaultProjectDocsRoot,
  isSamHarnessWorkspace,
  resolveTargetRepoPath,
} from "../src/lib/reviewPackDir.js";
import {
  extractUserGoal,
  isSamHarnessSelfGoal,
} from "../src/agency/goalFidelity.js";

function docsIncludesHarnessAware(docs: string, needle: string): boolean {
  if (docs.toLowerCase().includes(needle.toLowerCase())) return true;
  if (
    /sam-?harness/i.test(needle) &&
    isSamHarnessWorkspace() &&
    path.resolve(docs).startsWith(path.resolve(process.cwd()))
  ) {
    return true;
  }
  return false;
}

type Case = {
  name: string;
  prompt: string;
  uiTarget: string;
  expectSelf: boolean;
  expectDocsIncludes: string;
  expectDocsExcludes?: string;
};

const cases: Case[] = [
  {
    name: "typo-han-nafsak",
    prompt: "تقرير حن نفسك فيه اسمك وحدود امكانيات",
    uiTarget: "E:\\UpNexa.com\\maw3ed",
    expectSelf: true,
    expectDocsIncludes: "Sam-Harness",
    expectDocsExcludes: "maw3ed",
  },
  {
    name: "real-maw3ed-analysis",
    prompt: "حلّل Maw3ed واكتب حزمة تقارير عن الحجز",
    uiTarget: "E:\\UpNexa.com\\maw3ed",
    expectSelf: false,
    expectDocsIncludes: "maw3ed",
  },
];

console.log("eval-pack-home");
let pass = 0;
const fails: string[] = [];

for (const c of cases) {
  const self = isSamHarnessSelfGoal(c.prompt);
  const spec = buildTaskSpec({
    prompt: c.prompt,
    route: "architecture",
    targetRepo: c.uiTarget,
    packDir: path.join(c.uiTarget, "docs"),
  });
  const abs = resolveTargetRepoPath(spec.targetRepo);
  const docs = defaultProjectDocsRoot(abs);
  const okSelf = self === c.expectSelf;
  const okIn = docsIncludesHarnessAware(docs, c.expectDocsIncludes);
  const okEx =
    !c.expectDocsExcludes ||
    !docs.toLowerCase().includes(c.expectDocsExcludes.toLowerCase());
  const goal = extractUserGoal(`## Goal\n${c.prompt}\n`);
  if (okSelf && okIn && okEx) {
    pass += 1;
    console.log(`  ✓ ${c.name} self=${self} docs=${docs}`);
  } else {
    const msg = `  ✗ ${c.name} self=${self} (want ${c.expectSelf}) target=${spec.targetRepo} docs=${docs} goal=${goal.slice(0, 60)}`;
    fails.push(msg);
    console.log(msg);
  }
}

const acc = pass / cases.length;
console.log(`\naccuracy ${pass}/${cases.length} = ${(acc * 100).toFixed(1)}%`);
if (fails.length) console.error("FAILED:\n" + fails.join("\n"));
if (acc < 1) process.exitCode = 1;
else console.log("PASS");
