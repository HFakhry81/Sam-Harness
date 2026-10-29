/**
 * Golden evals for goal-fidelity gate (topic drift vs on-topic strategy).
 */
import { scoreGoalFidelity } from "../src/agency/goalFidelity.js";

type Case = {
  name: string;
  goal: string;
  strategy: string;
  expectPass: boolean;
};

const cases: Case[] = [
  {
    name: "memory-ops-drift-to-booking",
    goal:
      "راجع حالة project-memory وDaily Ops وعارض التقارير على صفحة الانتهاء واكتب تقرير حالة داخل docs",
    strategy: `# Strategy
## BookingType triad
APPOINTMENT / RESOURCE_RENTAL / BATCH_SCHEDULE
QR check-in → invoice lifecycle for clinic bookings.`,
    expectPass: false,
  },
  {
    name: "memory-ops-on-topic",
    goal:
      "راجع حالة project-memory وDaily Ops وعارض التقارير على صفحة الانتهاء واكتب تقرير حالة داخل docs",
    strategy: `# Status report
## project-memory
project-memory.json is empty; Control Plane /api/memory exposes entries.
## Daily Ops
dailyOps ledger is empty until runs are recorded.
## عارض التقارير
Artifact viewer on the done page opens pack files via /api/artifacts.`,
    expectPass: true,
  },
  {
    name: "booking-goal-allows-booking",
    goal: "حلّل منتج Maw3ed للحجز والـ BookingType triad مع QR و invoice",
    strategy: `BookingType triad APPOINTMENT RESOURCE_RENTAL BATCH_SCHEDULE. QR check-in to invoice for Maw3ed clinic.`,
    expectPass: true,
  },
  {
    name: "negated-bookingtype-not-drift",
    goal:
      "راجع حالة أنظمة Control Plane في Sam-Harness: project-memory و Daily Ops ledger وعارض التقارير",
    strategy: `# Strategy
## Direct answer
Status of project-memory, Daily Ops ledger, and artifact viewer on the done page.
## Constraints
No mention of BookingType or booking logic.`,
    expectPass: true,
  },
  {
    name: "arabic-self-brand-on-topic",
    goal:
      "عاوزك تكتب لي تقرير حن نفسك فيه اسمك وحدود امكانيات وتقدر تعمل ايه",
    strategy: `أهلاً. أنا Sam-Harness وكالة شخصية. إمكانياتي: أدوات سطح المكتب، LangGraph، Control Plane. حدود: لا حذف دون تأكيد.`,
    expectPass: true,
  },
];

console.log("eval-goal-fidelity");
let pass = 0;
const fails: string[] = [];
for (const c of cases) {
  const r = scoreGoalFidelity(c.goal, c.strategy);
  const ok = r.passed === c.expectPass;
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${c.name} (score=${r.score.toFixed(2)} passed=${r.passed})`);
  } else {
    const msg = `  ✗ ${c.name} expectedPass=${c.expectPass} got=${r.passed} score=${r.score.toFixed(2)} reason=${r.reason}`;
    fails.push(msg);
    console.log(msg);
  }
}
const acc = pass / cases.length;
console.log(`\naccuracy ${pass}/${cases.length} = ${(acc * 100).toFixed(1)}%`);
if (fails.length) console.error("FAILED:\n" + fails.join("\n"));
if (acc < 1) process.exitCode = 1;
else console.log("PASS");
