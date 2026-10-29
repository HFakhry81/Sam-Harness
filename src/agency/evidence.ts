import * as fs from "fs";
import * as path from "path";
import type { EvidenceHit, EvidencePack } from "./types.js";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  "vendor",
]);

const INTERESTING = [
  { re: /occupancy_mode|session_capacity|RESOURCE_RENTAL|BATCH_SCHEDULE/i, note: "booking/occupancy signals" },
  { re: /workspace|tenant|multi-tenant|staff.?link/i, note: "tenant/workspace isolation signals" },
  { re: /check.?in|checkIn|qr|pass\.html|check_in_token/i, note: "QR/check-in signals" },
  { re: /invoice|payment|pricing_status|settled/i, note: "invoice/payment signals" },
  { re: /activity.?template|BookingType|opsStatus/i, note: "activity template / status machine signals" },
  { re: /rbac|permission|authorize|membership/i, note: "RBAC/auth signals" },
  { re: /migration|\.sql$/i, note: "schema/migration artifact" },
  {
    re: /controlplane|projectMemory|dailyOps|artifacts|taskSpec|runLessons|agent-memory|project-memory/i,
    note: "Control Plane / memory / ops signals",
  },
];

const CONTROL_PLANE_FORCE = [
  "src/controlplane/projectMemory.ts",
  "src/controlplane/dailyOps.ts",
  "src/controlplane/artifacts.ts",
  "src/controlplane/runLessons.ts",
  "src/controlplane/taskSpec.ts",
  "src/controlplane/server.ts",
  "src/controlplane/public/app.js",
  "src/controlplane/public/index.html",
  "agent-memory.md",
  "docs/AGENCY_OPS.md",
  "docs/AGENCY_PLATFORM_ROADMAP.md",
  "docs/WORKFLOW_REVIEW_LOOP.md",
];

function goalWantsControlPlaneEvidence(goal: string): boolean {
  return /project-memory|daily\s*ops|artifact|عارض|control\s*plane|ذاكر|ledger|صف(?:حة|ه)\s*الانتهاء|memor/i.test(
    goal || ""
  );
}

function walk(dir: string, out: string[], depth = 0): void {
  if (depth > 6 || out.length > 4000) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out, depth + 1);
    else out.push(full);
  }
}

/**
 * Cheap local evidence scout — no cloud cost.
 * Produces citable paths so Auditor cannot invent `src/models/*.ts` freely.
 * When `goal` targets Control Plane memory/UI, force-include those paths.
 */
export function scanRepoEvidence(
  targetRepo: string,
  opts?: { goal?: string }
): EvidencePack {
  const root = path.normalize(targetRepo);
  const hits: EvidenceHit[] = [];
  const scannedAt = new Date().toISOString();
  const goal = opts?.goal || "";

  if (!fs.existsSync(root)) {
    return {
      targetRepo: root,
      scannedAt,
      hits: [],
      summaryMarkdown: `# Evidence pack\n\nTarget missing: \`${root}\`\n`,
    };
  }

  if (goalWantsControlPlaneEvidence(goal)) {
    for (const rel of CONTROL_PLANE_FORCE) {
      const full = path.join(root, rel);
      if (fs.existsSync(full)) {
        hits.push({
          path: rel.replace(/\\/g, "/"),
          kind: "file",
          note: "goal-aware Control Plane evidence",
        });
      }
    }
  }

  // Prefer docs + top-level JS/TS/SQL
  const files: string[] = [];
  for (const sub of ["docs", "db", "src", "scripts", "."]) {
    const p = sub === "." ? root : path.join(root, sub);
    if (fs.existsSync(p)) walk(p, files);
  }

  const uniq = [...new Set(files)];
  for (const file of uniq) {
    const rel = path.relative(root, file).replace(/\\/g, "/");
    const base = path.basename(file);
    let matched = false;
    for (const rule of INTERESTING) {
      if (rule.re.test(rel) || rule.re.test(base)) {
        hits.push({ path: rel, kind: "file", note: rule.note });
        matched = true;
        break;
      }
    }
    if (matched) continue;
    // Content peek for key files only
    if (!/\.(js|ts|mjs|cjs|sql|md)$/i.test(file)) continue;
    if (rel.split("/").length > 4) continue;
    try {
      const sample = fs.readFileSync(file, "utf-8").slice(0, 4000);
      for (const rule of INTERESTING) {
        if (rule.re.test(sample)) {
          hits.push({ path: rel, kind: "file", note: rule.note + " (content)" });
          break;
        }
      }
    } catch {
      /* skip */
    }
    if (hits.length >= 80) break;
  }

  // Dedup by path
  const byPath = new Map<string, EvidenceHit>();
  for (const h of hits) {
    if (!byPath.has(h.path)) byPath.set(h.path, h);
  }
  const finalHits = [...byPath.values()].slice(0, 80);

  const summaryMarkdown = [
    `# Evidence pack (local scout)`,
    ``,
    `Target: \`${root}\``,
    `Scanned: ${scannedAt}`,
    `Hits: ${finalHits.length}`,
    ``,
    `Auditor MUST cite these paths (or mark "not found") — do not invent frameworks.`,
    ``,
    ...finalHits.map((h) => `- \`${h.path}\` — ${h.note}`),
    ``,
  ].join("\n");

  return {
    targetRepo: root,
    scannedAt,
    hits: finalHits,
    summaryMarkdown,
  };
}
