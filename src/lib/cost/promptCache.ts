/**
 * Phase 5 — exact prompt/response cache persisted in SQLite.
 * Also builds provider prompt-cache hints (OpenAI prompt_cache_key / Anthropic-style markers).
 */
import * as crypto from "crypto";
import { getDriver, getPersistence } from "../db/index.js";
import { getActiveTenantId } from "../tenant/context.js";
import { loadCostOptConfig, type CostOptConfig } from "./config.js";

export type CacheLookup = {
  hit: boolean;
  response?: string;
  key: string;
  cachedTokensSaved?: number;
};

export type ProviderCacheHints = {
  /** OpenAI-style routing key for automatic prompt caching. */
  promptCacheKey?: string;
  /** Anthropic-style ephemeral cache_control marker payload. */
  cacheControl?: { type: "ephemeral" };
  /** True when the caller should attach hints to the provider request. */
  enabled: boolean;
};

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/** Stable exact-match key: model + normalized prompt. */
export function buildCacheKey(model: string, prompt: string): string {
  const norm = String(prompt || "").replace(/\r\n/g, "\n");
  return sha256(`${String(model || "").trim()}\n${norm}`);
}

/**
 * Provider prompt-caching hints. Exact local cache is separate; these help
 * cloud providers reuse prefixes when SAM_PROVIDER_PROMPT_CACHE=1.
 */
export function buildProviderCacheHints(
  model: string,
  prompt: string,
  config?: CostOptConfig
): ProviderCacheHints {
  const cfg = config || loadCostOptConfig();
  if (!cfg.providerPromptCache) {
    return { enabled: false };
  }
  const promptCacheKey = sha256(`pc:${String(model || "").trim()}:${String(prompt || "").slice(0, 2048)}`);
  return {
    enabled: true,
    promptCacheKey,
    cacheControl: { type: "ephemeral" },
  };
}

function ensureTable(): void {
  getPersistence();
  getDriver().exec(`
CREATE TABLE IF NOT EXISTS prompt_cache (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  response TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_cache_tenant_key
  ON prompt_cache (tenant_id, cache_key);
CREATE INDEX IF NOT EXISTS idx_prompt_cache_expires
  ON prompt_cache (expires_at);
`);
}

function pruneExpired(tenantId: string, maxEntries: number): void {
  const driver = getDriver();
  const now = new Date().toISOString();
  driver
    .prepare("DELETE FROM prompt_cache WHERE tenant_id = ? AND expires_at < ?")
    .run(tenantId, now);

  const countRow = driver
    .prepare("SELECT COUNT(*) AS c FROM prompt_cache WHERE tenant_id = ?")
    .get(tenantId);
  const count = Number(countRow?.c || 0);
  if (count <= maxEntries) return;

  const overflow = count - maxEntries;
  const old = driver
    .prepare(
      `SELECT id FROM prompt_cache WHERE tenant_id = ?
       ORDER BY hit_count ASC, created_at ASC LIMIT ?`
    )
    .all(tenantId, overflow);
  const del = driver.prepare("DELETE FROM prompt_cache WHERE id = ?");
  for (const row of old) {
    del.run(String(row.id));
  }
}

export function getCachedResponse(
  model: string,
  prompt: string,
  opts?: { config?: CostOptConfig; tenantId?: string }
): CacheLookup {
  const cfg = opts?.config || loadCostOptConfig();
  const key = buildCacheKey(model, prompt);
  if (!cfg.cacheEnabled) {
    return { hit: false, key };
  }
  try {
    ensureTable();
    const tenantId = opts?.tenantId || getActiveTenantId();
    pruneExpired(tenantId, cfg.cacheMaxEntries);
    const row = getDriver()
      .prepare(
        `SELECT response, input_tokens, output_tokens, expires_at
         FROM prompt_cache WHERE tenant_id = ? AND cache_key = ?`
      )
      .get(tenantId, key);
    if (!row) return { hit: false, key };
    if (String(row.expires_at) < new Date().toISOString()) {
      getDriver()
        .prepare("DELETE FROM prompt_cache WHERE tenant_id = ? AND cache_key = ?")
        .run(tenantId, key);
      return { hit: false, key };
    }
    getDriver()
      .prepare(
        `UPDATE prompt_cache SET hit_count = hit_count + 1
         WHERE tenant_id = ? AND cache_key = ?`
      )
      .run(tenantId, key);
    return {
      hit: true,
      key,
      response: String(row.response || ""),
      cachedTokensSaved:
        Number(row.input_tokens || 0) + Number(row.output_tokens || 0),
    };
  } catch {
    return { hit: false, key };
  }
}

export function setCachedResponse(
  model: string,
  prompt: string,
  response: string,
  opts?: {
    config?: CostOptConfig;
    tenantId?: string;
    inputTokens?: number;
    outputTokens?: number;
  }
): { key: string; stored: boolean } {
  const cfg = opts?.config || loadCostOptConfig();
  const key = buildCacheKey(model, prompt);
  if (!cfg.cacheEnabled) {
    return { key, stored: false };
  }
  try {
    ensureTable();
    const tenantId = opts?.tenantId || getActiveTenantId();
    const now = new Date();
    const expires = new Date(now.getTime() + cfg.cacheTtlMs);
    const id = `pc-${crypto.randomBytes(6).toString("hex")}`;
    getDriver()
      .prepare(
        `INSERT INTO prompt_cache (
          id, tenant_id, cache_key, model, prompt_hash, response,
          input_tokens, output_tokens, created_at, expires_at, hit_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(tenant_id, cache_key) DO UPDATE SET
          response = excluded.response,
          model = excluded.model,
          input_tokens = excluded.input_tokens,
          output_tokens = excluded.output_tokens,
          created_at = excluded.created_at,
          expires_at = excluded.expires_at`
      )
      .run(
        id,
        tenantId,
        key,
        String(model || ""),
        key,
        String(response || ""),
        Math.max(0, Math.floor(opts?.inputTokens || 0)),
        Math.max(0, Math.floor(opts?.outputTokens || 0)),
        now.toISOString(),
        expires.toISOString()
      );
    pruneExpired(tenantId, cfg.cacheMaxEntries);
    return { key, stored: true };
  } catch {
    return { key, stored: false };
  }
}

/** Test / ops helper */
export function clearPromptCache(tenantId?: string): number {
  try {
    ensureTable();
    const tid = tenantId || getActiveTenantId();
    const r = getDriver()
      .prepare("DELETE FROM prompt_cache WHERE tenant_id = ?")
      .run(tid);
    return r.changes || 0;
  } catch {
    return 0;
  }
}

export function promptCacheStats(tenantId?: string): {
  entries: number;
  hits: number;
} {
  try {
    ensureTable();
    const tid = tenantId || getActiveTenantId();
    const row = getDriver()
      .prepare(
        `SELECT COUNT(*) AS c, COALESCE(SUM(hit_count), 0) AS h
         FROM prompt_cache WHERE tenant_id = ?`
      )
      .get(tid);
    return {
      entries: Number(row?.c || 0),
      hits: Number(row?.h || 0),
    };
  } catch {
    return { entries: 0, hits: 0 };
  }
}
