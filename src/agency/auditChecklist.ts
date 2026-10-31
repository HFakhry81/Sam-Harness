/**
 * Mandatory grounded-audit checklist:
 * (a) spec stack vs actual stack
 * (b) dependency gaps for imported/required services
 * (c) auth flow wiring
 * (d) UI handlers without onPress + mock-data screens
 * (e) currency/locale
 * Each item yields a cited finding into evidence.json.
 */
import * as fs from "fs";
import * as path from "path";
import type { RepoIndexResult } from "./repoIndex.js";
import type { SpecIngestResult } from "./specIngest.js";
import type { LocaleCurrencyProfile } from "./localeCurrency.js";

export type ChecklistFinding = {
  id: string;
  category:
    | "stack_conflict"
    | "dependency"
    | "auth"
    | "ui_handler"
    | "mock_data"
    | "currency_locale";
  severity: "P0" | "P1" | "P2";
  summary: string;
  paths: string[];
  detail: string;
};

export type AuditChecklistResult = {
  findings: ChecklistFinding[];
  stackConflict: boolean;
  specStack: string[];
  repoStack: string[];
  markdown: string;
  json: object;
};

const SPEC_STACK_TERMS: { term: string; family: string }[] = [
  { term: "flutter", family: "flutter" },
  { term: "dart", family: "flutter" },
  { term: "fastapi", family: "fastapi" },
  { term: "django", family: "django" },
  { term: "expo", family: "expo" },
  { term: "react native", family: "react-native" },
  { term: "react-native", family: "react-native" },
  { term: "supabase", family: "supabase" },
  { term: "next.js", family: "next" },
  { term: "nestjs", family: "nestjs" },
];

function readJsonSafe(p: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function walkFiles(root: string, max = 80): string[] {
  const out: string[] = [];
  const skip = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);
  const stack = [root];
  while (stack.length && out.length < max) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (skip.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (/\.(m?[jt]sx?|tsx?|jsx?)$/i.test(e.name)) out.push(full);
      if (out.length >= max) break;
    }
  }
  return out;
}

function detectRepoStack(root: string, index: RepoIndexResult): string[] {
  const families = new Set<string>();
  const pkg = readJsonSafe(path.join(root, "package.json"));
  const deps = {
    ...((pkg?.dependencies as Record<string, string>) || {}),
    ...((pkg?.devDependencies as Record<string, string>) || {}),
  };
  const names = Object.keys(deps).map((d) => d.toLowerCase());
  if (names.some((d) => d.includes("expo"))) families.add("expo");
  if (names.some((d) => d.includes("react-native"))) families.add("react-native");
  if (names.some((d) => d.includes("supabase"))) families.add("supabase");
  if (names.some((d) => d === "next" || d.startsWith("next/"))) families.add("next");
  if (fs.existsSync(path.join(root, "pubspec.yaml"))) families.add("flutter");
  if (fs.existsSync(path.join(root, "requirements.txt"))) {
    try {
      const req = fs.readFileSync(path.join(root, "requirements.txt"), "utf-8").toLowerCase();
      if (/fastapi/.test(req)) families.add("fastapi");
      if (/django/.test(req)) families.add("django");
    } catch {
      /* ignore */
    }
  }
  for (const h of index.hits) {
    if (/expo/i.test(h.note) || /expo/i.test(h.path)) families.add("expo");
    if (/supabase/i.test(h.note)) families.add("supabase");
  }
  return [...families].sort();
}

function detectSpecStack(spec: SpecIngestResult | null | undefined): string[] {
  if (!spec) return [];
  const blob = [
    ...spec.requirements.map((r) => r.text),
    ...spec.rawChunks.map((c) => c.text),
    ...spec.filesRead.map((f) => String(f)),
  ]
    .join("\n")
    .toLowerCase();
  const families = new Set<string>();
  for (const { term, family } of SPEC_STACK_TERMS) {
    if (blob.includes(term)) families.add(family);
  }
  return [...families].sort();
}

/** Detect Pressable/Button/Touchable* without onPress/onClick handler. */
export function scanMissingHandlers(root: string): ChecklistFinding[] {
  const findings: ChecklistFinding[] = [];
  const files = walkFiles(root, 60);
  const tagRe =
    /<(Pressable|TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback|Button)\b([^>]*)>/gi;
  for (const full of files) {
    let text = "";
    try {
      text = fs.readFileSync(full, "utf-8");
    } catch {
      continue;
    }
    const rel = path.relative(root, full).replace(/\\/g, "/");
    let m: RegExpExecArray | null;
    const re = new RegExp(tagRe.source, "gi");
    while ((m = re.exec(text))) {
      const attrs = m[2] || "";
      if (!/\bonPress\s*=/.test(attrs) && !/\bonClick\s*=/.test(attrs)) {
        // allow self-closing with spread props that might include handlers
        if (/\{\.\.\./.test(attrs)) continue;
        findings.push({
          id: `UI-HANDLER-${findings.length + 1}`,
          category: "ui_handler",
          severity: "P0",
          summary: `<${m[1]}> without onPress/onClick in ${rel}`,
          paths: [rel],
          detail: `Opening tag lacks onPress/onClick: <${m[1]}${attrs.slice(0, 80)}>`,
        });
      }
    }
    // Also catch logout buttons as object literals: { title: 'Logout' } without onPress nearby
    if (/logout/i.test(text) && !/logout[\s\S]{0,120}onPress/i.test(text)) {
      if (/logout/i.test(text) && /button|pressable|touchable/i.test(text)) {
        findings.push({
          id: `UI-HANDLER-LOGOUT-${findings.length + 1}`,
          category: "ui_handler",
          severity: "P0",
          summary: `Logout control appears without nearby onPress in ${rel}`,
          paths: [rel],
          detail: "Logout mention found without onPress within 120 chars",
        });
      }
    }
  }
  return findings;
}

export function scanMockDataScreens(index: RepoIndexResult): ChecklistFinding[] {
  if (!index.usesMockData) return [];
  const paths = index.hits
    .filter((h) => /mock/i.test(h.path) || /mock/i.test(h.note))
    .map((h) => h.path)
    .slice(0, 8);
  return [
    {
      id: "MOCK-001",
      category: "mock_data",
      severity: "P0",
      summary: "Screens/data layer use mock data instead of a live backend",
      paths: paths.length ? paths : ["(mock usage detected)"],
      detail: "Repo index flagged mock-data usage; wire real API/Supabase before claiming live data entry",
    },
  ];
}

export function runAuditChecklist(input: {
  targetRepo: string;
  index: RepoIndexResult;
  spec?: SpecIngestResult | null;
  localeCurrency?: LocaleCurrencyProfile | null;
  /** Extra raw spec text (all files concatenated) for stack term detection. */
  specTextBlob?: string;
}): AuditChecklistResult {
  const findings: ChecklistFinding[] = [];
  const repoStack = detectRepoStack(input.targetRepo, input.index);
  let specStack = detectSpecStack(input.spec);
  if (input.specTextBlob) {
    const lower = input.specTextBlob.toLowerCase();
    for (const { term, family } of SPEC_STACK_TERMS) {
      if (lower.includes(term) && !specStack.includes(family)) {
        specStack = [...specStack, family].sort();
      }
    }
  }

  // (a) stack conflict — only when both sides declare stacks and they diverge
  const stackConflict =
    specStack.length > 0 &&
    repoStack.length > 0 &&
    !specStack.some((s) => repoStack.includes(s)) &&
    // flutter/fastapi vs expo/rn is a hard conflict
    ((specStack.includes("flutter") || specStack.includes("fastapi")) &&
      (repoStack.includes("expo") || repoStack.includes("react-native")));

  if (
    specStack.length &&
    repoStack.length &&
    (stackConflict ||
      (specStack.includes("flutter") &&
        (repoStack.includes("expo") || repoStack.includes("react-native"))) ||
      (specStack.includes("fastapi") &&
        (repoStack.includes("expo") || repoStack.includes("react-native"))))
  ) {
    findings.push({
      id: "STACK-001",
      category: "stack_conflict",
      severity: "P0",
      summary: `Spec stack (${specStack.join(", ")}) conflicts with repo stack (${repoStack.join(", ")})`,
      paths: [
        "package.json",
        ...(input.spec?.filesRead || []).slice(0, 4).map((f) => String(f)),
      ],
      detail:
        "Specs describe a different application stack than package.json / source. Align specs or migrate the codebase before claiming parity.",
    });
  }

  // (b) dependency gaps — group by specifier
  const bySpec = new Map<string, string[]>();
  for (const m of input.index.missingImports) {
    const list = bySpec.get(m.specifier) || [];
    list.push(m.file);
    bySpec.set(m.specifier, list);
  }
  for (const [specifier, files] of bySpec) {
    findings.push({
      id: `DEP-${specifier.replace(/[^\w]+/g, "_").slice(0, 40)}`,
      category: "dependency",
      severity: "P0",
      summary: `Imported '${specifier}' is not listed in package.json dependencies`,
      paths: files.slice(0, 4),
      detail: "Install the dependency or remove the import before claiming the integration works.",
    });
  }

  // (c) auth flow wiring
  const authHits = input.index.hits.filter((h) => /auth|login|otp|oauth|google|apple/i.test(h.note + h.path));
  const wantsAuth =
    /auth|otp|google|apple|sign[\s-]?in|login/i.test(
      (input.spec?.requirements.map((r) => r.text).join(" ") || "") +
        (input.specTextBlob || "")
    ) || true; // always check lightly for grounded audit
  if (wantsAuth) {
    const bodies = walkFiles(input.targetRepo, 40);
    let hasOtp = false;
    let hasGoogle = false;
    let hasApple = false;
    let hasAuthProvider = false;
    for (const f of bodies) {
      let t = "";
      try {
        t = fs.readFileSync(f, "utf-8");
      } catch {
        continue;
      }
      if (/otp|one[\s-]?time|sms.?code/i.test(t)) hasOtp = true;
      if (/GoogleAuth|signInWithGoogle|google.*auth/i.test(t)) hasGoogle = true;
      if (/AppleAuth|signInWithApple|apple.*auth/i.test(t)) hasApple = true;
      if (/AuthProvider|onAuthStateChange|signInWith/i.test(t)) hasAuthProvider = true;
    }
    const specWantsOtp = /otp|one[\s-]?time/i.test(
      (input.spec?.requirements.map((r) => r.text).join(" ") || "") +
        (input.specTextBlob || "")
    );
    if (specWantsOtp && !hasOtp) {
      findings.push({
        id: "AUTH-OTP",
        category: "auth",
        severity: "P0",
        summary: "Spec requires OTP sign-in but no OTP flow found in code",
        paths: authHits.map((h) => h.path).slice(0, 4),
        detail: "Add OTP verification screens/handlers or update the spec.",
      });
    }
    if (!hasAuthProvider && input.index.usesMockData) {
      findings.push({
        id: "AUTH-WIRE",
        category: "auth",
        severity: "P0",
        summary: "Auth is not wired — screens appear mock-only without AuthProvider/signInWith",
        paths: authHits.map((h) => h.path).slice(0, 4),
        detail: "Wire authentication providers (email/OTP/OAuth) to the backend.",
      });
    }
    void hasGoogle;
    void hasApple;
  }

  // (d) UI handlers + mock screens
  findings.push(...scanMissingHandlers(input.targetRepo));
  findings.push(...scanMockDataScreens(input.index));

  // (e) currency/locale
  const lc = input.localeCurrency;
  if (lc) {
    if (lc.currency && lc.currency !== "EGP" && lc.source === "code") {
      findings.push({
        id: "CUR-001",
        category: "currency_locale",
        severity: "P1",
        summary: `Code currency is ${lc.currency}; owner default expects EGP`,
        paths: [],
        detail: `Grounded currency=${lc.currency} locale=${lc.locale}`,
      });
    } else {
      findings.push({
        id: "CUR-OK",
        category: "currency_locale",
        severity: "P2",
        summary: `Grounded currency/locale: ${lc.currency} / ${lc.locale} (source=${lc.source})`,
        paths: [],
        detail: "Use this currency in reports; do not invent other ISO currency codes.",
      });
    }
  }

  const markdown = [
    `# Audit checklist`,
    ``,
    `Spec stack: ${specStack.join(", ") || "(none detected)"}`,
    `Repo stack: ${repoStack.join(", ") || "(none detected)"}`,
    `Stack conflict: ${stackConflict || findings.some((f) => f.category === "stack_conflict") ? "YES" : "no"}`,
    ``,
    ...findings.map(
      (f) =>
        `- [${f.severity}] ${f.id} (${f.category}): ${f.summary}` +
        (f.paths.length ? ` — ${f.paths.map((p) => `\`${p}\``).join(", ")}` : "")
    ),
    ``,
  ].join("\n");

  return {
    findings,
    stackConflict:
      stackConflict || findings.some((f) => f.category === "stack_conflict"),
    specStack,
    repoStack,
    markdown,
    json: { specStack, repoStack, findings },
  };
}
