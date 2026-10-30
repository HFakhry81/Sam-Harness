import type { DocKind, SqlDriver } from "./types.js";

export function getDoc<T>(
  driver: SqlDriver,
  tenantId: string,
  kind: DocKind
): T | null {
  const row = driver
    .prepare("SELECT payload FROM kv_docs WHERE tenant_id = ? AND kind = ?")
    .get(tenantId, kind);
  if (!row?.payload) return null;
  try {
    return JSON.parse(String(row.payload)) as T;
  } catch {
    return null;
  }
}

export function setDoc(
  driver: SqlDriver,
  tenantId: string,
  kind: DocKind,
  payload: unknown
): void {
  const now = new Date().toISOString();
  const json = JSON.stringify(payload);
  driver
    .prepare(
      `INSERT INTO kv_docs (tenant_id, kind, payload, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(tenant_id, kind) DO UPDATE SET
         payload = excluded.payload,
         updated_at = excluded.updated_at`
    )
    .run(tenantId, kind, json, now);
}

export function deleteDoc(driver: SqlDriver, tenantId: string, kind: DocKind): void {
  driver
    .prepare("DELETE FROM kv_docs WHERE tenant_id = ? AND kind = ?")
    .run(tenantId, kind);
}

export function listDocKinds(driver: SqlDriver, tenantId: string): DocKind[] {
  return driver
    .prepare("SELECT kind FROM kv_docs WHERE tenant_id = ?")
    .all(tenantId)
    .map((r) => String(r.kind) as DocKind);
}
