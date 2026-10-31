/**
 * Pack-home guards: packs always resolve under SAM_OUTPUT_HOME/reports,
 * never under a target project docs/ tree (including Maw3ed).
 */
import * as path from "path";
import { buildTaskSpec } from "../src/controlplane/taskSpec.js";
import {
  assertPackDirOutsideRepo,
  defaultProjectDocsRoot,
  resolveNextSamHarnessReviewDir,
  resolveTargetRepoPath,
} from "../src/lib/reviewPackDir.js";
import { getOutputHome } from "../src/lib/outputHome.js";
import {
  extractUserGoal,
  isSamHarnessSelfGoal,
} from "../src/agency/goalFidelity.js";

type Case = {
  name: string;
  prompt: string;
  uiTarget: string;
  expectSelf: boolean;
};

const cases: Case[] = [
  {
    name: "typo-han-nafsak",
    prompt: "تقرير حن نفسك فيه اسمك وحدود امكانيات",
    uiTarget: "E:\\UpNexa.com\\maw3ed",
    expectSelf: true,
  },
  {
    name: "real-maw3ed-analysis",
    prompt: "حلّل Maw3ed واكتب حزمة تقارير عن الحجز",
    uiTarget: "E:\\UpNexa.com\\maw3ed",
    expectSelf: false,
  },
];

console.log("eval-pack-home");
let pass = 0;
const fails: string[] = [];
const outHome = path.normalize(getOutputHome()).toLowerCase();

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
  const docsLower = path.normalize(docs).toLowerCase();
  const okSelf = self === c.expectSelf;
  const okOut = docsLower.startsWith(outHome);
  const okNotMaw3ed = !docsLower.includes("maw3ed");
  const okNotRepoDocs = !/[\\/]docs$/i.test(docs) || docsLower.startsWith(outHome);
  let okAssert = true;
  try {
    const { dir } = resolveNextSamHarnessReviewDir(docs);
    assertPackDirOutsideRepo(dir, process.cwd());
  } catch (e: any) {
    okAssert = false;
    fails.push(`  assert ${c.name}: ${e?.message || e}`);
  }
  const goal = extractUserGoal(`## Goal\n${c.prompt}\n`);
  if (okSelf && okOut && okNotMaw3ed && okNotRepoDocs && okAssert) {
    pass += 1;
    console.log(`  OK ${c.name} self=${self} docs=${docs}`);
  } else {
    const msg = `  FAIL ${c.name} self=${self} (want ${c.expectSelf}) target=${spec.targetRepo} docs=${docs} goal=${goal.slice(0, 60)} out=${okOut} maw3edClear=${okNotMaw3ed}`;
    fails.push(msg);
    console.log(msg);
  }
}

const acc = pass / cases.length;
console.log(`\naccuracy ${pass}/${cases.length} = ${(acc * 100).toFixed(1)}%`);
if (fails.length) console.error("FAILED:\n" + fails.join("\n"));
if (acc < 1) process.exitCode = 1;
else console.log("PASS");
