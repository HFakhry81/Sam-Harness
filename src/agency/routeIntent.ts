/**
 * Explicit force flags + intent classification for CLI / Control Plane routing.
 * Explicit flags win; then audit/analysis intents beat task.ts operational default.
 */
export type AppRoute = "architecture" | "operational" | "quick";

export type ForceRouteFlags = {
  forceAgency: boolean;
  forceQuick: boolean;
  forceOperational: boolean;
};

export type RouteDecision = {
  route: AppRoute;
  reason: string;
  confidence: number;
  /** audit | ops | quick | unknown */
  kind: "audit" | "ops" | "quick" | "unknown";
  /** True when an explicit CLI/env/UI force flag chose the route. */
  forced: boolean;
};

const AUDIT_VERBS =
  /\b(examine|audit|review|evaluate|analyze|analyse|compare|inspect|assess|قي[ّ']?م|افحص|حلل|راجع|تقييم|فحص)\b/i;
const AGAINST_SPEC =
  /\bagainst\s+spec\b|\bspec\s+docs?\b|\brequirements?\b|مقابل\s*(?:المواصفات|مواصفات)|مواصفات|مستند/i;
const PRODUCE_REPORT =
  /\bproduce\s+reports?\b|\bwrite\s+(?:a\s+)?reports?\b|\bgenerate\s+reports?\b|تقرير|تقارير|انتج|أكتب\s*تقرير/i;
const OPS_VERBS =
  /\b(move|copy|delete|rename|open|play|screenshot|type|click|launch|انقل|انسخ|احذف|افتح|شغل|لقطة)\b/i;
const DESKTOP_TARGET =
  /\b(desktop|سطح\s*المكتب|recycle|clipboard|window|uia)\b/i;

/**
 * Parse force-route flags from argv + env.
 * --force-agency / FORCE_AGENCY=1
 * --force-quick / FORCE_QUICK=1
 * --force-operational / FORCE_OPERATIONAL=1
 */
export function parseForceRouteFlags(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): ForceRouteFlags {
  const has = (flag: string, envKey: string) =>
    argv.includes(flag) || String(env[envKey] || "").trim() === "1";
  return {
    forceAgency: has("--force-agency", "FORCE_AGENCY"),
    forceQuick: has("--force-quick", "FORCE_QUICK"),
    forceOperational: has("--force-operational", "FORCE_OPERATIONAL"),
  };
}

/** Heuristic intent for grounded audit / analysis vs desktop ops. */
export function classifyRouteIntent(task: string): Omit<RouteDecision, "forced"> {
  const text = String(task || "").trim();
  if (!text) {
    return {
      route: "architecture",
      reason: "empty task — default to read-only analysis (not execution)",
      confidence: 0.4,
      kind: "unknown",
    };
  }

  const auditScore =
    (AUDIT_VERBS.test(text) ? 2 : 0) +
    (AGAINST_SPEC.test(text) ? 3 : 0) +
    (PRODUCE_REPORT.test(text) ? 2 : 0) +
    (/grounded|gap\s*matrix|REQ-|evidence\s*pack|traceability/i.test(text) ? 2 : 0);

  const opsScore =
    (OPS_VERBS.test(text) ? 2 : 0) +
    (DESKTOP_TARGET.test(text) ? 2 : 0) +
    (/\b(write_excel|move_file|screenshot)\b/i.test(text) ? 2 : 0);

  // Strong audit signal (Spendy-class): examine + against spec + reports
  if (auditScore >= 4 || (AUDIT_VERBS.test(text) && AGAINST_SPEC.test(text))) {
    return {
      route: "architecture",
      reason: `audit/analysis intent (score=${auditScore}) — grounded-audit agency route`,
      confidence: Math.min(0.99, 0.7 + auditScore * 0.05),
      kind: "audit",
    };
  }

  if (opsScore >= 3 && opsScore > auditScore) {
    return {
      route: "operational",
      reason: `desktop/ops intent (score=${opsScore})`,
      confidence: Math.min(0.95, 0.6 + opsScore * 0.08),
      kind: "ops",
    };
  }

  if (auditScore >= 2) {
    return {
      route: "architecture",
      reason: `likely analysis (auditScore=${auditScore} >= opsScore=${opsScore})`,
      confidence: 0.65,
      kind: "audit",
    };
  }

  // Low confidence: prefer read-only analysis, never execution
  if (opsScore <= 1 && auditScore <= 1) {
    return {
      route: "architecture",
      reason: `low confidence (audit=${auditScore}, ops=${opsScore}) — prefer read-only analysis over execution`,
      confidence: 0.45,
      kind: "unknown",
    };
  }

  if (opsScore > auditScore) {
    return {
      route: "operational",
      reason: `ops edges out analysis (ops=${opsScore}, audit=${auditScore})`,
      confidence: 0.55,
      kind: "ops",
    };
  }

  return {
    route: "architecture",
    reason: `default analysis route (audit=${auditScore}, ops=${opsScore})`,
    confidence: 0.5,
    kind: "unknown",
  };
}

/**
 * Resolve final route: explicit force flags win, then intent, then optional task.ts hint.
 * task.ts operational must NOT override audit intents or --force-agency.
 */
export function resolveAppRoute(input: {
  task: string;
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  /** From task.ts when present */
  configuredRoute?: "architecture" | "operational" | "implement" | null;
}): RouteDecision {
  const flags = parseForceRouteFlags(input.argv, input.env);
  if (flags.forceAgency) {
    return {
      route: "architecture",
      reason: "explicit --force-agency / FORCE_AGENCY=1",
      confidence: 1,
      kind: "audit",
      forced: true,
    };
  }
  if (flags.forceOperational) {
    return {
      route: "operational",
      reason: "explicit --force-operational / FORCE_OPERATIONAL=1",
      confidence: 1,
      kind: "ops",
      forced: true,
    };
  }
  if (flags.forceQuick) {
    return {
      route: "quick",
      reason: "explicit --force-quick / FORCE_QUICK=1",
      confidence: 1,
      kind: "quick",
      forced: true,
    };
  }

  const intent = classifyRouteIntent(input.task);

  // Audit / low-confidence analysis always wins over task.ts operational seed
  if (intent.kind === "audit" || (intent.route === "architecture" && intent.confidence < 0.55)) {
    return { ...intent, forced: false };
  }

  const configured = input.configuredRoute;
  if (configured === "architecture" || configured === "operational") {
    // Audit already returned above; honor strong ops intent over task.ts architecture.
    if (configured === "architecture" && intent.kind === "ops" && intent.confidence >= 0.7) {
      return {
        ...intent,
        forced: false,
        reason: `${intent.reason} (overrode task.ts architecture)`,
      };
    }
    return {
      route: configured,
      reason: `task.ts route=${configured}`,
      confidence: 0.9,
      kind: configured === "operational" ? "ops" : "audit",
      forced: false,
    };
  }

  return { ...intent, forced: false };
}
