/**
 * Goal-fidelity gate — strategy must answer the user goal (NIST Measure / DoD).
 * Deterministic keyword overlap + anti-drift heuristics.
 */

export type GoalFidelityResult = {
  score: number;
  passed: boolean;
  reason: string;
  goalTokens: string[];
  hitTokens: string[];
  driftSignals: string[];
};

const STOP = new Set(
  [
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "into",
    "only",
    "بدون",
    "فقط",
    "داخل",
    "مجلد",
    "مشروع",
    "حالة",
    "تقرير",
    "اكتب",
    "راجع",
    "عن",
    "في",
    "من",
    "على",
    "إلى",
    "الى",
    "مع",
    "أو",
    "او",
    "التي",
    "الذي",
    "هذا",
    "هذه",
    "كان",
    "كما",
    "بعد",
    "قبل",
    "حتى",
    "عند",
    "أي",
    "اى",
    "كل",
    "غير",
    "تم",
    "يجب",
    "يكون",
    "عاوز",
    "اعمل",
    "أريد",
    "اريد",
    "sam",
    "harness",
    "docs",
    "md",
    "json",
  ].map((s) => s.toLowerCase())
);

/** Weak verbs/generics — not enough alone to prove fidelity. */
const WEAK = new Set(
  ["صفحة", "ويب", "شركة", "اسمها", "بتعمل", "وعاوز", "الصفحة", "شكل"].map((s) =>
    s.toLowerCase()
  )
);

/** Booking-product drift when the goal was about Control Plane ops/memory/UI. */
const BOOKING_DRIFT =
  /\bBookingType\b|APPOINTMENT|RESOURCE_RENTAL|BATCH_SCHEDULE|QR.?code|check-?in|invoice|clinic|موعد|حجز/i;

const MEMORY_OPS_GOAL =
  /project-memory|daily\s*ops|artifact|عارض|ذاكرة|ledger|control\s*plane|صف(?:حة|ه)\s*الانتهاء|memor/i;

/** True only for real booking blueprints — ignore "no BookingType" constraint lines. */
function strategyHasBookingBlueprint(strategy: string): boolean {
  const cleaned = strategy
    .replace(/no mention of[`\s*_]*BookingType[\s\S]{0,50}/gi, " ")
    .replace(/لا تكتب عن\s*`?BookingType`?[\s\S]{0,80}/gi, " ")
    .replace(
      /do not (?:pivot|invent|mention|write|include).{0,80}BookingType[\s\S]{0,40}/gi,
      " "
    )
    .replace(/unless the goal asks[\s\S]{0,80}/gi, " ");
  if (/##\s*BookingType|APPOINTMENT|RESOURCE_RENTAL|BATCH_SCHEDULE/i.test(cleaned)) {
    return true;
  }
  return (
    /\bBookingType\b/i.test(cleaned) &&
    /clinic|موعد|\bحجز\b|invoice|APPOINTMENT/i.test(cleaned)
  );
}

export function extractUserGoal(briefOrTask: string): string {
  const m =
    briefOrTask.match(/## Goal\s*\n([\s\S]*?)(?=\n## |\n# |$)/i) ||
    briefOrTask.match(/(?:^|\n)GOAL:\s*\n([\s\S]*?)(?=\n## |\n[A-Z][A-Z ]+:\s*\n|$)/i);
  if (m?.[1]) return m[1].trim();
  // First non-empty paragraph up to 800 chars
  return briefOrTask.replace(/\r/g, "").trim().slice(0, 800);
}

/** Expand Arabic clitics (ال/و/ب/…) so والمحتوي ≈ محتوي. */
function arVariants(token: string): string[] {
  const out = new Set<string>([token]);
  let x = token;
  for (let i = 0; i < 3; i++) {
    const n = x.replace(/^(وال|بال|كال|لل|ال|و|ب|ك|ل|ف)/, "");
    if (!n || n === x || n.length < 3) break;
    out.add(n);
    x = n;
  }
  return [...out];
}

function tokenize(text: string): string[] {
  const raw = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\-_./]+/gu, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t));
  return [...new Set(raw)].slice(0, 40);
}

function tokenHitsStrategy(token: string, strategyLower: string): boolean {
  for (const v of arVariants(token)) {
    if (v.length >= 3 && strategyLower.includes(v)) return true;
  }
  return false;
}

export function scoreGoalFidelity(
  goal: string,
  strategy: string,
  threshold = 0.45
): GoalFidelityResult {
  const g = (goal || "").trim();
  const s = (strategy || "").trim();
  if (!g) {
    return {
      score: 0,
      passed: false,
      reason: "Empty user goal",
      goalTokens: [],
      hitTokens: [],
      driftSignals: [],
    };
  }
  if (!s) {
    return {
      score: 0,
      passed: false,
      reason: "Empty strategy",
      goalTokens: tokenize(g),
      hitTokens: [],
      driftSignals: [],
    };
  }

  const strategyLower = s.toLowerCase();
  const goalTokens = tokenize(g);
  const hitTokens = goalTokens.filter((t) => tokenHitsStrategy(t, strategyLower));
  let score = goalTokens.length
    ? hitTokens.length / Math.min(goalTokens.length, 12)
    : 0;

  // Distinctive-token score (ignore weak generics) — fixes Arabic false rejects
  const distinctive = goalTokens.filter((t) => t.length >= 4 && !WEAK.has(t));
  const distHits = distinctive.filter((t) => tokenHitsStrategy(t, strategyLower));
  if (distinctive.length >= 2) {
    score = Math.max(score, distHits.length / distinctive.length);
  }
  // Enough absolute distinctive hits → on-topic even if long goal dilutes ratio
  if (distHits.length >= 3 && !BOOKING_DRIFT.test(g)) {
    score = Math.max(score, 0.55);
  }

  const driftSignals: string[] = [];
  if (
    MEMORY_OPS_GOAL.test(g) &&
    strategyHasBookingBlueprint(s) &&
    !BOOKING_DRIFT.test(g)
  ) {
    driftSignals.push("booking-product-drift");
    score = Math.min(score, 0.25);
  }

  // Strong require: at least one distinctive multi-word cue if present in goal
  const cues = [
    [/project-?memory|ذاكرة/i, /project-?memory|memory|ذاكر/i],
    [/daily\s*ops|ledger/i, /daily\s*ops|dailyops|ledger|دفتر/i],
    [/عارض|artifact|مخرجات/i, /artifact|عارض|مخرج|viewer|report|تقارير/i],
    [/control\s*plane/i, /control\s*plane|controlplane/i],
  ] as const;
  let cueNeeds = 0;
  let cueHits = 0;
  for (const [need, hit] of cues) {
    if (!need.test(g)) continue;
    cueNeeds += 1;
    if (hit.test(s)) cueHits += 1;
    else driftSignals.push(`missing-cue:${need.source}`);
  }
  // Domain cues satisfied → treat as on-topic even if Arabic token overlap is low
  if (
    cueNeeds >= 2 &&
    cueHits === cueNeeds &&
    !driftSignals.includes("booking-product-drift")
  ) {
    score = Math.max(score, 0.72);
  } else if (
    cueNeeds >= 3 &&
    cueHits >= 2 &&
    !driftSignals.includes("booking-product-drift")
  ) {
    // Majority of CP cues is enough (e.g. strategy names systems without saying "Control Plane")
    score = Math.max(score, 0.55);
  } else if (cueNeeds >= 2 && cueHits === 0) {
    score = Math.min(score, 0.35);
  }

  // Self-intro goals: brand + capabilities/limits in strategy counts as on-topic
  if (
    isSamHarnessSelfGoal(g) &&
    /sam-?harness/i.test(s) &&
    /إمكان|حدود|capabilities|limits?|وكال|agency|أدوات|tools/i.test(s)
  ) {
    score = Math.max(score, 0.55);
  }

  score = Math.max(0, Math.min(1, score));
  const passed = score >= threshold && !driftSignals.includes("booking-product-drift");

  const reason = passed
    ? `Goal fidelity OK (score=${score.toFixed(2)}, hits=${hitTokens.length}/${goalTokens.length})`
    : `Goal fidelity FAIL (score=${score.toFixed(2)}${
        driftSignals.length ? `; drift=${driftSignals.join(",")}` : ""
      }; hits=${hitTokens.slice(0, 8).join("|") || "none"})`;

  return { score, passed, reason, goalTokens, hitTokens, driftSignals };
}

/** Prefer Maw3ed/booking template only when the goal is clearly that product. */
export function goalWantsBookingBlueprint(goal: string): boolean {
  return /maw3ed|موعد|booking|clinic|حجز|appointment|resource.?rental|batch.?schedule|qr/i.test(
    goal
  );
}

/**
 * Goals about Sam-Harness itself (self-intro / Control Plane health) —
 * packs must stay in this workspace, never a client repo.
 */
export function isSamHarnessSelfGoal(goal: string): boolean {
  const g = goal || "";
  if (/maw3ed|موعد|fanni|فني/i.test(g) && !/(?:عن|حن)\s*نفسك|who\s*are\s*you/i.test(g)) {
    return false;
  }
  return (
    /(?:عن|حن)\s*نفسك|اسمك\s*(?:و|&)?\s*حدود|امكانياتك|إمكانياتك|تقدر تعمل|من\s*أنت|who\s*are\s*you|personal\s*agency|تقرير[\s\S]{0,48}نفسك/i.test(
      g
    ) ||
    (/control\s*plane|project-memory|daily\s*ops|run\s*lessons|عارض\s*التقارير/i.test(g) &&
      /sam-?harness/i.test(g))
  );
}
