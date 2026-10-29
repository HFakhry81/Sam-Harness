export type CeoDecision =
  | { action: "tool"; tool: string; params: Record<string, unknown> }
  | { action: "finish"; summary: string; success: boolean };

export type OpsIntent =
  | "move"
  | "copy"
  | "create_excel"
  | "write_file"
  | "mkdir"
  | "delete"
  | "screenshot"
  | "open"
  | "unknown";

const FILE_EXT = String.raw`txt|md|json|xls|xlsx|csv|png|jpg|jpeg|mp4|mkv|pdf|docx|zip`;

export function extractGoalFocus(task: string): string {
  const goal =
    task.match(/## Goal\s*\n([\s\S]*?)(?=\n## |\n# |$)/i) ||
    task.match(/(?:^|\n)GOAL:\s*\n([\s\S]*?)(?=\n## |\n[A-Z][A-Z ]+:\s*\n|$)/i);
  if (goal) return goal[1].trim();
  return task.trim();
}

/** True when the user is forbidding delete (negation), not requesting it. */
export function hasDestructiveNegation(text: string): boolean {
  return /لا\s*تحذف|لا\s*تمسح|لا\s*تشيل|بدون\s*حذف|من\s*غير\s*حذف|don't\s+delete|do\s+not\s+delete|without\s+delet|never\s+delete/i.test(
    text
  );
}

/** Positive delete/remove intent (negation-aware). */
export function hasDeleteIntent(text: string): boolean {
  if (hasDestructiveNegation(text)) {
    // Creation/write with "don't delete anything else" is write, not delete
    if (/اكتب|أنشئ|انشئ|اعمل|create|write|ملف\s*نصي|new\s+file/i.test(text)) {
      return false;
    }
  }
  return /\b(delete|remove|unlink|rmdir|rm\b)\b|احذف|امسح|شيل الملف|حذف/i.test(text);
}

/**
 * Extract literal content the user asked to write into a file.
 * Returns null when only a datetime stamp / no explicit body.
 */
export function extractWriteFileContent(goal: string): string | null {
  const t = goal.trim();
  if (!t) return null;
  if (/وقت|تاريخ|datetime|time|date|الحالي/i.test(t) && !/محتو|يحتوي|سطر|content|نص/i.test(t)) {
    return null; // caller may inject locale datetime
  }
  const patterns = [
    /["«]([^"»]{2,200})["»]/,
    /content[:\s]+["']?([^"'\n]{2,200})["']?/i,
    /محتو(?:ى|اه)\s*(?:سطر\s*واحد\s*)?(?:فقط)?\s*[:：]\s*(.{2,200})/i,
    /يحتوي\s+(?:سطراً|سطرًا|سطر)?\s*(?:واحداً|واحدًا|واحد)?\s*(?:فقط)?\s*[:：]\s*(.{2,200})/i,
    /(?:اكتب|ضع)\s*(?:فيه|في(?:ه)?|به)?\s*[:：]?\s*["«]?(.{2,200}?)["»]?(?:\n|$)/i,
    /المحتوى\s*[:：]\s*(.{2,200})/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m?.[1]) {
      let body = m[1].trim();
      // Stop before trailing instructions / negation clauses
      body = body
        .split(/(?:\.?\s*)(?:لا\s*تحذف|لا\s*تمسح|don't\s+delete|do\s+not\s+delete|الهدف|ممنوع|بدون\s*تعديل)/i)[0]
        .trim()
        .replace(/[."""']+$/g, "")
        .trim();
      if (body.length >= 2 && !/^(فقط|فيه|في|به)$/i.test(body)) return body;
    }
  }
  return null;
}

/** Detect primary desktop intent — verbs beat file-type keywords. */
export function detectOpsIntent(goal: string): OpsIntent {
  const t = goal.trim();
  if (!t || t === "--") return "unknown";

  if (/screen\s*shot|screenshot|التقط|لقطة\s*شاشة|سكرين/i.test(t)) return "screenshot";

  // Destructive verbs — must win over generic "file" mentions (negation-aware)
  if (hasDeleteIntent(t)) {
    return "delete";
  }

  if (/\b(move|transfer)\b|انقل|ودّيه|وديه|انقلوا/i.test(t)) return "move";
  if (/\bcopy\b|انسخ|نسخ/i.test(t)) return "copy";

  if (
    /\bmkdir\b|create\s+(a\s+)?(folder|directory)|اعمل\s*مجلد|أنشئ\s*مجلد|انشئ\s*مجلد|مجلد جديد/i.test(
      t
    )
  ) {
    return "mkdir";
  }

  if (/play|شغل|افتح|open\b/i.test(t) && !/اعمل|انشئ|أنشئ|اكتب|create|write/i.test(t)) {
    return "open";
  }

  // Report/scan ABOUT excel files → write_file (or unknown), not create_excel
  const aboutExcelInventory =
    /تقرير|report|list_dir|امسح|scan|موجود|find|جرد|قائمة\s*ب?الملفات|على\s*المحرك/i.test(
      t
    ) && /excel|\.xls|\.xlsx|\.xlsm|جداول/i.test(t);

  // Create spreadsheet only when creating/writing a sheet — not inventory/report tasks
  if (
    !aboutExcelInventory &&
    (/excel|جدول|شيت/i.test(t) ||
      (/\.(xls|xlsx|csv)\b/i.test(t) && /اعمل|أنشئ|انشئ|اكتب|create|write|new /i.test(t)))
  ) {
    if (!/\b(move|copy|transfer|انقل|شيل|انسخ)\b/i.test(t)) return "create_excel";
  }

  if (/create|write|انشئ|أنشئ|اعمل|اكتب|ملف/i.test(t)) return "write_file";

  return "unknown";
}

function extractFilename(goal: string): string | null {
  const patterns = [
    new RegExp(String.raw`([\w.\- ]+\.(?:${FILE_EXT}))`, "i"),
    /الملف\s+([^\n]+?\.\w+)/i,
    /file\s+([^\n]+?\.\w+)/i,
  ];
  for (const re of patterns) {
    const m = goal.match(re);
    if (m?.[1]) return m[1].trim().replace(/["""']/g, "");
  }
  return null;
}

function extractDriveDest(goal: string): string | null {
  const m =
    goal.match(/(?:الى|إلي|الي|إلى|to)\s*(?:المحرك\s*)?([A-Za-z])\s*:/i) ||
    goal.match(/\b([A-Za-z]):\\?/i);
  // Prefer explicit "to drive X" — avoid matching drive in a source path first
  const toDrive = goal.match(
    /(?:من[\s\S]{0,40}?)?(?:الى|إلي|الي|إلى|to)\s*(?:المحرك\s*)?([A-Za-z])\s*:/i
  );
  if (toDrive) return `${toDrive[1].toUpperCase()}:\\`;
  if (/المحرك\s*([A-Za-z])/i.test(goal)) {
    const d = goal.match(/المحرك\s*([A-Za-z])/i)!;
    return `${d[1].toUpperCase()}:\\`;
  }
  return m ? `${m[1].toUpperCase()}:\\` : null;
}

function hasDesktop(goal: string): boolean {
  return /سطح المكتب|desktop/i.test(goal);
}

/**
 * Intent-first deterministic planner for desktop ops.
 */
export function heuristicPlan(task: string): CeoDecision[] {
  const focus = extractGoalFocus(task);
  const t = focus.trim();
  const intent = detectOpsIntent(t);
  const steps: CeoDecision[] = [];
  const filename = extractFilename(t);

  if (intent === "move" || intent === "copy") {
    const name = filename || "file.txt";
    const fromDesktop = hasDesktop(t) || /من\s*سطح/i.test(t);
    const destRoot = extractDriveDest(t);
    const source = fromDesktop ? `Desktop\\${name}` : name;
    const destination = destRoot ? `${destRoot}${name}` : `D:\\${name}`;
    steps.push({
      action: "tool",
      tool: intent === "copy" ? "copy_file" : "move_file",
      params: { source, destination },
    });
    steps.push({
      action: "finish",
      summary: `${intent === "copy" ? "Copied" : "Moved"} ${name} -> ${destination}`,
      success: true,
    });
    return steps;
  }

  if (intent === "delete") {
    const name = filename;
    const target = name
      ? hasDesktop(t)
        ? `Desktop${pathSep()}${name}`
        : name
      : extractPathish(t);
    // Never invent example paths (Desktop/old.txt) — empty plan → LLM or Spec clarify
    if (!target) return [];
    steps.push({
      action: "tool",
      tool: "delete_path",
      params: { path: target, confirm: true, recursive: /مجلد|folder|directory|recursive/i.test(t) },
    });
    steps.push({
      action: "finish",
      summary: `Deleted ${target}`,
      success: true,
    });
    return steps;
  }

  if (intent === "mkdir") {
    const folder =
      t.match(/(?:مجلد|folder|directory)\s+(?:باسم|named?|called)?\s*[:\s]*([^\n.]+)/i)?.[1]?.trim() ||
      t.match(/(?:باسم|بأسم)\s+([^\n.]+)/i)?.[1]?.trim() ||
      "NewFolder";
    const clean = folder.replace(/[<>:"|?*]/g, "-").trim();
    const dirPath = hasDesktop(t) ? `Desktop${pathSep()}${clean}` : clean;
    steps.push({ action: "tool", tool: "mkdir", params: { path: dirPath } });
    steps.push({
      action: "finish",
      summary: `Directory ready: ${dirPath}`,
      success: true,
    });
    return steps;
  }

  if (intent === "screenshot") {
    const named =
      t.match(/name\s*[:=]?\s*["']?\s*([^"'\n]+?)\s*["']?\s*$/i) ||
      t.match(/["']\s*([^"']+?)\s*["']/);
    const shotName = (named?.[1] || "screenshot").trim();
    steps.push({ action: "tool", tool: "screenshot", params: { filename: shotName } });
    steps.push({
      action: "finish",
      summary: `Screenshot saved to Desktop as ${shotName}`,
      success: true,
    });
    return steps;
  }

  if (intent === "create_excel") {
    const named =
      t.match(/(?:بأسم|باسم|اسم(?:ه|ها)?|named?|called|filename)\s*[:\s]*([^\n.]+?)(?=\s*\.|$|\s+و|\s+واكتب)/i) ||
      (filename ? [filename, filename.replace(/\.(xls|xlsx|csv)$/i, "")] : null) ||
      t.match(/(Sam-Harness[^\n.]*?(?:test|team)[^\n.]*)/i);
    let base = String(named?.[1] || named?.[0] || "Sam-Harness-sheet")
      .trim()
      .replace(/[<>:"/\\|?*]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
    if (!base) base = "Sam-Harness-sheet";
    if (!/\.(xls|xlsx|csv)$/i.test(base)) base = `${base}.xls`;
    const sheetPath = `Desktop\\${base}`;
    const stamp = new Date().toLocaleString();
    steps.push({
      action: "tool",
      tool: "write_excel",
      params: { path: sheetPath, a1: stamp },
    });
    steps.push({
      action: "finish",
      summary: `Excel created at ${sheetPath} with datetime in A1 (${stamp})`,
      success: true,
    });
    return steps;
  }

  if (intent === "open" && filename) {
    const p = hasDesktop(t) ? `Desktop\\${filename}` : filename;
    steps.push({ action: "tool", tool: "open_path", params: { path: p } });
    steps.push({ action: "finish", summary: `Opened ${p}`, success: true });
    return steps;
  }

  if (intent === "write_file") {
    // Inventory/report about existing files needs live tools — not a static write
    if (
      /تقرير|report|list_dir|امسح|scan|موجود|جرد|على\s*المحرك/i.test(t) &&
      /excel|\.xls|\.xlsx|جداول/i.test(t)
    ) {
      return [];
    }
    const name = filename || "sam-harness-output.txt";
    const pathName = hasDesktop(t) || !/^[A-Za-z]:\\/.test(name) ? `Desktop\\${name}` : name;
    const wantsNow = /وقت|تاريخ|datetime|time|date|الحالي/i.test(t);
    const extracted = extractWriteFileContent(t);
    const content = extracted
      ? extracted
      : wantsNow
        ? new Date().toLocaleString()
        : "Created by Sam-Harness";
    steps.push({
      action: "tool",
      tool: "write_file",
      params: { path: pathName, content },
    });
    steps.push({
      action: "finish",
      summary: `Wrote file ${pathName}`,
      success: true,
    });
    return steps;
  }

  return [];
}

function pathSep(): string {
  return process.platform === "win32" ? "\\" : "/";
}

function extractPathish(goal: string): string | null {
  const m =
    goal.match(/((?:Desktop|سطح المكتب|Documents|Downloads|[A-Za-z]:|~)[\\/][^\n]+)/i) ||
    goal.match(/([~/][^\s]+)/);
  return m?.[1]?.trim() || null;
}

/** True when heuristic is confident enough to skip the LLM. */
export function isHighConfidencePlan(plan: CeoDecision[]): boolean {
  if (!plan.length) return false;
  return plan.some(
    (d) =>
      d.action === "tool" &&
      [
        "screenshot",
        "write_excel",
        "write_file",
        "mkdir",
        "delete_path",
        "move_file",
        "copy_file",
        "open_path",
      ].includes(d.tool)
  );
}
