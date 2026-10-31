/**
 * Task Spec Engine — source of truth for compose → classify → write Task.
 * Spec is structured; task.md/task.ts are renderers only.
 */
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  detectOpsIntent,
  extractWriteFileContent,
  hasDeleteIntent,
  type OpsIntent,
} from "../agent/heuristic.js";
import { resolveUserPath } from "../lib/paths.js";
import { defaultProjectDocsRoot, isSamHarnessWorkspace } from "../lib/reviewPackDir.js";
import { resolveTaskReadPath } from "../lib/taskPaths.js";
import type { UiRoute } from "./taskWriter.js";

export type TaskRisk = "low" | "medium" | "high" | "destructive";

export type SuccessCriterion =
  | { type: "exists"; path: string }
  | { type: "absent"; path: string }
  | { type: "contains"; path: string; text: string }
  | { type: "pack_created"; note: string }
  | { type: "tool_ok"; tool: string }
  /** Every listed tool must appear as OK in the execution summary (compound coverage). */
  | { type: "steps_covered"; tools: string[] };

export type PlanStepSpec = {
  intent: string;
  tool: string;
  params: Record<string, unknown>;
  summary: string;
};

/**
 * Hybrid workspace model (Computer Use + Zapier steps + Cursor repo):
 * - operator: no single repo — each planStep carries its own path; roots[] = multi-root
 * - code: single primary targetRepo (+ packDir) like Cursor/Devin
 */
export type WorkspaceMode = "operator" | "code";

export type TaskSpec = {
  id: string;
  locale: "ar" | "en" | "mixed";
  route: UiRoute;
  intent: OpsIntent | "analyze" | "implement" | "unknown";
  confidence: number;
  title: string;
  goal: string;
  rawPrompt: string;
  entities: {
    sources: string[];
    destinations: string[];
    names: string[];
    constraints: string[];
  };
  /** Ordered executable steps when the user asked for more than one action */
  planSteps: PlanStepSpec[];
  /** operator = per-step paths (Power Automate / Computer Use); code = repo root */
  workspaceMode: WorkspaceMode;
  /** Distinct path roots touched by this task (VS Code multi-root style) */
  roots: string[];
  risk: TaskRisk;
  successCriteria: SuccessCriterion[];
  forbidden: string[];
  assumptions: string[];
  needsClarification: string[];
  /** Meaningful for workspaceMode=code only; for operator = Sam-Harness cwd or first root */
  targetRepo: string;
  packDir: string;
  allowClientCodeEdits: boolean;
};

export type ComposeAnswers = Record<string, string>;

export type SpecBuildInput = {
  prompt: string;
  title?: string;
  route?: UiRoute | "auto";
  targetRepo?: string;
  packDir?: string;
  allowClientCodeEdits?: boolean;
  id?: string;
  /** User answers to clarification questions (keyed by question text or q0, q1…) */
  answers?: ComposeAnswers;
};

/** Prefer this workspace when Control Plane runs from Sam-Harness; Maw3ed only when goal asks. */
function defaultArchitectureRepo(): string {
  const cwd = process.cwd();
  if (isSamHarnessWorkspace(cwd)) return cwd;
  return "E:\\UpNexa.com\\maw3ed";
}

const CONFIDENCE_GATE = 0.72;

function desktopPath(): string {
  return path.join(process.env.USERPROFILE || process.env.HOME || os.homedir(), "Desktop");
}

function detectLocale(text: string): "ar" | "en" | "mixed" {
  const ar = /[\u0600-\u06FF]/.test(text);
  const en = /[A-Za-z]{3,}/.test(text);
  if (ar && en) return "mixed";
  if (ar) return "ar";
  return "en";
}

export function detectRoute(prompt: string, hint?: UiRoute | "auto"): UiRoute {
  if (hint && hint !== "auto") return hint;
  const t = prompt.toLowerCase();

  if (
    /implement|level.?3|--go|apply patch|طبق على الكود|عدّل الكود|عدل الكود|نف[ّ']?ذ.*(?:الكود|code|tickets|التذاكر)/i.test(
      t
    )
  ) {
    return "implement";
  }

  if (
    /excel|xlsx|\.xls|csv|screenshot|لقطة|سكرين|انقل|احذف|امسح|افتح|اعمل ملف|أنشئ ملف|انشئ ملف|سو[ّ']?ي ملف|اكتب (فيه|في)|سطح المكتب|desktop|open |move |copy |folder|مجلد|ملف على|جدول|mkdir|delete|شيل|شِيل|حر[ّ']?ك/i.test(
      t
    ) &&
    !/architecture|saas|blueprint|multi-tenant|فجوات|حزمة تقارير|sam-harness no\.|مراجعة معمار|product spec|help system|marketing campaign/i.test(
      t
    )
  ) {
    return "operational";
  }

  if (
    /architecture|saas|تحليل نظام|تقرير تنفيذي|فجوات|gap matrix|fanni|maw3ed|موعد|مواصفات|توصيف|blueprint|backlog/i.test(
      t
    )
  ) {
    return "architecture";
  }

  return "architecture";
}

function extractFilename(goal: string): string | null {
  const m =
    goal.match(/([\w.\- ]+\.(?:txt|md|json|xls|xlsx|csv|png|jpg|jpeg|mp4|mkv|pdf|docx|zip))/i) ||
    goal.match(/الملف\s+([^\n]+?\.\w+)/i) ||
    goal.match(/file\s+([^\n]+?\.\w+)/i);
  return m?.[1]?.trim().replace(/["""']/g, "") || null;
}

/** Windows absolute path (file or folder), if present in the prompt. */
export function extractAbsoluteWinPath(text: string): string | null {
  // ASCII path segments only — stop before Arabic / whitespace instructions
  const m = text.match(/\b([A-Za-z]:\\(?:[\w.-]+\\)*[\w.-]+(?:\.[\w]+)?)/);
  if (!m?.[1]) return null;
  return m[1].replace(/[."""',]+$/g, "").trim();
}

/**
 * Strip location phrases / trailing instructions from folder or file base names.
 * "ladder-l2 على سطح المكتب" → "ladder-l2"
 */
export function cleanEntityName(raw: string): string {
  let s = String(raw || "")
    .trim()
    .replace(/^["'«]+|["'»]+$/g, "");
  s = s
    .replace(
      /\s*(?:على|في|فى|من|الي|إلى|to|on|in)?\s*(?:سطح المكتب|desktop|downloads|التنزيلات|documents|المستندات)\b.*/i,
      ""
    )
    .replace(/\s*\(\d+\).*$/g, "")
    .replace(/\s*(?:داخل|ثم|واكتب|اكتب|والمحتوى|المحتوى|content).*$/i, "")
    .replace(/\s*(?:على|في|فى)\s*(?:المسار|path)\b.*/i, "")
    .trim();
  // Prefer first identifier token when leftover is a phrase
  const token = s.split(/\s+/).filter(Boolean)[0] || s;
  const cleaned = (/^[\w.\u0600-\u06FF-]+$/u.test(token) ? token : s)
    .replace(/[<>:"|?*]/g, "")
    .trim();
  return cleaned.slice(0, 80);
}

function extractDriveDest(goal: string): string | null {
  const toDrive = goal.match(
    /(?:الى|إلي|الي|إلى|to)\s*(?:المحرك\s*)?([A-Za-z])\s*:/i
  );
  if (toDrive) return `${toDrive[1].toUpperCase()}:\\`;
  const d = goal.match(/المحرك\s*([A-Za-z])/i);
  if (d) return `${d[1].toUpperCase()}:\\`;
  return null;
}

function hasDesktop(goal: string): boolean {
  return /سطح المكتب|desktop/i.test(goal);
}

function extractFolderName(prompt: string): string | null {
  const raw =
    prompt.match(
      /(?:مجلد|folder|directory)\s+(?:باسم|بأسم|named?|called)?\s*[:\s]*([^\n.]+?)(?=\s+(?:على|في|فى|ثم|واكتب|اكتب|داخل|وال|and\b)|[.!\n]|$)/i
    )?.[1] ||
    prompt.match(/(?:باسم|بأسم)\s+([^\n.]+?)(?=\s+(?:على|في|فى|ثم|واكتب|اكتب|داخل)|[.!\n]|$)/i)?.[1] ||
    null;
  if (!raw) return null;
  const name = cleanEntityName(raw);
  return name || null;
}

function slugifyId(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^\w\u0600-\u06FF]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const ascii = base.replace(/[^\w-]+/g, "") || "task";
  return `${ascii}-${Date.now().toString(36)}`;
}

function mergeAnswersIntoPrompt(prompt: string, answers?: ComposeAnswers): string {
  if (!answers || !Object.keys(answers).length) return prompt;
  const lines = Object.entries(answers)
    .filter(([, v]) => String(v || "").trim())
    .map(([k, v]) => `- ${k}: ${v}`);
  if (!lines.length) return prompt;
  return `${prompt}\n\n## Clarifications\n${lines.join("\n")}`;
}

/** Collapse accidental `C:\\Users\\...` doubling from JSON/shell escaping. */
function normalizePathEscapes(text: string): string {
  return text.replace(/([A-Za-z]:)\\{2,}/g, "$1\\").replace(/\\{2,}(?=Users\\|[^\\\s])/g, "\\");
}

function rootOfPath(p: string): string {
  const n = path.normalize(p);
  if (/^[A-Za-z]:\\?$/.test(n.replace(/\\+$/, "") + "\\")) return n.endsWith("\\") ? n : n + "\\";
  if (/^(Desktop|Downloads|Documents)([\\/]|$)/i.test(n)) {
    return n.split(/[\\/]/)[0];
  }
  const parsed = path.parse(path.isAbsolute(n) ? n : path.resolve(n));
  if (parsed.root && parsed.root !== n) {
    // Keep first meaningful segment under drive: D:\file → D:\
    if (/^[A-Za-z]:\\/.test(n)) return parsed.root;
  }
  return parsed.root || n;
}

/** Distinct roots from entities + planSteps (multi-root workspace). */
export function collectTaskRoots(spec: {
  entities: TaskSpec["entities"];
  planSteps: PlanStepSpec[];
  targetRepo?: string;
}): string[] {
  const paths: string[] = [
    ...spec.entities.sources,
    ...spec.entities.destinations,
    ...spec.planSteps.flatMap((s) =>
      ["path", "source", "destination"]
        .map((k) => s.params[k])
        .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    ),
  ];
  const roots = new Set<string>();
  for (const p of paths) {
    try {
      roots.add(rootOfPath(resolveUserPath(p)));
    } catch {
      roots.add(rootOfPath(p));
    }
  }
  return [...roots];
}

/**
 * Build structured Task Spec from natural language (+ optional clarify answers).
 */
export function buildTaskSpec(input: SpecBuildInput): TaskSpec {
  const rawPrompt = normalizePathEscapes((input.prompt || "").trim());
  if (!rawPrompt) throw new Error("اكتب المهمة أولاً / Prompt is required");

  const prompt = mergeAnswersIntoPrompt(rawPrompt, input.answers);
  const locale = detectLocale(prompt);
  const route = detectRoute(prompt, input.route);
  const title =
    (input.title || "").trim() ||
    prompt
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith("#") && !l.startsWith("-"))
      ?.slice(0, 120) ||
    "Untitled Sam-Harness task";

  const desk = desktopPath();
  // Self-report / Sam-Harness Control Plane goals must not archive into Maw3ed
  // (includes common typo: حن نفسك ≈ عن نفسك)
  const aboutHarnessSelf =
    /(?:عن|حن)\s*نفسك|اسمك\s*(?:و|&)?\s*حدود|امكانياتك|إمكانياتك|تقدر تعمل|من\s*أنت|who\s*are\s*you|personal\s*agency|تقرير[\s\S]{0,48}نفسك/i.test(
      prompt
    ) ||
    (/control\s*plane|project-memory|daily\s*ops|run\s*lessons|عارض\s*التقارير/i.test(prompt) &&
      /sam-?harness/i.test(prompt));
  const promptIsClientProduct = /maw3ed|موعد|fanni|فني/i.test(prompt);

  let targetRepo = (input.targetRepo || "").trim();
  if (!targetRepo) {
    if (route === "operational") targetRepo = desk;
    else if (/maw3ed|موعد/i.test(prompt)) targetRepo = "E:\\UpNexa.com\\maw3ed";
    else if (/fanni|فني/i.test(prompt)) targetRepo = "E:\\UpNexa.com\\Fanni";
    else targetRepo = defaultArchitectureRepo();
  }
  if (route === "operational" && (/^desktop$/i.test(targetRepo) || targetRepo === "Desktop\\")) {
    targetRepo = desk;
  }
  if (aboutHarnessSelf && !promptIsClientProduct && route !== "operational") {
    targetRepo = process.cwd();
  }
  // UI often still has Maw3ed pre-filled — ignore that when goal is clearly Sam-Harness self
  if (
    aboutHarnessSelf &&
    !promptIsClientProduct &&
    route !== "operational" &&
    /maw3ed/i.test(targetRepo)
  ) {
    targetRepo = process.cwd();
  }
  // Packs always land under SAM_OUTPUT_HOME/reports — never <repo>/docs or Desktop
  let packDir = (input.packDir || "").trim() || defaultProjectDocsRoot(targetRepo);
  // Reject legacy packDir values that point inside a target/repo docs tree
  if (
    /[\\/]docs$/i.test(packDir) ||
    /maw3ed|\\fanni\\|\/fanni\//i.test(packDir) ||
    (isSamHarnessWorkspace() &&
      path.normalize(packDir).toLowerCase().startsWith(
        path.normalize(process.cwd()).toLowerCase() + path.sep
      ))
  ) {
    packDir = defaultProjectDocsRoot(targetRepo);
  }

  const allow = Boolean(input.allowClientCodeEdits) || route === "implement";
  const id = (input.id || "").trim() || slugifyId(title);

  let intent: TaskSpec["intent"] = "unknown";
  let confidence = 0.45;
  const sources: string[] = [];
  const destinations: string[] = [];
  const names: string[] = [];
  const constraints: string[] = [];
  const assumptions: string[] = [];
  const needsClarification: string[] = [];
  const successCriteria: SuccessCriterion[] = [];
  const forbidden: string[] = [];
  const planSteps: PlanStepSpec[] = [];
  let risk: TaskRisk = "low";

  if (route === "operational") {
    intent = detectOpsIntent(prompt);
    const filename = extractFilename(prompt);
    if (filename) names.push(filename);

    const wantsDelete = hasDeleteIntent(prompt);
    const wantsMkdir = /\bmkdir\b|اعمل\s*مجلد|أنشئ\s*مجلد|انشئ\s*مجلد|مجلد جديد/i.test(
      prompt
    );
    const wantsExcelInventory =
      /تقرير|report|list_dir|امسح|scan|موجود|جرد|قائمة\s*ب?الملفات|على\s*المحرك/i.test(
        prompt
      ) && /excel|\.xls|\.xlsx|جداول/i.test(prompt);
    const wantsExcel =
      !wantsExcelInventory &&
      /excel|جدول|\.xls/i.test(prompt) &&
      /اعمل|أنشئ|انشئ|اكتب|create/i.test(prompt);
    const wantsWriteDoc =
      /ملف\s*ورد|word|\.docx|\.rtf|اكتب\s*فيه|واكتب/i.test(prompt) &&
      /اعمل|أنشئ|انشئ|اكتب|create|ملف/i.test(prompt);
    const wantsWriteFile =
      (/اكتب\s*(?:ملف|فيه)|ملف\s*نصي|write\s*(?:a\s+)?file|readme\.txt/i.test(prompt) ||
        (/\.(txt|md|json)\b/i.test(prompt) && /اكتب|محتو|create|write|أنشئ|انشئ/i.test(prompt))) &&
      !wantsWriteDoc;

    if (intent === "move" || intent === "copy") {
      confidence = 0.55;
      if (filename && hasDesktop(prompt)) {
        sources.push(`Desktop\\${filename}`);
        confidence += 0.2;
      } else if (filename) {
        sources.push(filename);
        confidence += 0.1;
        needsClarification.push("من أين المسار المصدر بالكامل؟ (مثال: Desktop أو D:\\folder)");
      } else {
        needsClarification.push("ما اسم الملف المراد نقله/نسخه مع الامتداد؟");
      }
      const destRoot = extractDriveDest(prompt);
      if (destRoot && filename) {
        destinations.push(`${destRoot}${filename}`);
        confidence += 0.2;
      } else if (destRoot) {
        destinations.push(destRoot);
        confidence += 0.1;
        needsClarification.push("ما اسم الملف عند الوجهة؟");
      } else {
        needsClarification.push("إلى أين الوجهة؟ (مثال: المحرك D: أو مجلد محدد)");
      }
      if (destinations[0]) {
        successCriteria.push({ type: "exists", path: destinations[0] });
      }
      if (sources[0] && intent === "move") {
        successCriteria.push({ type: "absent", path: sources[0] });
      }
      successCriteria.push({ type: "tool_ok", tool: intent === "copy" ? "copy_file" : "move_file" });
      forbidden.push("write_excel", "screenshot", "architecture_crew");
      risk = "medium";
    } else if (intent === "create_excel") {
      confidence = 0.75;
      const named =
        prompt.match(/(?:بأسم|باسم|اسم(?:ه|ها)?|named?)\s*[:\s]*([^\n.]+)/i)?.[1]?.trim() ||
        filename?.replace(/\.(xls|xlsx|csv)$/i, "") ||
        "Sam-Harness-sheet";
      const base = /\.(xls|xlsx|csv)$/i.test(named) ? named : `${named}.xls`;
      names.push(base);
      const p = `Desktop\\${base}`;
      destinations.push(p);
      successCriteria.push({ type: "exists", path: p });
      successCriteria.push({ type: "tool_ok", tool: "write_excel" });
      if (/وقت|تاريخ|الحالي|datetime|date|time/i.test(prompt)) {
        constraints.push("A1 must contain current date/time");
      }
      forbidden.push("move_file", "screenshot", "architecture_crew");
      risk = "low";
    } else if (intent === "mkdir") {
      confidence = 0.78;
      const folder = extractFolderName(prompt);
      if (!folder) {
        needsClarification.push("ما اسم المجلد الجديد؟");
        confidence = 0.4;
      } else {
        names.push(folder);
        const absDir = extractAbsoluteWinPath(prompt);
        const p =
          absDir && !/\.\w+$/.test(absDir)
            ? absDir
            : hasDesktop(prompt)
              ? `Desktop\\${folder}`
              : folder;
        destinations.push(p);
        successCriteria.push({ type: "exists", path: p });
        successCriteria.push({ type: "tool_ok", tool: "mkdir" });
      }
      forbidden.push("delete_path", "architecture_crew");
      risk = "low";
    } else if (intent === "delete") {
      confidence = 0.5;
      risk = "destructive";
      const folderDel =
        prompt.match(
          /(?:امسح|احذف|حذف)\s+مجلد\s*["']?([^"'\n]+?)["']?\s*(?:من|في|فى)\s*(Downloads|التنزيلات|Desktop|سطح المكتب|Documents|المستندات|[A-Za-z]:\\[^\s]*)/i
        ) ||
        prompt.match(
          /(?:امسح|احذف)\s+مجلد\s*["']?([^"'\n]+?)["']?\s+من\s+(Downloads|التنزيلات)/i
        );
      if (folderDel) {
        const folder = folderDel[1].replace(/[<>:"|?*]/g, "").trim();
        const parentRaw = folderDel[2];
        const parent = /downloads|التنزيلات/i.test(parentRaw)
          ? "Downloads"
          : /desktop|سطح/i.test(parentRaw)
            ? "Desktop"
            : /documents|مستندات/i.test(parentRaw)
              ? "Documents"
              : parentRaw.replace(/[\\/]+$/, "");
        const p = `${parent}\\${folder}`;
        sources.push(p);
        names.push(folder);
        successCriteria.push({ type: "absent", path: p });
        successCriteria.push({ type: "tool_ok", tool: "delete_path" });
        confidence = 0.78;
      } else if (!filename && !/مجلد|folder|directory/i.test(prompt)) {
        needsClarification.push("ما المسار الكامل للملف/المجلد المراد حذفه؟");
      } else {
        const p = filename
          ? hasDesktop(prompt)
            ? `Desktop\\${filename}`
            : filename
          : "";
        if (p) {
          sources.push(p);
          successCriteria.push({ type: "absent", path: p });
          successCriteria.push({ type: "tool_ok", tool: "delete_path" });
          confidence = 0.78;
        } else {
          needsClarification.push("ما اسم المجلد/الملف المراد حذفه والمسار؟");
        }
      }
      needsClarification.push(
        "تأكيد الحذف النهائي؟ اكتب نعم للحذف (destructive — لا سلة محذوفات مضمونة)"
      );
      forbidden.push("write_excel", "architecture_crew");
      if (!input.answers || !Object.values(input.answers).some((v) => /نعم|yes|confirm/i.test(v))) {
        confidence = Math.min(confidence, 0.55);
      } else {
        confidence = Math.max(confidence, 0.85);
        assumptions.push("User confirmed destructive delete");
      }
    } else if (intent === "screenshot") {
      confidence = 0.8;
      const name =
        prompt.match(/["']([^"']+)["']/)?.[1] ||
        prompt.match(/اسم\s*[:\s]*([^\n]+)/i)?.[1]?.trim() ||
        "screenshot.png";
      names.push(name);
      const p = `Desktop\\${/\.(png|jpg|jpeg)$/i.test(name) ? name : name + ".png"}`;
      destinations.push(p);
      successCriteria.push({ type: "exists", path: p });
      successCriteria.push({ type: "tool_ok", tool: "screenshot" });
      forbidden.push("write_excel", "move_file");
    } else if (intent === "write_file") {
      confidence = 0.72;
      const abs = extractAbsoluteWinPath(prompt);
      const reportName =
        prompt.match(
          /(?:باسم|named?)\s+([\w.\u0600-\u06FF-]+\.(?:txt|md))/i
        )?.[1] || filename;
      const name = cleanEntityName(
        reportName || (abs ? path.basename(abs) : "sam-harness-output.txt")
      );
      names.push(name);
      const p = abs || (hasDesktop(prompt) ? `Desktop\\${name}` : `Desktop\\${name}`);
      destinations.push(p);
      successCriteria.push({ type: "exists", path: p });
      successCriteria.push({ type: "tool_ok", tool: "write_file" });
      if (wantsExcelInventory) {
        // Live operator must scan then write — do not bake a static Spec plan
        constraints.push("requires_live_scan: list_dir or run_shell Get-ChildItem on D: then write_file report");
        successCriteria.push({ type: "tool_ok", tool: "list_dir" });
        // list_dir OR run_shell may satisfy scan — steps_covered checked loosely via tools in summary
        successCriteria.push({
          type: "steps_covered",
          tools: ["write_file"],
        });
        successCriteria.push({ type: "contains", path: p, text: "D:" });
        if (!destinations.includes("D:\\") && /المحرك\s*D|D:\\/i.test(prompt)) {
          sources.push("D:\\");
        }
        confidence = Math.max(confidence, 0.8);
        assumptions.push("Excel inventory report — operator LLM scans before write");
      } else {
        const body = extractWriteFileContent(prompt);
        if (body) {
          successCriteria.push({ type: "contains", path: p, text: body });
          constraints.push(`file content must include: ${body.slice(0, 120)}`);
          confidence = Math.max(confidence, 0.78);
        } else if (/وقت|تاريخ|الحالي|datetime|date|time/i.test(prompt)) {
          constraints.push("file content must include current date/time");
        }
      }
      forbidden.push("architecture_crew");
    } else if (intent === "open") {
      confidence = filename ? 0.75 : 0.4;
      if (!filename) needsClarification.push("ما المسار المراد فتحه؟");
      else {
        sources.push(hasDesktop(prompt) ? `Desktop\\${filename}` : filename);
        successCriteria.push({ type: "tool_ok", tool: "open_path" });
      }
    } else {
      confidence = 0.35;
      needsClarification.push(
        "لم أتعرّف على نوع العملية بوضوح. هل المطلوب نقل، إنشاء، حذف، لقطة، أم شيء آخر؟"
      );
    }

    // Compound requests (e.g. delete + mkdir) — do not drop the second action
    if (wantsDelete && wantsMkdir) {
      const delPath =
        sources[0] ||
        (filename ? (hasDesktop(prompt) ? `Desktop\\${filename}` : filename) : "");
      const dlMatch = prompt.match(
        /((?:[A-Za-z]:\\(?:Users\\[^\\\s]+\\)?Downloads)|Downloads|التنزيلات)/i
      );
      // Prefer "احط فيه صوري" / named folder; reject Arabic prepositions mistaken as names
      const stopWords = /^(علي|على|في|فى|الي|إلى|المسار|path|to|on|in|new)$/i;
      let folderName =
        prompt.match(/(?:احط|ضع|حط)\s*فيه\s+([^\n.\\/]+)/i)?.[1]?.trim() ||
        prompt.match(
          /مجلد(?:\s+جديد)?\s+(?:باسم|بأسم|named?|called)\s*[:\s]*([^\n.\\/]+)/i
        )?.[1]?.trim() ||
        "";
      folderName = folderName.replace(/[<>:"|?*]/g, "").trim();
      if (!folderName || stopWords.test(folderName)) {
        folderName = /صور/i.test(prompt) ? "صوري" : "";
      }
      // Normalize common spelling صورى → صوري
      if (/^صورى$/i.test(folderName)) folderName = "صوري";
      const parent = dlMatch ? dlMatch[1].trim() : "Downloads";
      const dirPath = folderName
        ? parent.replace(/[\\/]+$/, "") + "\\" + folderName
        : "";

      planSteps.length = 0;
      if (delPath) {
        planSteps.push({
          intent: "delete",
          tool: "delete_path",
          params: { path: delPath, confirm: true },
          summary: `Delete ${delPath}`,
        });
      }
      if (dirPath) {
        planSteps.push({
          intent: "mkdir",
          tool: "mkdir",
          params: { path: dirPath },
          summary: `Create folder ${dirPath}`,
        });
        if (!destinations.includes(dirPath)) destinations.push(dirPath);
        if (!successCriteria.some((c) => c.type === "exists" && c.path === dirPath)) {
          successCriteria.push({ type: "exists", path: dirPath });
        }
        if (!successCriteria.some((c) => c.type === "tool_ok" && c.tool === "mkdir")) {
          successCriteria.push({ type: "tool_ok", tool: "mkdir" });
        }
        if (
          delPath &&
          !successCriteria.some((c) => c.type === "steps_covered")
        ) {
          successCriteria.push({
            type: "steps_covered",
            tools: ["delete_path", "mkdir"],
          });
        }
      } else {
        needsClarification.push(
          "ما اسم المجلد الجديد داخل Downloads؟ (مثال: صوري)"
        );
      }
      constraints.push("multi_step: delete then mkdir");
      intent = "delete"; // primary label; planSteps drive execution
      risk = "destructive";
      needsClarification.push(
        "طلبك فيه خطوتان (حذف ملف + إنشاء مجلد). اكتب نعم للتنفيذ بالترتيب"
      );
      confidence = Math.min(confidence, 0.58);
      if (
        input.answers &&
        Object.values(input.answers).some((v) => /نعم|yes|confirm/i.test(String(v)))
      ) {
        confidence = Math.max(confidence, 0.9);
        assumptions.push("User confirmed multi-step delete+mkdir");
      }
    } else if (wantsExcel && wantsMkdir) {
      needsClarification.push(
        "طلبك يخلط إنشاء Excel وإنشاء مجلد — نفّذ أيهما أولاً؟ اكتب: excel أو مجلد"
      );
      confidence = Math.min(confidence, 0.5);
    }

    // Compound: mkdir then write_file (no delete) — do not collapse to mkdir-only
    if (wantsMkdir && wantsWriteFile && !wantsDelete) {
      const folder = extractFolderName(prompt) || cleanEntityName(names[0] || "");
      const fileName =
        cleanEntityName(filename || "readme.txt") ||
        (/\.(txt|md|json)$/i.test(filename || "") ? filename! : "readme.txt");
      const fileBase = /\.\w+$/.test(fileName) ? fileName : `${fileName}.txt`;
      const absFile = extractAbsoluteWinPath(prompt);
      const absLooksFile = absFile ? /\.\w+$/.test(absFile) : false;
      const dirPath = absFile && !absLooksFile
        ? absFile
        : absFile && absLooksFile
          ? path.dirname(absFile)
          : hasDesktop(prompt) && folder
            ? `Desktop\\${folder}`
            : folder
              ? `Desktop\\${folder}`
              : "";
      const filePath =
        absLooksFile && absFile
          ? absFile
          : dirPath
            ? `${dirPath.replace(/[\\/]+$/, "")}\\${path.basename(fileBase)}`
            : hasDesktop(prompt)
              ? `Desktop\\${path.basename(fileBase)}`
              : path.basename(fileBase);
      const body = extractWriteFileContent(prompt);

      if (!folder && !dirPath) {
        needsClarification.push("ما اسم المجلد الجديد؟");
        confidence = Math.min(confidence, 0.45);
      } else {
        planSteps.length = 0;
        planSteps.push({
          intent: "mkdir",
          tool: "mkdir",
          params: { path: dirPath },
          summary: `Create folder ${dirPath}`,
        });
        planSteps.push({
          intent: "write_file",
          tool: "write_file",
          params: {
            path: filePath,
            content: body || "Created by Sam-Harness",
          },
          summary: `Write ${filePath}`,
        });
        destinations.length = 0;
        destinations.push(dirPath, filePath);
        if (folder && !names.includes(folder)) names.push(folder);
        if (!names.includes(path.basename(fileBase))) names.push(path.basename(fileBase));
        successCriteria.length = 0;
        successCriteria.push({ type: "exists", path: dirPath });
        successCriteria.push({ type: "exists", path: filePath });
        successCriteria.push({ type: "tool_ok", tool: "mkdir" });
        successCriteria.push({ type: "tool_ok", tool: "write_file" });
        successCriteria.push({ type: "steps_covered", tools: ["mkdir", "write_file"] });
        if (body) {
          successCriteria.push({ type: "contains", path: filePath, text: body });
          constraints.push(`file content must include: ${body.slice(0, 120)}`);
        }
        constraints.push("multi_step: mkdir then write_file");
        intent = "mkdir";
        risk = "low";
        confidence = Math.max(confidence, 0.82);
        assumptions.push("Compound mkdir→write_file plan from prompt");
        // Drop delete-style clarify noise if any leaked
        const drop = new Set(
          needsClarification.filter((q) => /حذف|destructive|خطوتان \(حذف/i.test(q))
        );
        for (let i = needsClarification.length - 1; i >= 0; i--) {
          if (drop.has(needsClarification[i])) needsClarification.splice(i, 1);
        }
      }
    }

    // Compound: delete (+folder) then write document (Word/RTF/txt) on a drive
    if (wantsDelete && wantsWriteDoc) {
      const delPath =
        sources[0] ||
        (filename ? (hasDesktop(prompt) ? `Desktop\\${filename}` : filename) : "");
      const drive =
        prompt.match(/(?:المكان|على|في|فى|to)\s*([A-Za-z]:)\\?/i)?.[1]?.toUpperCase() ||
        prompt.match(/\b([A-Za-z]:)\\?(?=\s|$)/)?.[1]?.toUpperCase() ||
        "";
      const quoted =
        prompt.match(/["«]([^"»]+)["»]/)?.[1]?.trim() ||
        prompt.match(/اهلا[^.\n]*/i)?.[0]?.trim() ||
        "اهلا";
      const nameFill =
        input.answers &&
        Object.entries(input.answers).find(([k]) => /اسم|name/i.test(k))?.[1];
      const bodyText = /نقط|\.{2,}/i.test(quoted)
        ? quoted.replace(/\.{2,}|نقط+/g, String(nameFill || "Sam-Harness").trim())
        : `${quoted}${nameFill ? ` ${nameFill}` : ""}`.trim();
      const fileName = "اهلا-اسمي.rtf";
      const destPath = drive ? `${drive}\\${fileName}` : "";
      const rtfContent = `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\f0\\fs24 ${bodyText.replace(
        /[\\{}]/g,
        ""
      )}\\par}`;

      planSteps.length = 0;
      if (delPath) {
        planSteps.push({
          intent: "delete",
          tool: "delete_path",
          params: { path: delPath, confirm: true, recursive: true },
          summary: `Delete ${delPath}`,
        });
      }
      if (destPath) {
        planSteps.push({
          intent: "write_file",
          tool: "write_file",
          params: { path: destPath, content: rtfContent },
          summary: `Write ${destPath}`,
        });
        if (!destinations.includes(destPath)) destinations.push(destPath);
        successCriteria.push({ type: "exists", path: destPath });
        successCriteria.push({ type: "tool_ok", tool: "write_file" });
      } else {
        needsClarification.push("أين يُحفظ ملف الورد؟ (مثال: D:)");
      }
      if (!nameFill && /نقط|\.{2,}/i.test(prompt)) {
        needsClarification.push("ما الاسم المراد كتابته مكان النقط؟");
      }
      constraints.push("multi_step: delete then write_file");
      intent = "delete";
      risk = "destructive";
      needsClarification.push(
        "طلبك فيه خطوتان (حذف + كتابة ملف). اكتب نعم للتنفيذ بالترتيب"
      );
      confidence = Math.min(confidence, 0.55);
      if (
        input.answers &&
        Object.values(input.answers).some((v) => /نعم|yes|confirm/i.test(String(v)))
      ) {
        confidence = Math.max(confidence, 0.88);
        assumptions.push("User confirmed multi-step delete+write");
      }
    }

    // Apply answers that fill slots
    if (input.answers) {
      for (const [k, v] of Object.entries(input.answers)) {
        const val = String(v || "").trim();
        if (!val) continue;
        if (/مصدر|source/i.test(k) && !sources.length) {
          sources.push(val);
          confidence += 0.15;
        }
        if (/وجه|destin|إلى أين|الي اين/i.test(k) && !destinations.length) {
          destinations.push(val);
          confidence += 0.15;
        }
        if (/اسم الملف|filename|ما اسم/i.test(k) && !names.length) {
          names.push(val);
          confidence += 0.12;
        }
      }
      // Recompute criteria if answers filled gaps
      if ((intent === "move" || intent === "copy") && sources[0] && destinations[0]) {
        successCriteria.length = 0;
        let dest = destinations[0];
        if (/^[A-Za-z]:\\?$/.test(dest.replace(/\\+$/, "") + "\\") && names[0]) {
          dest = dest.endsWith("\\") ? dest + names[0] : dest + "\\" + names[0];
          destinations[0] = dest;
        }
        successCriteria.push({ type: "exists", path: dest });
        if (intent === "move") successCriteria.push({ type: "absent", path: sources[0] });
        successCriteria.push({
          type: "tool_ok",
          tool: intent === "copy" ? "copy_file" : "move_file",
        });
        needsClarification.length = 0;
        confidence = Math.max(confidence, 0.88);
      }
    }
  } else if (route === "implement") {
    intent = "implement";
    confidence = /go|موافق|نفّذ|نفذ/i.test(prompt) ? 0.7 : 0.55;
    risk = "high";
    successCriteria.push({ type: "pack_created", note: "implementation journal / code changes" });
    forbidden.push("unapproved_system_paths");
    if (!allow) {
      needsClarification.push("هل تأذن بتنفيذ على كود العميل؟ (يتطلب GO عند التشغيل)");
    }
  } else {
    intent = "analyze";
    confidence = /maw3ed|موعد|fanni|فني|تحليل|تقرير/i.test(prompt) ? 0.8 : 0.6;
    risk = "low";
    successCriteria.push({
      type: "pack_created",
      note: "Sam-Harness no.X with audit + execution-plan",
    });
    forbidden.push("client_code_edit_without_go");
    assumptions.push(`targetRepo=${targetRepo}`);
  }

  confidence = Math.max(0.05, Math.min(0.99, confidence));

  // Drop clarification questions that answers already addressed
  if (input.answers && Object.keys(input.answers).length) {
    const answered = Object.keys(input.answers)
      .concat(Object.values(input.answers))
      .join(" ")
      .toLowerCase();
    for (let i = needsClarification.length - 1; i >= 0; i--) {
      const q = needsClarification[i];
      if (
        (/تأكيد الحذف|خطوتان|بالترتيب/i.test(q) && /نعم|yes|confirm/i.test(answered)) ||
        (/اسم المجلد/i.test(q) &&
          Object.entries(input.answers).some(
            ([k, v]) => /مجلد|folder|اسم المجلد/i.test(k) && String(v).trim()
          )) ||
        (/مكان النقط|الاسم المراد/i.test(q) &&
          Object.entries(input.answers).some(
            ([k, v]) => /نقط|اسم/i.test(k) && String(v).trim()
          ))
      ) {
        needsClarification.splice(i, 1);
      }
    }
    // Fill name placeholder in write_file plan step
    const nameAns = Object.entries(input.answers).find(
      ([k, v]) => /نقط|الاسم المراد|ما الاسم/i.test(k) && String(v || "").trim()
    )?.[1];
    if (nameAns && String(nameAns).trim()) {
      const nm = String(nameAns).trim();
      const wr = planSteps.find((s) => s.tool === "write_file");
      if (wr && typeof wr.params.content === "string") {
        wr.params.content = String(wr.params.content).replace(
          /Sam-Harness|\.{2,}|نقط+/g,
          nm
        );
        // also plain "...." patterns inside RTF body
        wr.params.content = String(wr.params.content).replace(/\.{2,}/g, nm);
        wr.summary = wr.summary || `Write with name ${nm}`;
      }
      confidence = Math.max(confidence, 0.88);
    }

    // Folder name answer — only questions that ask for the name (not multi-step confirm)
    const folderAns = Object.entries(input.answers).find(
      ([k, v]) =>
        /اسم المجلد|ما اسم المجلد|folder\s*name|اسم المجلد الجديد/i.test(k) &&
        !/خطوتان|تأكيد|بالترتيب/i.test(k) &&
        String(v || "").trim() &&
        !/^(نعم|yes|confirm)$/i.test(String(v).trim())
    )?.[1];
    if (folderAns && String(folderAns).trim()) {
      const name = String(folderAns).trim().replace(/[<>:"|?*]/g, "");
      const parent =
        prompt.match(/((?:[A-Za-z]:\\(?:Users\\[^\\\s]+\\)?Downloads))/i)?.[1] ||
        "Downloads";
      const dirPath = `${parent.replace(/[\\/]+$/, "")}\\${name}`;
      if (!planSteps.some((s) => s.tool === "mkdir")) {
        planSteps.push({
          intent: "mkdir",
          tool: "mkdir",
          params: { path: dirPath },
          summary: `Create folder ${dirPath}`,
        });
      } else {
        const mk = planSteps.find((s) => s.tool === "mkdir");
        if (mk) {
          mk.params.path = dirPath;
          mk.summary = `Create folder ${dirPath}`;
        }
      }
      if (!destinations.includes(dirPath)) destinations.push(dirPath);
      if (!successCriteria.some((c) => c.type === "exists" && c.path === dirPath)) {
        successCriteria.push({ type: "exists", path: dirPath });
      }
      confidence = Math.max(confidence, 0.88);
    }
  }

  // Gate: keep questions only when below threshold OR destructive confirm still open
  const gatedQuestions =
    confidence < CONFIDENCE_GATE ||
    needsClarification.some((q) => /تأكيد الحذف|خطوتان/i.test(q))
      ? [...needsClarification]
      : [];

  const workspaceMode: WorkspaceMode = route === "operational" ? "operator" : "code";
  const roots = collectTaskRoots({
    entities: { sources, destinations, names, constraints },
    planSteps,
    targetRepo,
  });
  // Operator mode: do not pretend Desktop/repo is the single workspace
  if (workspaceMode === "operator") {
    targetRepo = process.cwd();
    // packDir unused for ops; keep desk-local logs path optional
    if (!packDir || packDir === desk) {
      // leave packDir as desk only if user set it; else Sam-Harness
    }
  }

  return {
    id,
    locale,
    route,
    intent,
    confidence,
    title,
    goal: prompt.split(/\n## Clarifications/)[0].trim(),
    rawPrompt,
    entities: { sources, destinations, names, constraints },
    planSteps,
    workspaceMode,
    roots,
    risk,
    successCriteria,
    forbidden,
    assumptions,
    needsClarification: gatedQuestions,
    targetRepo,
    packDir,
    allowClientCodeEdits: allow,
  };
}

export function needsClarify(spec: TaskSpec): boolean {
  return spec.confidence < CONFIDENCE_GATE && spec.needsClarification.length > 0;
}

export function renderSpecMarkdown(spec: TaskSpec): string {
  const sc = spec.successCriteria
    .map((c) => {
      if (c.type === "exists") return `- [exists] \`${c.path}\``;
      if (c.type === "absent") return `- [absent] \`${c.path}\``;
      if (c.type === "contains") return `- [contains] \`${c.path}\` :: ${c.text}`;
      if (c.type === "tool_ok") return `- [tool_ok] \`${c.tool}\``;
      if (c.type === "steps_covered") {
        return `- [steps_covered] \`${c.tools.join(" → ")}\``;
      }
      if (c.type === "pack_created") return `- [pack_created] ${c.note}`;
      return `- [unknown]`;
    })
    .join("\n");

  if (spec.route === "operational") {
    return `# Sam-Harness Task — Desktop Operator

## Route
operational

## Title
${spec.title}

## Goal
${spec.goal}

## Task Spec
- id: \`${spec.id}\`
- intent: \`${spec.intent}\`
- confidence: ${spec.confidence.toFixed(2)}
- risk: \`${spec.risk}\`
- locale: \`${spec.locale}\`

## Entities
- sources: ${spec.entities.sources.map((s) => `\`${s}\``).join(", ") || "—"}
- destinations: ${spec.entities.destinations.map((s) => `\`${s}\``).join(", ") || "—"}
- names: ${spec.entities.names.map((s) => `\`${s}\``).join(", ") || "—"}
- constraints: ${spec.entities.constraints.join("; ") || "—"}
${
  spec.planSteps?.length
    ? `\n## Plan steps\n${spec.planSteps
        .map((s, i) => `${i + 1}. \`${s.tool}\` — ${s.summary}`)
        .join("\n")}\n`
    : ""
}

## Workspace model
- mode: \`operator\` (Computer Use / Power Automate style — per-step paths)
- roots: ${spec.roots?.map((r) => `\`${r}\``).join(", ") || "—"}
- agent cwd: \`${spec.targetRepo}\` (Sam-Harness; not a single file workspace)

## Hard boundary
- Desktop Operator only — no Strategist/Auditor/Architect/Help/Marketer.
- Forbidden: ${spec.forbidden.join(", ") || "—"}
- Assumptions: ${spec.assumptions.join("; ") || "—"}

## Mission
1. Execute planSteps in order (each step has its own path — do not collapse to one folder).
2. Obey intent=\`${spec.intent}\` as primary label only.
3. Satisfy every Success criterion.
4. Write only ops logs (\`final-report.md\` / \`execution-result.md\`).
5. Never invent paths (no Desktop/old.txt fallbacks).

## Success criteria
${sc || "- Goal completed on disk"}
`.trim();
  }

  if (spec.route === "implement") {
    return `# Sam-Harness Task — Implement

## Route
implement

## Title
${spec.title}

## Goal
${spec.goal}

## Task Spec
- id: \`${spec.id}\`
- intent: implement
- confidence: ${spec.confidence.toFixed(2)}
- risk: \`${spec.risk}\`

## Target
- targetRepo: \`${spec.targetRepo}\`
- packDir: \`${spec.packDir}\`

## Hard boundary
- Requires runtime GO.
- Forbidden: ${spec.forbidden.join(", ")}

## Success criteria
${sc}
`.trim();
  }

  return `# Sam-Harness Task

## Route
architecture

## Title
${spec.title}

## Goal
${spec.goal}

## Task Spec
- id: \`${spec.id}\`
- intent: analyze
- confidence: ${spec.confidence.toFixed(2)}
- risk: \`${spec.risk}\`

## Target
- targetRepo: \`${spec.targetRepo}\`
- packDir: \`${spec.packDir}\`

## Hard boundary
- READ for evidence; WRITE pack under SAM_OUTPUT_HOME/reports/Sam-Harness no.X only unless GO.
- On [REJECTED]: أسباب الرفض + درجة الخطورة + طريقة الحل.
- Forbidden: ${spec.forbidden.join(", ")}

## Mission
1. Intake / Evidence
2. Strategist ↔ Auditor (≤5)
3. Architect / Help / Marketer after APPROVED
4. Delivery OS + pack archive

## Success criteria
${sc}
`.trim();
}

export function writeTaskSpecFiles(
  cwd: string,
  spec: TaskSpec
): { specJson: string; taskMd: string } {
  fs.mkdirSync(cwd, { recursive: true });
  const specJson = path.join(cwd, "task.spec.json");
  const taskMd = path.join(cwd, "task.md");
  fs.writeFileSync(specJson, JSON.stringify(spec, null, 2), "utf-8");
  fs.writeFileSync(taskMd, renderSpecMarkdown(spec) + "\n", "utf-8");
  return { specJson, taskMd };
}

export function readTaskSpec(cwd: string = process.cwd()): TaskSpec | null {
  const resolved = resolveTaskReadPath("task.spec.json", cwd);
  const p = resolved || path.join(cwd, "task.spec.json");
  try {
    if (!fs.existsSync(p)) return null;
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as TaskSpec;
    if (!raw.workspaceMode) {
      raw.workspaceMode = raw.route === "operational" ? "operator" : "code";
    }
    if (!Array.isArray(raw.planSteps)) raw.planSteps = [];
    if (!Array.isArray(raw.roots) || !raw.roots.length) {
      raw.roots = collectTaskRoots(raw);
    }
    return raw;
  } catch {
    return null;
  }
}

export function parseSuccessCriteriaFromMarkdown(task: string): SuccessCriterion[] {
  const block = task.match(/## Success criteria\s*\n([\s\S]*?)(?=\n## |\n# |$)/i)?.[1] || "";
  const out: SuccessCriterion[] = [];
  for (const line of block.split(/\n/)) {
    const exists = line.match(/\[exists\]\s*`([^`]+)`/i);
    if (exists) out.push({ type: "exists", path: exists[1] });
    const absent = line.match(/\[absent\]\s*`([^`]+)`/i);
    if (absent) out.push({ type: "absent", path: absent[1] });
    const tool = line.match(/\[tool_ok\]\s*`([^`]+)`/i);
    if (tool) out.push({ type: "tool_ok", tool: tool[1] });
    const pack = line.match(/\[pack_created\]\s*(.+)/i);
    if (pack) out.push({ type: "pack_created", note: pack[1].trim() });
    const contains = line.match(/\[contains\]\s*`([^`]+)`\s*::\s*(.+)/i);
    if (contains) out.push({ type: "contains", path: contains[1], text: contains[2].trim() });
    const steps = line.match(/\[steps_covered\]\s*`([^`]+)`/i);
    if (steps) {
      const tools = steps[1]
        .split(/\s*(?:→|->|,)\s*/)
        .map((t) => t.trim())
        .filter(Boolean);
      if (tools.length) out.push({ type: "steps_covered", tools });
    }
  }
  return out;
}

export function verifySuccessCriteria(
  criteria: SuccessCriterion[],
  executionSummary: string
): { verified: boolean; reason: string; details: string[] } {
  if (!criteria.length) {
    return { verified: false, reason: "No success criteria in Task Spec", details: [] };
  }
  const details: string[] = [];
  for (const c of criteria) {
    if (c.type === "exists") {
      const abs = resolveUserPath(c.path);
      const ok = fs.existsSync(abs);
      details.push(`${ok ? "OK" : "FAIL"} exists ${abs}`);
      if (!ok) return { verified: false, reason: `Missing required path: ${abs}`, details };
    } else if (c.type === "absent") {
      const abs = resolveUserPath(c.path);
      const gone = !fs.existsSync(abs);
      details.push(`${gone ? "OK" : "FAIL"} absent ${abs}`);
      if (!gone) return { verified: false, reason: `Path still present: ${abs}`, details };
    } else if (c.type === "tool_ok") {
      // Inventory scans may use run_shell instead of list_dir
      const altScan =
        c.tool === "list_dir" &&
        /\brun_shell\b/i.test(executionSummary) &&
        !/\[FAIL\][^\n]*run_shell/i.test(executionSummary);
      const hit =
        altScan ||
        (new RegExp(`\\b${c.tool}\\b`, "i").test(executionSummary) &&
          !new RegExp(`\\[FAIL\\].*${c.tool}|${c.tool}.*FAIL`, "i").test(executionSummary));
      details.push(`${hit ? "OK" : "FAIL"} tool_ok ${c.tool}${altScan ? " (via run_shell)" : ""}`);
      if (!hit) {
        return {
          verified: false,
          reason: `Required tool not successful: ${c.tool}`,
          details,
        };
      }
    } else if (c.type === "contains") {
      const abs = resolveUserPath(c.path);
      if (!fs.existsSync(abs)) {
        return { verified: false, reason: `Missing file for contains: ${abs}`, details };
      }
      const text = fs.readFileSync(abs, "utf-8");
      const ok = text.includes(c.text);
      details.push(`${ok ? "OK" : "FAIL"} contains ${c.text}`);
      if (!ok) return { verified: false, reason: `Content missing in ${abs}`, details };
    } else if (c.type === "steps_covered") {
      for (const tool of c.tools) {
        // Accept both "- [OK] mkdir: ..." (execution-result) and "mkdir: ..." (verify summary)
        const mentioned =
          new RegExp(`\\[OK\\]\\s*${tool}\\b`, "i").test(executionSummary) ||
          new RegExp(`(?:^|\\n)\\s*${tool}\\s*:`, "i").test(executionSummary) ||
          new RegExp(`"tool"\\s*:\\s*"${tool}"`, "i").test(executionSummary) ||
          new RegExp(`\\b${tool}\\b`, "i").test(executionSummary);
        const failed = new RegExp(
          `\\[FAIL\\][^\\n]*${tool}|${tool}[^\\n]*(?:FAIL|failed|Error)`,
          "i"
        ).test(executionSummary);
        const hit = mentioned && !failed;
        details.push(`${hit ? "OK" : "FAIL"} steps_covered ${tool}`);
        if (!hit) {
          return {
            verified: false,
            reason: `Compound step missing or failed: ${tool}`,
            details,
          };
        }
      }
    } else if (c.type === "pack_created") {
      const ok = /Sam-Harness no\.|pack|PACK_HANDOFF|execution-plan|audit-report/i.test(
        executionSummary
      );
      details.push(`${ok ? "OK" : "FAIL"} pack_created`);
      if (!ok) {
        return { verified: false, reason: `Pack evidence missing: ${c.note}`, details };
      }
    }
  }
  return { verified: true, reason: "All success criteria satisfied", details };
}

export function fingerprintSpec(spec: TaskSpec): string {
  const key = `${spec.route}|${spec.intent}|${spec.goal}`.toLowerCase().replace(/\s+/g, " ");
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 24);
}

/** Deterministic tool plan from Spec entities (executor must follow Spec, not re-guess). */
export function planToolsFromSpec(
  spec: TaskSpec
): Array<{ action: "tool"; tool: string; params: Record<string, unknown> } | { action: "finish"; summary: string; success: boolean }> {
  const steps: Array<
    | { action: "tool"; tool: string; params: Record<string, unknown> }
    | { action: "finish"; summary: string; success: boolean }
  > = [];

  if (spec.planSteps?.length) {
    for (const s of spec.planSteps) {
      steps.push({ action: "tool", tool: s.tool, params: s.params });
    }
    steps.push({
      action: "finish",
      summary: spec.planSteps.map((s) => s.summary).join(" → "),
      success: true,
    });
    return steps;
  }

  // Force CEO/LLM loop for inventory/scan reports (content depends on live listing)
  if (
    spec.entities.constraints.some((c) => /requires_live_scan/i.test(c)) ||
    /requires_live_scan/i.test(spec.goal)
  ) {
    return [];
  }

  const src = spec.entities.sources[0];
  const dst = spec.entities.destinations[0];
  const name = spec.entities.names[0];

  if (spec.intent === "move" && src && dst) {
    steps.push({ action: "tool", tool: "move_file", params: { source: src, destination: dst } });
    steps.push({ action: "finish", summary: `Moved ${src} -> ${dst}`, success: true });
    return steps;
  }
  if (spec.intent === "copy" && src && dst) {
    steps.push({ action: "tool", tool: "copy_file", params: { source: src, destination: dst } });
    steps.push({ action: "finish", summary: `Copied ${src} -> ${dst}`, success: true });
    return steps;
  }
  if (spec.intent === "create_excel" && dst) {
    const stamp = new Date().toLocaleString();
    steps.push({
      action: "tool",
      tool: "write_excel",
      params: { path: dst, a1: stamp },
    });
    steps.push({
      action: "finish",
      summary: `Excel created at ${dst} (A1=${stamp})`,
      success: true,
    });
    return steps;
  }
  if (spec.intent === "mkdir" && dst) {
    steps.push({ action: "tool", tool: "mkdir", params: { path: dst } });
    steps.push({ action: "finish", summary: `Directory ready: ${dst}`, success: true });
    return steps;
  }
  if (spec.intent === "delete" && src) {
    steps.push({
      action: "tool",
      tool: "delete_path",
      params: { path: src, confirm: true, recursive: /مجلد|folder|directory/i.test(spec.goal) },
    });
    steps.push({ action: "finish", summary: `Deleted ${src}`, success: true });
    return steps;
  }
  if (spec.intent === "screenshot" && dst) {
    steps.push({
      action: "tool",
      tool: "screenshot",
      params: { filename: name || path.basename(dst) },
    });
    steps.push({ action: "finish", summary: `Screenshot saved as ${dst}`, success: true });
    return steps;
  }
  if (spec.intent === "write_file" && dst) {
    const fromConstraint = spec.entities.constraints
      .find((c) => /file content must include:/i.test(c))
      ?.replace(/file content must include:\s*/i, "")
      .trim();
    const extracted =
      fromConstraint ||
      extractWriteFileContent(spec.goal) ||
      extractWriteFileContent(spec.rawPrompt);
    const content = extracted
      ? extracted
      : /وقت|تاريخ|الحالي/i.test(spec.goal)
        ? new Date().toLocaleString()
        : "Created by Sam-Harness";
    steps.push({
      action: "tool",
      tool: "write_file",
      params: { path: dst, content },
    });
    steps.push({ action: "finish", summary: `Wrote ${dst}`, success: true });
    return steps;
  }
  if (spec.intent === "open" && (src || dst)) {
    const p = src || dst;
    steps.push({ action: "tool", tool: "open_path", params: { path: p } });
    steps.push({ action: "finish", summary: `Opened ${p}`, success: true });
    return steps;
  }
  return [];
}

export { CONFIDENCE_GATE };
