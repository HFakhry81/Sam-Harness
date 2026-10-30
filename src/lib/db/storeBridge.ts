/**
 * Bridge: repository-backed documents with one-time JSON file import per cwd/kind.
 */
import * as fs from "fs";
import * as path from "path";
import type { DocKind } from "./types.js";
import { getPersistence, loadDoc, saveDoc } from "./index.js";
import { tenantIdForCwd } from "../tenant/context.js";

export function loadStoreDoc<T>(
  cwd: string,
  kind: DocKind,
  fileName: string,
  empty: T
): T {
  getPersistence(); // ensure DB
  const tenantId = tenantIdForCwd(cwd);
  const fromDb = loadDoc<T>(kind, tenantId);
  if (fromDb != null) return fromDb;

  const p = path.join(cwd, fileName);
  try {
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as T;
      saveDoc(kind, raw, tenantId);
      return raw;
    }
  } catch {
    /* ignore corrupt */
  }
  return empty;
}

export function saveStoreDoc<T>(cwd: string, kind: DocKind, payload: T): void {
  getPersistence();
  const tenantId = tenantIdForCwd(cwd);
  saveDoc(kind, payload, tenantId);
}
