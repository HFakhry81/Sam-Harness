/**
 * P8 — Hybrid client profiles: local / cloud / auto + daily cost cap.
 */
import * as fs from "fs";
import * as path from "path";

export type HybridMode = "local" | "cloud" | "auto";

export type HybridProfile = {
  mode: HybridMode;
  costCapUsd: number;
  costCapUsdPerDay?: number;
  notes?: string;
  note?: string;
  updatedAt: string;
  roles?: Partial<Record<string, HybridMode>>;
};

const FILE = "hybrid-profile.json";

const DEFAULT: HybridProfile = {
  mode: "auto",
  costCapUsd: 2,
  updatedAt: new Date().toISOString(),
  roles: {
    ceo_router: "local",
    evidence: "local",
    operator: "local",
    strategist: "auto",
    auditor: "auto",
    architect: "auto",
  },
};

export function loadHybridProfile(cwd: string): HybridProfile {
  const p = path.join(cwd, FILE);
  try {
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
      return {
        ...DEFAULT,
        ...raw,
        costCapUsd: Number(raw.costCapUsd ?? raw.costCapUsdPerDay ?? DEFAULT.costCapUsd),
      };
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT };
}

export function saveHybridProfile(
  cwd: string,
  patch: Partial<{ mode: HybridMode; costCapUsd: number; notes: string }>
): HybridProfile {
  const cur = loadHybridProfile(cwd);
  const next: HybridProfile = {
    ...cur,
    mode: patch.mode || cur.mode,
    costCapUsd: Math.max(0, Number(patch.costCapUsd ?? cur.costCapUsd) || 0),
    notes: patch.notes ?? cur.notes,
    updatedAt: new Date().toISOString(),
  };
  if (!["local", "cloud", "auto"].includes(next.mode)) {
    throw new Error("mode must be local | cloud | auto");
  }
  fs.writeFileSync(path.join(cwd, FILE), JSON.stringify(next, null, 2), "utf-8");
  return next;
}

export function cloudAllowedForRole(cwd: string, role: string): boolean {
  const p = loadHybridProfile(cwd);
  const mode = p.roles?.[role] || p.mode;
  if (mode === "local") return false;
  if (mode === "cloud") return true;
  return Boolean(process.env.OLLAMA_API_KEY || process.env.OPENAI_API_KEY);
}
