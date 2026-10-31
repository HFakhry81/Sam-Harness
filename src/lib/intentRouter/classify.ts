/**
 * Intent router — deterministic rules first, optional tiny local model, safe clarify fallback.
 * Must run before any agency / ops pipeline.
 */
import type { IntentClass, IntentDecision, IntentRoute } from "./types.js";
import { detectUserLanguage } from "../quickPath/language.js";

/** Confidence below this triggers optional model triage (when provided). */
export const AMBIGUOUS_BELOW = 0.72;

/** Below this after model/heuristic — ask a clarifying question instead of launching. */
export const CLARIFY_BELOW = 0.55;

const GREETING_ONLY_RE =
  /^(?:hi+|hello|hey+|yo|howdy|greetings|good\s*(?:morning|afternoon|evening)|سلام|أهلاً?|اهلاً?|مرحباً?|مرحبه|هاي|هلا+|السلام\s*عليكم|وعليكم\s*السلام|صباح\s*(?:الخير|النور)|مساء\s*(?:الخير|النور)|كيفك|كيف حالك|شو\s*الأخبار|ما\s*الأخبار)[\s!?.،؟!~]*$/iu;

const SMALLTALK_ONLY_RE =
  /^(?:thanks|thank\s*you|ty|thx|شكراً?|يسلمو|تمام|ok+|okay|cool|nice|bye|goodbye|مع\s*السلامة|باي|تصبح\s*على\s*خير)[\s!?.،؟!~]*$/iu;

/** Greeting + self-intro / name fluff — still chat (the owner greeting from the bug report). */
const GREETING_INTRO_RE =
  /^(?:hi+|hello|hey+|أهلاً?|اهلاً?|مرحباً?|مرحبه|هلا+|سلام)(?:[\s,.،!]+(?:(?:my\s+name\s+is|i(?:'m| am)|اسمي|انا|أنا)\s+[\p{L}\p{N}.'_-]{1,40})|(?:[\s,.،]+[\p{L}\p{N}.'_-]{1,24}){1,6})[\s!?.،؟!~]*$/iu;

const WEB_RE =
  /(?:search\s+(?:the\s+)?web|google|look\s+up\s+online|web\s+search|browse|current\s+(?:news|events|price)|latest\s+news|give\s+me\s+details\s+about|what(?:'s| is)\s+happening|news\s+about|ابحث\s+(?:لي\s+)?(?:على|في)\s*(?:النت|الإنترنت|الانترنت|الويب)|بحث\s+ويب|تفاصيل\s+عن|أخبار|اخر\s+ال?أخبار|آخر\s+ال?أخبار|ما\s+آخر|ما\s+اخر)/iu;

const PATH_RE =
  /(?:[A-Za-z]:[\\/][^\s]+|\\\\[^\s]+|\/(?:home|Users|var|opt|tmp|mnt|media)\/[^\s]+|E:\\|C:\\|D:\\|~\.?\/[^\s]+)/i;

const COMPLEX_VERBS_RE =
  /(?:\b(?:examine|audit|review|evaluate|analyze|analyse|inspect|assess|architect|refactor|implement|build|design|blueprint|compare)\b|افحص|حلل|حلّل|راجع|قي[ّ']?م|تقييم|فحص|ابني|ابنِ|صلح|صلّح|عد[ّ']?ل|نف[ّ']?ذ|معمار|فجوات|حزمة\s*تقارير|gap\s*matrix|traceability|architecture)/iu;

const SIMPLE_TASK_RE =
  /(?:\b(?:move|copy|delete|rename|open|play|screenshot|type|click|launch|mkdir|create\s+(?:a\s+)?(?:file|folder)|write\s+(?:a\s+)?(?:file|excel)|make\s+(?:a\s+)?(?:file|folder))\b|انقل|انسخ|احذف|افتح|شغل|لقطة|اعمل\s*ملف|أنشئ|انشئ|سو[ّ']?ي|سكرين|سطح\s*المكتب|اكتب\s*(?:ملف|اكسل)|excel|xlsx|csv)/iu;

const FORCE_AGENCY_RE =
  /(?:--force-agency|run\s+as\s+(?:full\s+)?agency|force\s+agency|وكالة\s*كاملة|شغ[ّ']?ل\s*الوكالة)/iu;

const QUESTION_RE =
  /^(?:what|who|when|where|why|how|which|is|are|can|does|do|هل|ما|ماذا|من|متى|أين|اين|لماذا|كيف|وش|ايش|كم)\b|[?؟]\s*$/iu;

function decision(
  route: IntentRoute,
  intent: IntentClass,
  confidence: number,
  reason: string,
  source: IntentDecision["source"],
  clarifyQuestion?: string
): IntentDecision {
  return {
    route,
    intent,
    confidence,
    reason,
    source,
    ...(clarifyQuestion ? { clarifyQuestion } : {}),
  };
}

function clarifyQuestionFor(prompt: string): string {
  const lang = detectUserLanguage(prompt);
  if (lang === "ar" || lang === "mixed") {
    return "هل تريد رداً سريعاً في المحادثة، أم تشغيل مهمة؟";
  }
  return "Quick chat reply, or run this as a task?";
}

/**
 * Pure heuristic classifier (no I/O). Exported for unit tests.
 */
export function classifyIntentHeuristic(prompt: string): IntentDecision {
  const raw = String(prompt || "").trim();
  if (!raw) {
    return decision("chat", "smalltalk", 0.9, "empty prompt → chat", "heuristic");
  }

  const compact = raw.replace(/\s+/g, " ").trim();

  if (FORCE_AGENCY_RE.test(compact)) {
    return decision(
      "complex",
      "complex_task",
      0.99,
      "explicit force-agency cue",
      "heuristic"
    );
  }

  if (GREETING_ONLY_RE.test(compact) || SMALLTALK_ONLY_RE.test(compact)) {
    return decision(
      "chat",
      "smalltalk",
      0.97,
      "greeting/smalltalk pattern",
      "heuristic"
    );
  }

  // "مرحبا اسمي مز هيثم" / "Hello my name is Maz" — chat, never agency
  if (GREETING_INTRO_RE.test(compact) && !COMPLEX_VERBS_RE.test(compact) && !PATH_RE.test(compact)) {
    return decision(
      "chat",
      "smalltalk",
      0.95,
      "greeting with self-intro",
      "heuristic"
    );
  }

  // Short greeting prefix without task/path cues (avoid JS \\b on Arabic)
  if (
    compact.length <= 64 &&
    /^(?:hi|hello|hey|اهلا|أهلا|مرحبا|مرحباً|مرحبه|هلا|سلام)(?:\s|$|[!?.،,])/iu.test(
      compact
    ) &&
    !COMPLEX_VERBS_RE.test(compact) &&
    !SIMPLE_TASK_RE.test(compact) &&
    !WEB_RE.test(compact) &&
    !PATH_RE.test(compact)
  ) {
    return decision("chat", "smalltalk", 0.92, "short greeting prefix", "heuristic");
  }

  const hasPath = PATH_RE.test(compact);
  const hasComplex = COMPLEX_VERBS_RE.test(compact);
  const hasSimple = SIMPLE_TASK_RE.test(compact);
  const hasWeb = WEB_RE.test(compact);

  // Path + examine/build/fix/audit → complex agency
  if (hasPath && (hasComplex || hasSimple)) {
    return decision(
      "complex",
      "complex_task",
      0.94,
      "path + action/audit verb → complex",
      "heuristic"
    );
  }

  if (hasPath && /(?:code|repo|project|مستودع|مشروع|كود)/iu.test(compact)) {
    return decision(
      "complex",
      "complex_task",
      0.88,
      "path + code/project cue → complex",
      "heuristic"
    );
  }

  if (hasWeb && !hasComplex && !hasPath) {
    return decision("research", "web_research", 0.9, "web/research cue", "heuristic");
  }

  if (
    /(?:tell\s+me\s+about|details\s+about|what\s+is\s+[A-Z]|من\s+هو|ما\s+هو|عرفني\s+عن|أعطني\s+تفاصيل|اعطني\s+تفاصيل)/iu.test(
      compact
    ) &&
    !hasComplex &&
    !hasSimple &&
    !hasPath
  ) {
    if (
      /(?:today|latest|current|202[0-9]|الآن|الان|اليوم|حاليا)/iu.test(compact) ||
      compact.length > 60
    ) {
      return decision(
        "research",
        "web_research",
        0.78,
        "details/current-info cue",
        "heuristic"
      );
    }
  }

  // Complex analysis / architecture without needing a path
  if (
    hasComplex &&
    /(?:architecture|blueprint|gap\s*matrix|report\s*pack|حزمة|فجوات|معمار|مستودع|repo|system)/iu.test(
      compact
    )
  ) {
    return decision(
      "complex",
      "complex_task",
      0.9,
      "architecture/analysis cue → complex",
      "heuristic"
    );
  }

  if (hasSimple && !hasComplex && !hasPath) {
    return decision(
      "task",
      "simple_task",
      0.9,
      "simple single-action cue",
      "heuristic"
    );
  }

  if (hasComplex) {
    return decision(
      "complex",
      "complex_task",
      0.82,
      "complex verb without simple-only cue",
      "heuristic"
    );
  }

  // Simple questions / lookups → chat (no tools)
  if (
    (QUESTION_RE.test(compact) || compact.length <= 120) &&
    !hasSimple &&
    !hasWeb &&
    !hasPath
  ) {
    if (
      QUESTION_RE.test(compact) ||
      /^(?:explain|define|معنى|معنى كلمة|اشرح)\b/iu.test(compact.toLowerCase())
    ) {
      return decision(
        "chat",
        "simple_question",
        0.84,
        "simple question/lookup",
        "heuristic"
      );
    }
    if (compact.length <= 80 && !/\.\w{2,4}\b/.test(compact)) {
      return decision(
        "chat",
        "simple_question",
        0.68,
        "short prompt without task cues",
        "heuristic"
      );
    }
  }

  // Ambiguous short — prefer clarify over launching agency
  if (compact.length <= 50 && !hasSimple && !hasComplex && !hasPath) {
    return decision(
      "clarify",
      "clarify",
      0.5,
      "ambiguous short prompt",
      "heuristic",
      clarifyQuestionFor(compact)
    );
  }

  // Default: complex is safer than silent ops, but mark low confidence → clarify if very unsure
  if (compact.length <= 100 && !hasPath) {
    return decision(
      "clarify",
      "clarify",
      0.48,
      "unsure chat vs task",
      "heuristic",
      clarifyQuestionFor(compact)
    );
  }

  return decision(
    "complex",
    "complex_task",
    0.6,
    "default to complex agency task",
    "heuristic"
  );
}

export type ClassifyOptions = {
  /** Force full agency / architecture pipeline. */
  forceAgency?: boolean;
  /**
   * Optional cheap local model (<=3B) triage when heuristic confidence is low.
   * Must return an IntentRoute (or null to keep heuristic).
   */
  modelClassify?: (prompt: string) => Promise<IntentRoute | null>;
};

/**
 * Classify intent: heuristics first, then optional tiny model, then clarify when unsure.
 */
export async function classifyIntent(
  prompt: string,
  opts: ClassifyOptions = {}
): Promise<IntentDecision> {
  if (opts.forceAgency) {
    return decision(
      "complex",
      "complex_task",
      1,
      "forced agency by caller",
      "forced"
    );
  }

  let result = classifyIntentHeuristic(prompt);

  if (result.confidence >= AMBIGUOUS_BELOW || !opts.modelClassify) {
    // Still ask when heuristic already chose clarify
    if (result.route === "clarify" && !result.clarifyQuestion) {
      result = {
        ...result,
        clarifyQuestion: clarifyQuestionFor(prompt),
      };
    }
    return result;
  }

  try {
    const modelRoute = await opts.modelClassify(prompt);
    if (
      modelRoute === "chat" ||
      modelRoute === "research" ||
      modelRoute === "task" ||
      modelRoute === "complex"
    ) {
      const intent: IntentClass =
        modelRoute === "chat"
          ? result.intent === "smalltalk"
            ? "smalltalk"
            : "simple_question"
          : modelRoute === "research"
            ? "web_research"
            : modelRoute === "task"
              ? "simple_task"
              : "complex_task";
      return decision(
        modelRoute,
        intent,
        Math.max(result.confidence, 0.78),
        `model override of heuristic (${result.route})`,
        "model"
      );
    }
    if (modelRoute === "clarify") {
      return decision(
        "clarify",
        "clarify",
        0.6,
        "model requested clarify",
        "model",
        clarifyQuestionFor(prompt)
      );
    }
  } catch {
    /* keep heuristic */
  }

  // Unsure between chat and task/complex → clarify instead of launching
  if (
    result.confidence < CLARIFY_BELOW ||
    (result.route === "complex" && result.confidence < AMBIGUOUS_BELOW) ||
    result.route === "clarify"
  ) {
    return decision(
      "clarify",
      "clarify",
      Math.min(result.confidence, 0.52),
      `clarify fallback (${result.reason})`,
      result.source,
      clarifyQuestionFor(prompt)
    );
  }

  return result;
}

/** English-only ASCII label for console logs. */
export function routeLabelEn(route: IntentRoute): string {
  switch (route) {
    case "chat":
      return "chat";
    case "research":
      return "research";
    case "task":
      return "task";
    case "complex":
      return "complex";
    case "clarify":
      return "clarify";
    default:
      return "complex";
  }
}

/** UI badge label (locale-aware). */
export function routeLabel(route: IntentRoute, locale: "ar" | "en" = "en"): string {
  if (locale === "ar") {
    switch (route) {
      case "chat":
        return "محادثة";
      case "research":
        return "بحث";
      case "task":
        return "مهمة";
      case "complex":
        return "معقد";
      case "clarify":
        return "توضيح";
      default:
        return "معقد";
    }
  }
  return routeLabelEn(route);
}
