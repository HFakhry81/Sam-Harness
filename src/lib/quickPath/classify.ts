/**
 * Intent classifier for the lightweight reply path.
 * Heuristics first; optional tiny local model when ambiguous.
 */
import type { IntentClass, IntentClassification, ReplyPath } from "./types.js";

const GREETING_RE =
  /^(?:hi+|hello|hey|yo|howdy|good\s*(?:morning|afternoon|evening)|greetings|سلام|أهلا|اهلا|أهلاً|اهلاً|مرحبا|مرحباً|مرحبه|هاي|هلا|السلام\s*عليكم|صباح\s*(?:الخير|النور)|مساء\s*(?:الخير|النور)|كيفك|كيف حالك|شو الأخبار|ما الأخبار)[\s!?.،؟]*$/iu;

const SMALLTALK_RE =
  /^(?:thanks|thank\s*you|ty|thx|شكرا|شكراً|يسلمو|تمام|ok+|okay|cool|nice|bye|goodbye|مع السلامة|باي|تصبح على خير)[\s!?.،؟]*$/iu;

const WEB_RE =
  /(?:search\s+(?:the\s+)?web|google|look\s+up\s+online|web\s+search|browse|current\s+(?:news|events|price)|latest\s+news|give\s+me\s+details\s+about|what(?:'s| is)\s+happening|news\s+about|ابحث\s+(?:لي\s+)?(?:على|في)\s*(?:النت|الإنترنت|الانترنت|الويب)|بحث\s+ويب|تفاصيل\s+عن|أخبار|اخر\s+ال?أخبار|آخر\s+ال?أخبار|ما\s+آخر|ما\s+اخر)/iu;

const TASK_RE =
  /(?:implement|refactor|patch|apply|code|file|folder|desktop|screenshot|excel|xlsx|csv|delete|move|copy|open\s+|write\s+|create\s+(?:a\s+)?(?:file|folder)|mkdir|architecture|blueprint|gap\s*matrix|review\s+loop|pipeline|workflow|analyze\s+(?:the\s+)?(?:repo|system)|نف[ّ']?ذ|عد[ّ']?ل|احذف|انقل|انسخ|افتح|اعمل\s*ملف|أنشئ|انشئ|سو[ّ']?ي|لقطة|سكرين|سطح\s*المكتب|تحليل\s*(?:نظام|معمار)|فجوات|حزمة\s*تقارير|موعد|maw3ed)/iu;

const QUESTION_RE =
  /^(?:what|who|when|where|why|how|which|is|are|can|does|do|هل|ما|ماذا|من|متى|أين|اين|لماذا|كيف|وش|ايش|كم)\b|[?؟]\s*$/iu;

function pathForIntent(intent: IntentClass): ReplyPath {
  if (intent === "web_research") return "web";
  if (intent === "task") return "agency";
  return "quick";
}

function result(
  intent: IntentClass,
  confidence: number,
  reason: string,
  source: IntentClassification["source"]
): IntentClassification {
  return {
    intent,
    replyPath: pathForIntent(intent),
    confidence,
    reason,
    source,
  };
}

/**
 * Pure heuristic classifier (no I/O). Exported for unit tests.
 */
export function classifyIntentHeuristic(prompt: string): IntentClassification {
  const raw = String(prompt || "").trim();
  if (!raw) {
    return result("smalltalk", 0.9, "empty prompt → smalltalk", "heuristic");
  }

  const compact = raw.replace(/\s+/g, " ").trim();
  const lower = compact.toLowerCase();

  // Forced agency cues always win
  if (
    /(?:run\s+as\s+(?:full\s+)?agency|force\s+agency|وكالة\s*كاملة|شغ[ّ']?ل\s*الوكالة)/iu.test(
      compact
    )
  ) {
    return result("task", 0.99, "explicit force-agency cue", "heuristic");
  }

  if (GREETING_RE.test(compact) || SMALLTALK_RE.test(compact)) {
    return result("smalltalk", 0.95, "greeting/smalltalk pattern", "heuristic");
  }

  // Short Arabic/English greetings with trailing fluff
  if (
    compact.length <= 40 &&
    /(?:^(?:hi|hello|hey|اهلا|أهلا|مرحبا|مرحباً|سلام)\b)/iu.test(compact) &&
    !TASK_RE.test(compact) &&
    !WEB_RE.test(compact)
  ) {
    return result("smalltalk", 0.9, "short greeting", "heuristic");
  }

  if (WEB_RE.test(compact) && !TASK_RE.test(compact)) {
    return result("web_research", 0.88, "web/research cue", "heuristic");
  }

  // "give me details about X" / "tell me about X" without file/desktop cues
  if (
    /(?:tell\s+me\s+about|details\s+about|what\s+is\s+[A-Z]|من\s+هو|ما\s+هو|عرفني\s+عن|أعطني\s+تفاصيل|اعطني\s+تفاصيل)/iu.test(
      compact
    ) &&
    !TASK_RE.test(compact)
  ) {
    // Prefer web for current/public topics; simple for definitional if very short
    if (
      /(?:today|latest|current|202[0-9]|الآن|الان|اليوم|حاليا)/iu.test(compact) ||
      compact.length > 60
    ) {
      return result("web_research", 0.75, "details/current-info cue", "heuristic");
    }
  }

  if (TASK_RE.test(compact)) {
    return result("task", 0.92, "task/ops/code cue", "heuristic");
  }

  // Simple questions / lookups (no tools)
  if (
    (QUESTION_RE.test(compact) || compact.length <= 120) &&
    !TASK_RE.test(compact) &&
    !WEB_RE.test(compact)
  ) {
    // Very short non-greeting statements → simple
    if (QUESTION_RE.test(compact) || /^(?:explain|define|معنى|معنى كلمة|اشرح)\b/iu.test(lower)) {
      return result("simple_question", 0.8, "simple question/lookup", "heuristic");
    }
    if (compact.length <= 80 && !/[\\/]|\.\w{2,4}\b/.test(compact)) {
      return result("simple_question", 0.65, "short prompt without task cues", "heuristic");
    }
  }

  // Ambiguous → low confidence task (safer to escalate) unless very chatty
  if (compact.length <= 50 && !TASK_RE.test(compact)) {
    return result("simple_question", 0.55, "ambiguous short prompt", "heuristic");
  }

  return result("task", 0.6, "default to agency task", "heuristic");
}

const AMBIGUOUS_BELOW = 0.72;

export type ClassifyOptions = {
  /** Force agency path (UI checkbox / API). */
  forceAgency?: boolean;
  /**
   * Optional model classifier when heuristic confidence is low.
   * Must return one of the IntentClass strings (or null to keep heuristic).
   */
  modelClassify?: (prompt: string) => Promise<IntentClass | null>;
};

/**
 * Classify intent: heuristics first, then optional tiny model if ambiguous.
 */
export async function classifyIntent(
  prompt: string,
  opts: ClassifyOptions = {}
): Promise<IntentClassification> {
  if (opts.forceAgency) {
    return result("task", 1, "forced agency by caller", "forced");
  }

  const heuristic = classifyIntentHeuristic(prompt);
  if (heuristic.confidence >= AMBIGUOUS_BELOW || !opts.modelClassify) {
    return heuristic;
  }

  try {
    const modelIntent = await opts.modelClassify(prompt);
    if (
      modelIntent === "smalltalk" ||
      modelIntent === "simple_question" ||
      modelIntent === "web_research" ||
      modelIntent === "task"
    ) {
      return result(
        modelIntent,
        Math.max(heuristic.confidence, 0.78),
        `model override of heuristic (${heuristic.intent})`,
        "model"
      );
    }
  } catch {
    /* keep heuristic */
  }
  return heuristic;
}

export { AMBIGUOUS_BELOW };
