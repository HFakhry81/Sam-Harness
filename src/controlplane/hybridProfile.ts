/**
 * P8 — Hybrid client profiles: local / cloud / auto + daily cost cap.
 * Persisted in embedded DB (legacy hybrid-profile.json imported once).
 */
import { loadStoreDoc, saveStoreDoc } from "../lib/db/storeBridge.js";
import { getDriver, getPersistence } from "../lib/db/index.js";
import { tenantIdForCwd } from "../lib/tenant/context.js";

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

/** Minimum practical non-zero daily cloud budget. $0 still means forbid cloud. */
export const DEFAULT_COST_CAP_USD = 0.5;

const DEFAULT: HybridProfile = {
  mode: "auto",
  costCapUsd: DEFAULT_COST_CAP_USD,
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
  const raw = loadStoreDoc<Partial<HybridProfile>>(cwd, "hybrid-profile", FILE, {
    ...DEFAULT,
  });
  return {
    ...DEFAULT,
    ...raw,
    costCapUsd: Number(raw.costCapUsd ?? raw.costCapUsdPerDay ?? DEFAULT.costCapUsd),
  };
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
  saveStoreDoc(cwd, "hybrid-profile", next);
  // Keep tenants.cost_cap_usd in sync for multi-tenant queries
  try {
    getPersistence();
    const tid = tenantIdForCwd(cwd);
    getDriver()
      .prepare("UPDATE tenants SET cost_cap_usd = ?, updated_at = ? WHERE id = ?")
      .run(next.costCapUsd, next.updatedAt, tid);
  } catch {
    /* DB optional during early boot */
  }
  return next;
}

export function cloudAllowedForRole(cwd: string, role: string): boolean {
  const p = loadHybridProfile(cwd);
  const mode = p.roles?.[role] || p.mode;
  if (mode === "local") return false;
  if (mode === "cloud") return true;
  return Boolean(process.env.OLLAMA_API_KEY || process.env.OPENAI_API_KEY);
}
