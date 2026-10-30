/**
 * Canonical Help topic catalog. Filenames are `<id>.md` under docs/help/{ar|en}/.
 * Arabic is primary; English is a mirror with identical topic ids.
 */

export type HelpTopicId =
  | "index"
  | "workflow"
  | "agents-models"
  | "selection-wiring"
  | "hybrid-mode"
  | "specialty-capabilities"
  | "desktop-control"
  | "customize"
  | "quick-path"
  | "install"
  | "security"
  | "cost"
  | "troubleshooting"
  | "faq"
  | "glossary";

export type HelpTopicMeta = {
  id: HelpTopicId;
  /** Sort order in indexes / exports (index always first). */
  order: number;
  /** CLI aliases and search boosts (lowercase). */
  aliases: string[];
  titleAr: string;
  titleEn: string;
  summaryAr: string;
  summaryEn: string;
  keywords: string[];
};

/** Every topic that must exist in both languages. */
export const HELP_TOPICS: HelpTopicMeta[] = [
  {
    id: "index",
    order: 0,
    aliases: ["home", "toc", "contents", "فهرس", "مساعدة"],
    titleAr: "فهرس المساعدة",
    titleEn: "Help index",
    summaryAr: "خريطة مواضيع مساعدة Sam-Harness — مبنية على الكود الحالي فقط.",
    summaryEn: "Sam-Harness help map — grounded strictly in current code.",
    keywords: ["help", "index", "toc", "مساعدة", "فهرس"],
  },
  {
    id: "workflow",
    order: 10,
    aliases: ["roles", "graph", "agency", "review", "swarm", "level3", "أدوار", "سير", "مخطط"],
    titleAr: "خطة سير العمل والأدوار",
    titleEn: "Workflow plan & roles",
    summaryAr: "الأدوار، مسار الوكالة، حلقة المراجعة، السرب، وتنفيذ Level-3 مع مخططات Mermaid.",
    summaryEn: "Roles, agency path, review loop, swarm, and Level-3 implement with Mermaid diagrams.",
    keywords: [
      "workflow",
      "roles",
      "langgraph",
      "review",
      "swarm",
      "level3",
      "implementer",
      "أدوار",
      "مراجعة",
      "سرب",
    ],
  },
  {
    id: "agents-models",
    order: 20,
    aliases: ["models", "llm", "ceo_model", "نماذج", "وكلاء"],
    titleAr: "الوكلاء والنماذج لكل دور",
    titleEn: "Agents & models per role",
    summaryAr: "أسماء النماذج الفعلية من الكود، الافتراضيات، ومتغيرات البيئة.",
    summaryEn: "Exact model names from code, defaults, and environment variables.",
    keywords: ["model", "ollama", "gemma", "qwen", "CEO_MODEL", "نموذج", "سحابة"],
  },
  {
    id: "selection-wiring",
    order: 30,
    aliases: ["wiring", "providers", "mcp", "tools", "api-keys", "توصيل", "مزودين"],
    titleAr: "الاختيار والتوصيل حسب نظام التشغيل",
    titleEn: "OS selection & wiring",
    summaryAr: "كيف تُختار النماذج وتُوصل المزودات والمفاتيح وMCP وسجل الأدوات.",
    summaryEn: "How models are selected and wired: providers, keys, base URLs, MCP, tools registry.",
    keywords: ["provider", "api", "baseurl", "mcp", "registry", "windows", "linux", "macos"],
  },
  {
    id: "hybrid-mode",
    order: 40,
    aliases: ["hybrid", "routing", "local", "cloud", "auto", "cap", "هجين", "توجيه"],
    titleAr: "محلي مقابل سحابة مقابل هجين",
    titleEn: "Local vs cloud vs hybrid",
    summaryAr: "التوجيه حسب الصعوبة، سقف ٠٫٥٠ دولار، سلوك قرب السقف، الملفات الشخصية والبيئة.",
    summaryEn: "Difficulty routing, $0.50 cap, near-cap behaviour, profiles, and env.",
    keywords: ["hybrid", "HYBRID_MODE", "cost", "cap", "0.50", "difficulty", "سقف", "تكلفة"],
  },
  {
    id: "specialty-capabilities",
    order: 50,
    aliases: ["specialty", "matrix", "can-it", "قدرات", "تخصص"],
    titleAr: "التخصص وحدود القدرات",
    titleEn: "Specialty & capability limits",
    summaryAr: "ماذا تفعل الوكالة فعلاً: مصفوفة نعم / جزئي / لا (صفحات ويب، تطبيقات، …).",
    summaryEn: "What the agency actually does: yes / partial / no matrix (web pages, apps, …).",
    keywords: ["capability", "web", "app", "excel", "email", "sandbox", "قدرة", "تطبيق"],
  },
  {
    id: "desktop-control",
    order: 60,
    aliases: ["desktop", "uia", "operator", "ubuntu", "windows", "سطح", "مشغّل"],
    titleAr: "التحكم بالجهاز وأدوات سطح المكتب",
    titleEn: "Machine control & desktop tools",
    summaryAr: "UIA/PowerShell، الصدفة، صندوق الملفات، البريد، المجدول — وما يعمل على كل نظام.",
    summaryEn: "UIA/PowerShell, shell, FS sandbox, email, scheduler — and what works per OS.",
    keywords: ["desktop", "uia", "powershell", "screenshot", "smtp", "daily-ops", "ubuntu", "macos"],
  },
  {
    id: "quick-path",
    order: 75,
    aliases: [
      "quick",
      "quickreply",
      "web-search",
      "smalltalk",
      "سريع",
      "رد سريع",
      "بحث ويب",
    ],
    titleAr: "مسار الرد السريع والويب",
    titleEn: "Quick reply & web path",
    summaryAr:
      "تصنيف النية قبل الوكالة: تحية/سؤال بسيط → نموذج محلي، بحث ويب → ملخص مع مصادر، المهام → الوكالة.",
    summaryEn:
      "Intent before agency: greeting/simple → local model, web research → summary with sources, tasks → agency.",
    keywords: [
      "quick",
      "web",
      "search",
      "greeting",
      "smalltalk",
      "duckduckgo",
      "سريع",
      "ويب",
      "تحية",
    ],
  },
  {
    id: "customize",
    order: 70,
    aliases: ["config", "extend", "team", "تخصيص", "تعديل", "فريق"],
    titleAr: "تخصيص سير العمل والفريق",
    titleEn: "Customize workflow & team",
    summaryAr: "كيف تعدّل الأدوار والفريق: ملفات الإعداد، البيئة، ونقاط التوسعة في الكود.",
    summaryEn: "How to change roles and team: config files, env, and code extension points.",
    keywords: ["customize", "roles.ts", "capabilities", "go-nogo", "mcp.json", "تخصيص"],
  },
  {
    id: "install",
    order: 80,
    aliases: ["setup", "installer", "تثبيت"],
    titleAr: "التثبيت",
    titleEn: "Install",
    summaryAr: "تثبيت بنقرة (Windows / macOS / Linux) والتثبيت اليدوي وdoctor.",
    summaryEn: "One-click install (Windows / macOS / Linux), manual setup, and doctor.",
    keywords: ["install", "pnpm", "node", "doctor", "SamHarness.bat", "تثبيت"],
  },
  {
    id: "security",
    order: 90,
    aliases: ["trust", "approvals", "audit", "أمن", "موافقات", "تدقيق"],
    titleAr: "الأمان والموافقات والتدقيق",
    titleEn: "Security, approvals & audit",
    summaryAr: "بوابات القبول، HITL، سجل التدقيق المتسلسل، وحزم الأدلة.",
    summaryEn: "Acceptance gates, HITL, hash-chained audit log, and evidence packs.",
    keywords: ["trust", "APPROVE_", "audit", "gates", "evidence", "موافقة"],
  },
  {
    id: "cost",
    order: 100,
    aliases: ["budget", "ledger", "تكلفة", "ميزانية"],
    titleAr: "التكلفة والميزانية",
    titleEn: "Cost & budget",
    summaryAr: "السقف اليومي، المحاسبة، التخزين المؤقت، وتدهور قرب السقف.",
    summaryEn: "Daily cap, accounting, cache, and near-cap degradation.",
    keywords: ["cost", "ledger", "cache", "SAM_COST", "تكلفة"],
  },
  {
    id: "troubleshooting",
    order: 110,
    aliases: ["doctor", "debug", "fix", "إصلاح", "مشاكل"],
    titleAr: "استكشاف الأخطاء (doctor)",
    titleEn: "Troubleshooting (doctor)",
    summaryAr: "pnpm run doctor والفحوصات الشائعة عند فشل التشغيل.",
    summaryEn: "pnpm run doctor and common failure checks.",
    keywords: ["doctor", "troubleshoot", "ollama", "token", "healthz", "فشل"],
  },
  {
    id: "faq",
    order: 120,
    aliases: ["questions", "أسئلة"],
    titleAr: "أسئلة شائعة",
    titleEn: "FAQ",
    summaryAr: "إجابات مختصرة لأكثر الأسئلة تكراراً من المالك والمشغّلين.",
    summaryEn: "Short answers to the most common owner and operator questions.",
    keywords: ["faq", "question", "سؤال", "هل"],
  },
  {
    id: "glossary",
    order: 130,
    aliases: ["terms", "قاموس", "مصطلحات"],
    titleAr: "قاموس المصطلحات",
    titleEn: "Glossary",
    summaryAr: "تعريفات Level-1/2/3، Go/No-Go، Hybrid، MCP، وغيرها كما في الكود.",
    summaryEn: "Definitions of Level-1/2/3, Go/No-Go, Hybrid, MCP, and other code terms.",
    keywords: ["glossary", "definition", "term", "مصطلح"],
  },
];

export const HELP_TOPIC_IDS: HelpTopicId[] = HELP_TOPICS.map((t) => t.id);

export function topicMeta(id: string): HelpTopicMeta | undefined {
  return HELP_TOPICS.find((t) => t.id === id);
}

export function resolveTopicId(raw: string): HelpTopicId | undefined {
  const q = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\.md$/i, "");
  if (!q) return undefined;
  const exact = HELP_TOPICS.find((t) => t.id === q);
  if (exact) return exact.id;
  const alias = HELP_TOPICS.find(
    (t) =>
      t.aliases.some((a) => a.toLowerCase() === q) ||
      t.titleEn.toLowerCase() === q ||
      t.titleAr === raw.trim()
  );
  return alias?.id;
}
