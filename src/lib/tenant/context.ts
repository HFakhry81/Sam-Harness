/**
 * Multi-tenancy groundwork — workspace/client isolation without breaking
 * single-owner local use (default tenant = "local").
 */
import * as path from "path";
import { getOutputHome } from "../outputHome.js";

export const DEFAULT_TENANT_ID = "local";

export type TenantContext = {
  id: string;
  name: string;
  costCapUsd: number;
};

let activeTenantId: string = DEFAULT_TENANT_ID;

/** Resolve tenant from env / explicit arg. Empty → local. */
export function normalizeTenantId(raw?: string | null): string {
  const t = String(raw || process.env.SAM_TENANT_ID || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return t || DEFAULT_TENANT_ID;
}

export function getActiveTenantId(): string {
  return normalizeTenantId(activeTenantId);
}

export function setActiveTenantId(id: string): string {
  activeTenantId = normalizeTenantId(id);
  process.env.SAM_TENANT_ID = activeTenantId;
  return activeTenantId;
}

/**
 * Per-tenant output folder under SAM_OUTPUT_HOME.
 * Default tenant keeps the classic layout (no workspaces/ prefix) so
 * single-owner installs stay unchanged.
 */
export function tenantOutputHome(tenantId: string = getActiveTenantId()): string {
  const home = getOutputHome();
  const id = normalizeTenantId(tenantId);
  if (id === DEFAULT_TENANT_ID) return home;
  return path.normalize(path.join(home, "workspaces", id));
}

/** State DB / backups live under tenant output home. */
export function tenantStateDir(tenantId: string = getActiveTenantId()): string {
  return path.join(tenantOutputHome(tenantId), "state");
}

export function tenantDbPath(tenantId: string = getActiveTenantId()): string {
  return path.join(tenantStateDir(tenantId), "sam-harness.sqlite");
}

/** Map a harness cwd to a tenant id (env wins; else default). */
export function tenantIdForCwd(_cwd?: string): string {
  return getActiveTenantId();
}
