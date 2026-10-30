/**
 * Safe listing / reading / OS-open of Control Plane run outputs.
 */
import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { getOutputLayout } from "../lib/outputHome.js";

export type ArtifactKind = "report" | "plan" | "evidence" | "delivery" | "pack" | "log" | "other";

export type ArtifactItem = {
  id: string;
  label: string;
  relPath: string;
  absPath: string;
  kind: ArtifactKind;
  bytes: number;
  mtime: string;
};

const ROOT_FILES: Array<{ name: string; label: string; kind: ArtifactKind }> = [
  { name: "final-report.md", label: "التقرير النهائي", kind: "report" },
  { name: "execution-result.md", label: "نتيجة التنفيذ", kind: "log" },
  { name: "DELIVERY_BOARD.md", label: "لوحة التسليم", kind: "delivery" },
  { name: "evidence-pack.md", label: "حزمة الأدلة", kind: "evidence" },
  { name: "execution-plan.md", label: "خطة التنفيذ", kind: "plan" },
  { name: "ceo-draft.md", label: "مسودة الاستراتيجية", kind: "plan" },
  { name: "audit-report.md", label: "تقرير التدقيق", kind: "report" },
  { name: "help-system-spec.md", label: "مواصفة المساعدة", kind: "other" },
  { name: "marketing-campaign.md", label: "الحملة التسويقية", kind: "other" },
  { name: "CODE_VS_PLAN_GAP_MATRIX.md", label: "فجوات الكود/الخطة", kind: "plan" },
  { name: "IMPLEMENTATION_BACKLOG.md", label: "Backlog التنفيذ", kind: "plan" },
  { name: "PACK_HANDOFF.md", label: "تسليم الحزمة", kind: "pack" },
  { name: "controlplane-session.md", label: "سجل الجلسة", kind: "log" },
];

const TEXT_EXT = new Set([
  ".md",
  ".txt",
  ".json",
  ".js",
  ".ts",
  ".css",
  ".html",
  ".yml",
  ".yaml",
  ".log",
]);

function kindFromName(name: string): ArtifactKind {
  const n = name.toLowerCase();
  if (/audit|final-report|report/.test(n)) return "report";
  if (/evidence/.test(n)) return "evidence";
  if (/delivery|go-nogo|ticket/.test(n)) return "delivery";
  if (/plan|strategy|backlog|gap|next_sprint/.test(n)) return "plan";
  if (/pack|handoff/.test(n)) return "pack";
  if (/execution-result|session|log/.test(n)) return "log";
  return "other";
}

function labelFromName(name: string): string {
  const known = ROOT_FILES.find((f) => f.name.toLowerCase() === name.toLowerCase());
  if (known) return known.label;
  return name;
}

function toItem(root: string, abs: string): ArtifactItem | null {
  try {
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
    const st = fs.statSync(abs);
    let rel = path.relative(root, abs).replace(/\\/g, "/");
    // Packs under SAM_OUTPUT_HOME may sit outside project root — keep absolute-safe id
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      rel = abs.replace(/\\/g, "/");
    }
    const base = path.basename(abs);
    const known = ROOT_FILES.find((f) => f.name.toLowerCase() === base.toLowerCase());
    return {
      id: rel,
      label: labelFromName(base),
      relPath: rel,
      absPath: abs,
      kind: known?.kind || kindFromName(base),
      bytes: st.size,
      mtime: st.mtime.toISOString(),
    };
  } catch {
    return null;
  }
}

function newestPackUnder(parent: string): string | null {
  if (!fs.existsSync(parent)) return null;
  const dirs = fs
    .readdirSync(parent, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^Sam-Harness no\.\d+/i.test(d.name))
    .map((d) => {
      const full = path.join(parent, d.name);
      return { full, mtime: fs.statSync(full).mtimeMs, name: d.name };
    })
    .sort((a, b) => b.mtime - a.mtime);
  return dirs[0]?.full || null;
}

/** Newest Sam-Harness no.X under output reports/ or project docs/. */
export function findLatestPackDir(root: string): string | null {
  const fromOutput = newestPackUnder(getOutputLayout().reports);
  if (fromOutput) return fromOutput;
  return newestPackUnder(path.join(root, "docs"));
}

function listFilesRecursive(dir: string, max = 40): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    if (out.length >= max) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= max) break;
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        walk(full);
      } else if (e.isFile()) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

export function listRunArtifacts(root: string): {
  items: ArtifactItem[];
  packDir: string | null;
} {
  const seenRel = new Set<string>();
  const seenBase = new Set<string>();
  const items: ArtifactItem[] = [];

  const push = (abs: string, skipIfBaseSeen = false) => {
    const item = toItem(root, abs);
    if (!item || seenRel.has(item.relPath)) return;
    const baseKey = path.basename(item.relPath).toLowerCase();
    // Prefer pack copy over root twin of the same filename
    if (skipIfBaseSeen && seenBase.has(baseKey)) return;
    seenBase.add(baseKey);
    seenRel.add(item.relPath);
    items.push(item);
  };

  const packDir = findLatestPackDir(root);
  if (packDir) {
    for (const f of listFilesRecursive(packDir, 50)) {
      push(f, false);
    }
  }

  for (const f of ROOT_FILES) {
    push(path.join(root, f.name), true);
  }

  // review-loop top files (skip if already covered via pack)
  const loop = path.join(root, "review-loop");
  if (fs.existsSync(loop)) {
    try {
      const versions = fs
        .readdirSync(loop)
        .filter((n) => /^strategy-v\d+\.md$/i.test(n) || /^audit-v\d+\.md$/i.test(n) || /^LOOP_SUMMARY\.md$/i.test(n))
        .map((n) => path.join(loop, n));
      versions.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
      versions.slice(0, 6).forEach((f) => push(f, true));
    } catch {
      /* ignore */
    }
  }

  // Highlight order: reports/plans first, then by mtime
  const kindRank: Record<ArtifactKind, number> = {
    report: 0,
    delivery: 1,
    pack: 2,
    evidence: 3,
    plan: 4,
    log: 5,
    other: 6,
  };
  items.sort((a, b) => {
    const kr = kindRank[a.kind] - kindRank[b.kind];
    if (kr !== 0) return kr;
    return b.mtime.localeCompare(a.mtime);
  });
  let packRel: string | null = null;
  if (packDir) {
    const rel = path.relative(root, packDir).replace(/\\/g, "/");
    packRel = rel.startsWith("..") || path.isAbsolute(rel) ? packDir.replace(/\\/g, "/") : rel;
  }
  return { items, packDir: packRel };
}

function assertUnderRoot(root: string, relPath: string): string {
  const cleaned = String(relPath || "")
    .replace(/\/+$/, "")
    .replace(/\0/g, "");
  if (!cleaned || cleaned.includes("..")) {
    throw new Error("مسار غير مسموح");
  }
  // Absolute paths under output home (packs outside project cwd)
  if (path.isAbsolute(cleaned) || /^[A-Za-z]:[\\/]/.test(cleaned)) {
    const abs = path.normalize(cleaned);
    const roots = [path.normalize(root), path.normalize(getOutputLayout().home)];
    const ok = roots.some((r) => {
      const rn = r.toLowerCase() + path.sep;
      return abs.toLowerCase() === r.toLowerCase() || abs.toLowerCase().startsWith(rn);
    });
    if (!ok) throw new Error("خارج جذر المشروع / مجلد المخرجات");
    return abs;
  }
  const abs = path.normalize(path.join(root, cleaned.replace(/^[/\\]+/, "")));
  const rootNorm = path.normalize(root) + path.sep;
  if (abs !== path.normalize(root) && !abs.toLowerCase().startsWith(rootNorm.toLowerCase())) {
    throw new Error("خارج جذر المشروع");
  }
  return abs;
}

/** Resolve a relative path under project root only (file). */
export function resolveArtifactPath(root: string, relPath: string): string {
  const abs = assertUnderRoot(root, relPath);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    throw new Error("الملف غير موجود");
  }
  return abs;
}

/** Resolve a relative directory under project root (or the root itself via "."). */
export function resolveArtifactDir(root: string, relPath: string): string {
  if (!relPath || relPath === "." || relPath === "./") {
    return path.normalize(root);
  }
  const abs = assertUnderRoot(root, relPath);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    throw new Error("المجلد غير موجود");
  }
  return abs;
}

export function readArtifactText(
  root: string,
  relPath: string,
  maxChars = 200_000
): { relPath: string; content: string; truncated: boolean; bytes: number } {
  const abs = resolveArtifactPath(root, relPath);
  const ext = path.extname(abs).toLowerCase();
  if (!TEXT_EXT.has(ext)) {
    throw new Error("نوع الملف غير قابل للعرض كنص — استخدم فتح في النظام");
  }
  const buf = fs.readFileSync(abs);
  const text = buf.toString("utf-8");
  const truncated = text.length > maxChars;
  return {
    relPath: path.relative(root, abs).replace(/\\/g, "/"),
    content: truncated ? text.slice(0, maxChars) + "\n\n…(truncated)" : text,
    truncated,
    bytes: buf.length,
  };
}

function spawnOpen(target: string, asFolder: boolean): void {
  if (process.platform === "win32") {
    if (asFolder) {
      spawn("explorer", [target], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("cmd", ["/c", "start", "", target], { detached: true, stdio: "ignore" }).unref();
    }
  } else if (process.platform === "darwin") {
    spawn("open", asFolder ? [target] : [target], {
      detached: true,
      stdio: "ignore",
    }).unref();
  } else {
    spawn("xdg-open", [target], { detached: true, stdio: "ignore" }).unref();
  }
}

/** Open file or its parent folder in the OS shell (Windows Explorer / default app). */
export function openArtifactInOs(
  root: string,
  relPath: string,
  mode: "file" | "folder" | "dir" = "file"
): { ok: true; absPath: string } {
  if (mode === "dir") {
    const abs = resolveArtifactDir(root, relPath);
    spawnOpen(abs, true);
    return { ok: true, absPath: abs };
  }
  const abs = resolveArtifactPath(root, relPath);
  const target = mode === "folder" ? path.dirname(abs) : abs;
  spawnOpen(target, mode === "folder");
  return { ok: true, absPath: abs };
}

export function artifactNamesForSession(root: string): string[] {
  const { items, packDir } = listRunArtifacts(root);
  const names = items.slice(0, 12).map((i) => i.relPath);
  if (packDir && !names.some((n) => n.startsWith(packDir))) {
    names.unshift(packDir + "/");
  }
  return names;
}
