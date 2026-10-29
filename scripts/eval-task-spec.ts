/**
 * Golden evals for Task Spec Engine (compose quality before execute).
 * Exit 1 if accuracy below threshold.
 */
import {
  buildTaskSpec,
  needsClarify,
  planToolsFromSpec,
} from "../src/controlplane/taskSpec.js";

type Case = {
  name: string;
  prompt: string;
  expectRoute: string;
  expectIntent: string;
  expectReady?: boolean;
  expectTool?: string;
  /** When set, every listed tool must appear in planToolsFromSpec order */
  expectPlanTools?: string[];
  expectWorkspaceMode?: "operator" | "code";
  /** Substring that must appear in write_file plan content */
  expectWriteContent?: string;
  /** Expect a contains success criterion with this text */
  expectContains?: string;
  expectDestIncludes?: string;
  expectDestExcludes?: string;
  expectStepsCovered?: string[];
  /** Substring required in resolved targetRepo (pack home) */
  expectTargetIncludes?: string;
  /** Substring forbidden in targetRepo */
  expectTargetExcludes?: string;
  /** Forced UI targetRepo input (simulate Maw3ed prefill) */
  inputTargetRepo?: string;
  inputPackDir?: string;
  answers?: Record<string, string>;
};

const cases: Case[] = [
  {
    name: "move-ar-desktop-to-d",
    prompt: "انقل الملف Sam-Harness team test.xls من سطح المكتب الي المحرك D:",
    expectRoute: "operational",
    expectIntent: "move",
    expectReady: true,
    expectTool: "move_file",
  },
  {
    name: "excel-create-ar",
    prompt:
      "عاوز اعمل ملف Excel علي سطح المكتب بأسم Sam-Harness team test. واكتب فيه الوقت والتاريخ الحاليين في الخليه A1",
    expectRoute: "operational",
    expectIntent: "create_excel",
    expectReady: true,
    expectTool: "write_excel",
  },
  {
    name: "mkdir-ar",
    prompt: "اعمل مجلد باسم Reports على سطح المكتب",
    expectRoute: "operational",
    expectIntent: "mkdir",
    expectReady: true,
    expectTool: "mkdir",
  },
  {
    name: "delete-needs-confirm",
    prompt: "احذف الملف old.txt من سطح المكتب",
    expectRoute: "operational",
    expectIntent: "delete",
    expectReady: false,
  },
  {
    name: "delete-with-confirm-answer",
    prompt: "احذف الملف old.txt من سطح المكتب",
    answers: {
      "تأكيد الحذف النهائي؟ اكتب نعم للحذف (destructive — لا سلة محذوفات مضمونة)": "نعم",
    },
    expectRoute: "operational",
    expectIntent: "delete",
    expectReady: true,
    expectTool: "delete_path",
  },
  {
    name: "move-ambiguous-clarify",
    prompt: "انقل الملف report.xls",
    expectRoute: "operational",
    expectIntent: "move",
    expectReady: false,
  },
  {
    name: "architecture-maw3ed",
    prompt: "حلّل مشروع Maw3ed وأخرج حزمة تقارير Sam-Harness no.X بدون تعديل كود",
    expectRoute: "architecture",
    expectIntent: "analyze",
    expectReady: true,
    expectTargetIncludes: "maw3ed",
  },
  {
    name: "self-report-overrides-maw3ed-ui",
    prompt:
      "عاوزك تكتب لي تقرير حن نفسك فيه اسمك وحدود امكانيات وتقدر تعمل ايه وتعرضة عليا",
    expectRoute: "architecture",
    expectIntent: "analyze",
    expectReady: true,
    inputTargetRepo: "E:\\UpNexa.com\\maw3ed",
    inputPackDir: "E:\\UpNexa.com\\maw3ed\\docs",
    expectTargetIncludes: "Sam-Harness",
    expectTargetExcludes: "maw3ed",
  },
  {
    name: "control-plane-status-stays-on-harness",
    prompt:
      "راجع حالة أنظمة Control Plane في Sam-Harness: project-memory و Daily Ops ledger وعارض التقارير. اكتب تقرير داخل docs فقط.",
    expectRoute: "architecture",
    expectIntent: "analyze",
    expectReady: true,
    inputTargetRepo: "E:\\UpNexa.com\\maw3ed",
    expectTargetIncludes: "Sam-Harness",
    expectTargetExcludes: "maw3ed",
  },
  {
    name: "screenshot-ar",
    prompt: 'التقط لقطة شاشة باسم "capture-test.png"',
    expectRoute: "operational",
    expectIntent: "screenshot",
    expectReady: true,
    expectTool: "screenshot",
  },
  {
    name: "compound-delete-mkdir-downloads",
    prompt:
      "امسح الملف دة My Sheet.xls من سطح المكتب\nاعمل مجلد جديد علي فى المسار C:\\Users\\Sam\\Downloads احط فيه صورى",
    answers: {
      "طلبك فيه خطوتان (حذف ملف + إنشاء مجلد). اكتب نعم للتنفيذ بالترتيب": "نعم",
      "تأكيد الحذف النهائي؟ اكتب نعم للحذف (destructive — لا سلة محذوفات مضمونة)": "نعم",
    },
    expectRoute: "operational",
    expectIntent: "delete",
    expectReady: true,
    expectTool: "delete_path",
    expectPlanTools: ["delete_path", "mkdir"],
  },
  {
    name: "compound-delete-folder-write-d",
    prompt:
      'امسح مجلد "صوري" من Downloads\nواعمل ملف ورد في المكان D: واكتب فيه " اهلا اسمي :  ...." واكتب اسمك مكان النقط',
    answers: {
      "طلبك فيه خطوتان (حذف + كتابة ملف). اكتب نعم للتنفيذ بالترتيب": "نعم",
      "تأكيد الحذف النهائي؟ اكتب نعم للحذف (destructive — لا سلة محذوفات مضمونة)": "نعم",
      "ما الاسم المراد كتابته مكان النقط؟": "سام",
    },
    expectRoute: "operational",
    expectIntent: "delete",
    expectReady: true,
    expectTool: "delete_path",
    expectPlanTools: ["delete_path", "write_file"],
  },
  {
    name: "operator-workspace-mode",
    prompt: "اعمل مجلد باسم Reports على سطح المكتب",
    expectRoute: "operational",
    expectIntent: "mkdir",
    expectReady: true,
    expectTool: "mkdir",
    expectWorkspaceMode: "operator",
  },
  {
    name: "negation-not-delete-write-file",
    prompt:
      "أنشئ ملف نصي على سطح المكتب باسم ops-smoke-20261029.txt يحتوي سطراً واحداً فقط: Sam-Harness ops smoke OK. لا تحذف أي ملفات أخرى ولا تعدّل أي شيء خارج سطح المكتب.",
    expectRoute: "operational",
    expectIntent: "write_file",
    expectReady: true,
    expectTool: "write_file",
    expectWriteContent: "Sam-Harness ops smoke OK",
    expectContains: "Sam-Harness ops smoke OK",
  },
  {
    name: "write-file-explicit-content",
    prompt:
      "اكتب ملف نصي جديد على سطح المكتب اسمه note-p0.txt. المحتوى سطر واحد فقط: Hello P0 fidelity.",
    expectRoute: "operational",
    expectIntent: "write_file",
    expectReady: true,
    expectTool: "write_file",
    expectWriteContent: "Hello P0 fidelity",
    expectContains: "Hello P0 fidelity",
  },
  {
    name: "mkdir-clean-desktop-phrase",
    prompt: "اعمل مجلد باسم ladder-l2 على سطح المكتب",
    expectRoute: "operational",
    expectIntent: "mkdir",
    expectReady: true,
    expectTool: "mkdir",
    expectDestIncludes: "Desktop\\ladder-l2",
    expectDestExcludes: "على سطح",
  },
  {
    name: "compound-mkdir-write-file",
    prompt:
      "على سطح المكتب: أنشئ مجلد باسم ladder-l2 ثم اكتب داخله ملف readme.txt المحتوى سطر واحد فقط: L2 PASS compound-ok",
    expectRoute: "operational",
    expectIntent: "mkdir",
    expectReady: true,
    expectTool: "mkdir",
    expectPlanTools: ["mkdir", "write_file"],
    expectWriteContent: "L2 PASS compound-ok",
    expectContains: "L2 PASS compound-ok",
    expectStepsCovered: ["mkdir", "write_file"],
  },
  {
    name: "write-absolute-path",
    prompt:
      "اكتب ملف نصي في المسار C:\\Users\\Sam\\Desktop\\ladder-l2\\readme.txt المحتوى سطر واحد فقط: ABS PATH OK",
    expectRoute: "operational",
    expectIntent: "write_file",
    expectReady: true,
    expectTool: "write_file",
    expectDestIncludes: "ladder-l2\\readme.txt",
    expectWriteContent: "ABS PATH OK",
    expectContains: "ABS PATH OK",
  },
];

console.log("eval-task-spec");
let pass = 0;
const fails: string[] = [];

for (const c of cases) {
  const spec = buildTaskSpec({
    prompt: c.prompt,
    answers: c.answers,
    route: "auto",
    targetRepo: c.inputTargetRepo,
    packDir: c.inputPackDir,
  });
  const ready = !needsClarify(spec);
  const plan = planToolsFromSpec(spec);
  const tools = plan
    .filter((p): p is { action: "tool"; tool: string } => p.action === "tool" && "tool" in p)
    .map((p) => p.tool);
  const tool = tools[0];
  const okRoute = spec.route === c.expectRoute;
  const okIntent = spec.intent === c.expectIntent;
  const okReady = c.expectReady === undefined || ready === c.expectReady;
  const okTool = !c.expectTool || tool === c.expectTool;
  const okPlan =
    !c.expectPlanTools ||
    (c.expectPlanTools.length === tools.length &&
      c.expectPlanTools.every((t, i) => tools[i] === t));
  const okMode =
    !c.expectWorkspaceMode || spec.workspaceMode === c.expectWorkspaceMode;
  const writeStep = plan.find(
    (p) => p.action === "tool" && "tool" in p && p.tool === "write_file"
  ) as { action: "tool"; tool: string; params?: Record<string, unknown> } | undefined;
  const writeContent = String(writeStep?.params?.content || "");
  const okWrite =
    !c.expectWriteContent || writeContent.includes(c.expectWriteContent);
  const containsCrit = spec.successCriteria.find((x) => x.type === "contains");
  const okContains =
    !c.expectContains ||
    (containsCrit?.type === "contains" && containsCrit.text.includes(c.expectContains));
  const destJoined = (spec.entities.destinations || []).join("|");
  const okDestIn = !c.expectDestIncludes || destJoined.includes(c.expectDestIncludes);
  const okDestEx = !c.expectDestExcludes || !destJoined.includes(c.expectDestExcludes);
  const stepsCrit = spec.successCriteria.find((x) => x.type === "steps_covered");
  const okSteps =
    !c.expectStepsCovered ||
    (stepsCrit?.type === "steps_covered" &&
      c.expectStepsCovered.every((t) => stepsCrit.tools.includes(t)));
  const okTargetIn =
    !c.expectTargetIncludes ||
    spec.targetRepo.toLowerCase().includes(c.expectTargetIncludes.toLowerCase());
  const okTargetEx =
    !c.expectTargetExcludes ||
    !spec.targetRepo.toLowerCase().includes(c.expectTargetExcludes.toLowerCase());
  if (
    okRoute &&
    okIntent &&
    okReady &&
    okTool &&
    okPlan &&
    okMode &&
    okWrite &&
    okContains &&
    okDestIn &&
    okDestEx &&
    okSteps &&
    okTargetIn &&
    okTargetEx
  ) {
    pass += 1;
    console.log(
      `  ✓ ${c.name} (conf=${spec.confidence.toFixed(2)} mode=${spec.workspaceMode} tools=${tools.join("→")} target=${spec.targetRepo} dest=${destJoined})`
    );
  } else {
    const msg = `  ✗ ${c.name} got route=${spec.route} intent=${spec.intent} mode=${spec.workspaceMode} ready=${ready} target=${spec.targetRepo} pack=${spec.packDir} tools=${JSON.stringify(tools)} dest=${JSON.stringify(destJoined)} content=${JSON.stringify(writeContent.slice(0, 80))} contains=${JSON.stringify(containsCrit)} steps=${JSON.stringify(stepsCrit)} conf=${spec.confidence.toFixed(2)} clarify=${JSON.stringify(spec.needsClarification)} planSteps=${JSON.stringify(spec.planSteps)}`;
    fails.push(msg);
    console.log(msg);
  }
}

const acc = pass / cases.length;
console.log(`\naccuracy ${pass}/${cases.length} = ${(acc * 100).toFixed(1)}%`);
if (fails.length) {
  console.error("FAILED cases:\n" + fails.join("\n"));
}
if (acc < 0.95) {
  process.exitCode = 1;
  console.error("Below 95% threshold");
} else {
  console.log("PASS");
}
