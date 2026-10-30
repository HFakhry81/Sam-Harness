/**
 * Pluggable web search + page fetch for the quick web-research path.
 * Default chain (no API key): DuckDuckGo HTML (POST) → DDG lite → Bing HTML → Wikipedia API.
 * Optional keyed: Tavily / Brave / SearXNG via .env.
 */
import { appendAudit } from "../trust/auditLog.js";
import {
  getEffectiveTrustPolicy,
  type TrustPolicy,
} from "../trust/config.js";
import { requireNetworkEgressApproval } from "../trust/approvals.js";
import type { QuickPathSource } from "./types.js";

export type WebSearchProviderId =
  | "duckduckgo"
  | "duckduckgo_lite"
  | "bing"
  | "wikipedia"
  | "tavily"
  | "brave"
  | "searxng"
  | "custom";

export type WebSearchHit = {
  title: string;
  url: string;
  snippet: string;
};

export type WebSearchAttempt = {
  provider: WebSearchProviderId;
  ok: boolean;
  hitCount: number;
  error?: string;
  ms: number;
};

export type WebSearchResult = {
  provider: WebSearchProviderId;
  query: string;
  hits: WebSearchHit[];
  pages: Array<WebSearchHit & { text: string }>;
  /** True when at least one page has usable body text. */
  usable: boolean;
  attempts: WebSearchAttempt[];
  failureReason?: string;
};

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const ACCEPT_HTML =
  "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

function preferredProvider(): WebSearchProviderId {
  const raw = String(process.env.SAM_WEB_SEARCH_PROVIDER || "duckduckgo")
    .trim()
    .toLowerCase();
  if (
    raw === "tavily" ||
    raw === "brave" ||
    raw === "searxng" ||
    raw === "duckduckgo" ||
    raw === "bing" ||
    raw === "wikipedia"
  ) {
    return raw as WebSearchProviderId;
  }
  return "duckduckgo";
}

export function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, " ");
}

export function stripTags(html: string): string {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** Unwrap DuckDuckGo redirect URLs (`uddg=` / `u=`). */
export function unwrapDuckRedirect(href: string): string {
  let out = decodeHtml(href).trim();
  if (out.startsWith("//")) out = `https:${out}`;
  try {
    const u = new URL(out, "https://duckduckgo.com");
    for (const key of ["uddg", "u", "url"]) {
      const v = u.searchParams.get(key);
      if (v) {
        try {
          return decodeURIComponent(v);
        } catch {
          return v;
        }
      }
    }
  } catch {
    /* keep */
  }
  const m = out.match(/[?&](?:uddg|u)=([^&]+)/i);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return m[1];
    }
  }
  return out;
}

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function dedupeHits(hits: WebSearchHit[]): WebSearchHit[] {
  const seen = new Set<string>();
  const out: WebSearchHit[] = [];
  for (const h of hits) {
    const key = h.url.replace(/\/$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}

/** Parse DuckDuckGo HTML (html.duckduckgo.com) result anchors. */
export function parseDuckDuckGoHtml(html: string): WebSearchHit[] {
  const hits: WebSearchHit[] = [];
  // class may appear before or after href
  const re =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>|<a[^>]*href="([^"]+)"[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && hits.length < 8) {
    const hrefRaw = m[1] || m[3] || "";
    const titleRaw = m[2] || m[4] || "";
    let href = unwrapDuckRedirect(hrefRaw);
    if (!isHttpUrl(href)) continue;
    if (/duckduckgo\.com\/(?:y\.js|l\/)/i.test(href)) continue;
    const title = stripTags(titleRaw).slice(0, 160);
    hits.push({ title: title || href, url: href, snippet: "" });
  }
  const snipRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td|div|span)>/gi;
  let i = 0;
  while ((m = snipRe.exec(html)) && i < hits.length) {
    hits[i].snippet = stripTags(m[1]).slice(0, 280);
    i++;
  }
  return dedupeHits(hits).slice(0, 5);
}

/** Parse DuckDuckGo lite HTML. */
export function parseDuckDuckGoLiteHtml(html: string): WebSearchHit[] {
  const hits: WebSearchHit[] = [];
  const re = /<a[^>]+rel="nofollow"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && hits.length < 8) {
    let href = unwrapDuckRedirect(m[1]);
    if (!isHttpUrl(href)) continue;
    if (/duckduckgo\.com/i.test(href)) continue;
    const title = stripTags(m[2]).slice(0, 160);
    if (!title || title.length < 2) continue;
    hits.push({ title, url: href, snippet: "" });
  }
  return dedupeHits(hits).slice(0, 5);
}

/** Parse Bing HTML organic results. */
export function parseBingHtml(html: string): WebSearchHit[] {
  const hits: WebSearchHit[] = [];
  const re =
    /<li[^>]*class="[^"]*b_algo[^"]*"[^>]*>[\s\S]*?<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && hits.length < 5) {
    const href = decodeHtml(m[1]).trim();
    if (!isHttpUrl(href)) continue;
    const title = stripTags(m[2]).slice(0, 160);
    hits.push({ title: title || href, url: href, snippet: "" });
  }
  return dedupeHits(hits);
}

/** Assert network egress is allowed by trust policy (+ optional HITL). */
export function assertNetworkEgressAllowed(opts: {
  purpose: string;
  runId?: string;
  approved?: boolean | string;
  policy?: TrustPolicy;
}): void {
  const policy = opts.policy || getEffectiveTrustPolicy();
  if (policy.allowNetworkEgress === false) {
    throw new Error(
      "Network egress is disabled by trust policy (SAM_ALLOW_NETWORK_EGRESS=0)."
    );
  }
  const decision = requireNetworkEgressApproval({
    purpose: opts.purpose,
    approved: opts.approved,
    runId: opts.runId,
  });
  if (!decision.ok) {
    throw new Error(
      decision.message ||
        "Network egress requires owner approval (SAM_TRUST_REQUIRE_NETWORK_APPROVAL)."
    );
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function fetchText(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<{ ok: boolean; status: number; text: string }> {
  const timeoutMs = init.timeoutMs ?? 12_000;
  const { timeoutMs: _t, ...rest } = init;
  const res = await fetch(url, {
    redirect: "follow",
    ...rest,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  attempts = 2
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i + 1 < attempts) await sleep(400 * (i + 1));
    }
  }
  throw last instanceof Error ? last : new Error(`${label} failed: ${String(last)}`);
}

async function searchDuckDuckGoHtml(query: string): Promise<WebSearchHit[]> {
  return withRetry("duckduckgo", async () => {
    const body = new URLSearchParams({ q: query, b: "", kl: "" });
    const res = await fetch("https://html.duckduckgo.com/html/", {
      method: "POST",
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: ACCEPT_HTML,
        "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://html.duckduckgo.com",
        Referer: "https://html.duckduckgo.com/",
      },
      body,
      redirect: "follow",
      signal: AbortSignal.timeout(14_000),
    });
    if (!res.ok) throw new Error(`DuckDuckGo HTML HTTP ${res.status}`);
    const html = await res.text();
    const hits = parseDuckDuckGoHtml(html);
    if (!hits.length) {
      // Some regions return a challenge / empty — treat as soft fail for fallback
      throw new Error("DuckDuckGo HTML returned 0 results");
    }
    return hits;
  });
}

async function searchDuckDuckGoLite(query: string): Promise<WebSearchHit[]> {
  return withRetry("duckduckgo_lite", async () => {
    const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
    const got = await fetchText(url, {
      method: "GET",
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: ACCEPT_HTML,
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://lite.duckduckgo.com/",
      },
      timeoutMs: 12_000,
    });
    if (!got.ok) throw new Error(`DuckDuckGo lite HTTP ${got.status}`);
    const hits = parseDuckDuckGoLiteHtml(got.text);
    if (!hits.length) throw new Error("DuckDuckGo lite returned 0 results");
    return hits;
  });
}

async function searchBingHtml(query: string): Promise<WebSearchHit[]> {
  return withRetry("bing", async () => {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en-US`;
    const got = await fetchText(url, {
      method: "GET",
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: ACCEPT_HTML,
        "Accept-Language": "en-US,en;q=0.9",
      },
      timeoutMs: 12_000,
    });
    if (!got.ok) throw new Error(`Bing HTML HTTP ${got.status}`);
    const hits = parseBingHtml(got.text);
    if (!hits.length) throw new Error("Bing HTML returned 0 results");
    return hits;
  });
}

async function searchWikipedia(query: string): Promise<WebSearchHit[]> {
  return withRetry("wikipedia", async () => {
    const api = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=5&namespace=0&format=json`;
    const got = await fetchText(api, {
      method: "GET",
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "application/json",
      },
      timeoutMs: 10_000,
    });
    if (!got.ok) throw new Error(`Wikipedia API HTTP ${got.status}`);
    const data = JSON.parse(got.text) as [string, string[], string[], string[]];
    const titles = data[1] || [];
    const descs = data[2] || [];
    const urls = data[3] || [];
    const hits: WebSearchHit[] = [];
    for (let i = 0; i < urls.length; i++) {
      if (!isHttpUrl(urls[i])) continue;
      hits.push({
        title: titles[i] || urls[i],
        url: urls[i],
        snippet: descs[i] || "",
      });
    }
    if (!hits.length) throw new Error("Wikipedia returned 0 results");
    return hits;
  });
}

async function searchTavily(query: string): Promise<WebSearchHit[]> {
  const key = String(process.env.TAVILY_API_KEY || "").trim();
  if (!key) throw new Error("TAVILY_API_KEY missing");
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": BROWSER_UA },
    body: JSON.stringify({
      api_key: key,
      query,
      max_results: 5,
      include_answer: false,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
  const data = (await res.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };
  return (data.results || [])
    .filter((r) => r.url)
    .map((r) => ({
      title: r.title || r.url || "",
      url: String(r.url),
      snippet: String(r.content || "").slice(0, 280),
    }));
}

async function searchBrave(query: string): Promise<WebSearchHit[]> {
  const key = String(process.env.BRAVE_API_KEY || "").trim();
  if (!key) throw new Error("BRAVE_API_KEY missing");
  const res = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
    {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": key,
        "User-Agent": BROWSER_UA,
      },
      signal: AbortSignal.timeout(15_000),
    }
  );
  if (!res.ok) throw new Error(`Brave HTTP ${res.status}`);
  const data = (await res.json()) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
  };
  return (data.web?.results || [])
    .filter((r) => r.url)
    .map((r) => ({
      title: r.title || r.url || "",
      url: String(r.url),
      snippet: String(r.description || "").slice(0, 280),
    }));
}

async function searchSearxng(query: string): Promise<WebSearchHit[]> {
  const base = String(process.env.SEARXNG_URL || "").trim().replace(/\/$/, "");
  if (!base) throw new Error("SEARXNG_URL missing");
  const res = await fetch(
    `${base}/search?q=${encodeURIComponent(query)}&format=json`,
    {
      headers: { Accept: "application/json", "User-Agent": BROWSER_UA },
      signal: AbortSignal.timeout(15_000),
    }
  );
  if (!res.ok) throw new Error(`SearXNG HTTP ${res.status}`);
  const data = (await res.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };
  return (data.results || [])
    .filter((r) => r.url)
    .slice(0, 5)
    .map((r) => ({
      title: r.title || r.url || "",
      url: String(r.url),
      snippet: String(r.content || "").slice(0, 280),
    }));
}

async function fetchPageText(url: string): Promise<string> {
  try {
    const got = await fetchText(url, {
      method: "GET",
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: ACCEPT_HTML,
        "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
      },
      timeoutMs: 10_000,
    });
    if (!got.ok) return "";
    return stripTags(got.text).slice(0, 4000);
  } catch {
    return "";
  }
}

/** Minimum characters of page body to count as usable evidence. */
export const MIN_USABLE_PAGE_CHARS = 80;

export function filterUsablePages(
  pages: Array<WebSearchHit & { text: string }>
): Array<WebSearchHit & { text: string }> {
  return pages.filter((p) => String(p.text || "").trim().length >= MIN_USABLE_PAGE_CHARS);
}

type SearchRunner = (query: string) => Promise<WebSearchHit[]>;

function buildFallbackChain(primary: WebSearchProviderId): Array<{
  id: WebSearchProviderId;
  run: SearchRunner;
}> {
  const keyed: Array<{ id: WebSearchProviderId; run: SearchRunner }> = [];
  if (primary === "tavily") keyed.push({ id: "tavily", run: searchTavily });
  if (primary === "brave") keyed.push({ id: "brave", run: searchBrave });
  if (primary === "searxng") keyed.push({ id: "searxng", run: searchSearxng });

  const free: Array<{ id: WebSearchProviderId; run: SearchRunner }> = [
    { id: "duckduckgo", run: searchDuckDuckGoHtml },
    { id: "duckduckgo_lite", run: searchDuckDuckGoLite },
    { id: "bing", run: searchBingHtml },
    { id: "wikipedia", run: searchWikipedia },
  ];

  if (primary === "bing") {
    return [
      { id: "bing", run: searchBingHtml },
      ...free.filter((f) => f.id !== "bing"),
    ];
  }
  if (primary === "wikipedia") {
    return [
      { id: "wikipedia", run: searchWikipedia },
      ...free.filter((f) => f.id !== "wikipedia"),
    ];
  }
  if (keyed.length) {
    return [...keyed, ...free];
  }
  // duckduckgo primary (default)
  return free;
}

export type WebSearchEvent = {
  type: "attempt" | "hits" | "pages" | "empty" | "error";
  message: string;
  detail?: Record<string, unknown>;
};

export async function runWebSearch(input: {
  query: string;
  runId?: string;
  approved?: boolean | string;
  fetchPages?: boolean;
  maxPages?: number;
  /** Injected fetch/search for tests. */
  searchFn?: (query: string) => Promise<WebSearchHit[]>;
  fetchFn?: (url: string) => Promise<string>;
  onEvent?: (ev: WebSearchEvent) => void;
}): Promise<WebSearchResult> {
  assertNetworkEgressAllowed({
    purpose: `web_search:${input.query.slice(0, 80)}`,
    runId: input.runId,
    approved: input.approved,
  });

  const emit = (ev: WebSearchEvent) => {
    try {
      input.onEvent?.(ev);
    } catch {
      /* ignore */
    }
  };

  const attempts: WebSearchAttempt[] = [];
  let hits: WebSearchHit[] = [];
  let provider: WebSearchProviderId = preferredProvider();

  if (input.searchFn) {
    const t0 = Date.now();
    try {
      hits = await input.searchFn(input.query);
      attempts.push({
        provider: "custom",
        ok: hits.length > 0,
        hitCount: hits.length,
        ms: Date.now() - t0,
        error: hits.length ? undefined : "injected search returned 0 results",
      });
      provider = "custom";
      emit({
        type: hits.length ? "hits" : "empty",
        message: `custom search hits=${hits.length}`,
        detail: { hitCount: hits.length },
      });
    } catch (e: any) {
      const err = e?.message || String(e);
      attempts.push({
        provider: "custom",
        ok: false,
        hitCount: 0,
        ms: Date.now() - t0,
        error: err,
      });
      emit({ type: "error", message: `custom search failed: ${err}` });
    }
  } else {
    const chain = buildFallbackChain(preferredProvider());
    for (const step of chain) {
      const t0 = Date.now();
      try {
        emit({
          type: "attempt",
          message: `trying provider=${step.id}`,
          detail: { provider: step.id },
        });
        const found = await step.run(input.query);
        attempts.push({
          provider: step.id,
          ok: found.length > 0,
          hitCount: found.length,
          ms: Date.now() - t0,
        });
        if (found.length) {
          hits = found;
          provider = step.id;
          emit({
            type: "hits",
            message: `${step.id} hits=${found.length}`,
            detail: { provider: step.id, hitCount: found.length },
          });
          break;
        }
      } catch (e: any) {
        const err = e?.message || String(e);
        attempts.push({
          provider: step.id,
          ok: false,
          hitCount: 0,
          ms: Date.now() - t0,
          error: err,
        });
        emit({
          type: "error",
          message: `${step.id} failed: ${err}`,
          detail: { provider: step.id, error: err },
        });
      }
    }
  }

  const maxPages = Math.max(0, Math.min(input.maxPages ?? 3, 5));
  const pages: WebSearchResult["pages"] = [];
  if (hits.length && input.fetchPages !== false && maxPages > 0) {
    const fetchFn = input.fetchFn || fetchPageText;
    for (const hit of hits.slice(0, maxPages)) {
      const text = await fetchFn(hit.url);
      pages.push({
        ...hit,
        text: String(text || "").trim() || String(hit.snippet || "").trim(),
      });
    }
    emit({
      type: "pages",
      message: `fetched pages=${pages.length}`,
      detail: {
        pageCount: pages.length,
        usableCount: filterUsablePages(pages).length,
      },
    });
  }

  const usablePages = filterUsablePages(pages);
  const usable = usablePages.length > 0;
  let failureReason: string | undefined;
  if (!hits.length) {
    failureReason =
      attempts
        .map((a) => `${a.provider}: ${a.error || (a.ok ? "ok" : "0 hits")}`)
        .join("; ") || "all search providers returned no results";
    emit({ type: "empty", message: `no search hits: ${failureReason}` });
  } else if (!usable) {
    failureReason = `search found ${hits.length} link(s) but no usable page text could be fetched`;
    emit({ type: "empty", message: failureReason });
  }

  try {
    appendAudit({
      category: "action",
      action: "quick_path.web_search",
      runId: input.runId,
      detail: {
        provider,
        query: input.query.slice(0, 200),
        hitCount: hits.length,
        pageCount: pages.length,
        usableCount: usablePages.length,
        usable,
        failureReason: failureReason || null,
        attempts,
      },
    });
  } catch {
    /* ignore */
  }

  return {
    provider,
    query: input.query,
    hits,
    pages: usable ? usablePages : pages,
    usable,
    attempts,
    failureReason,
  };
}

export function sourcesFromSearch(result: WebSearchResult): QuickPathSource[] {
  const usable = filterUsablePages(result.pages);
  const fromPages = (usable.length ? usable : result.pages).map((p) => ({
    title: p.title,
    url: p.url,
    snippet: p.snippet || p.text.slice(0, 160),
  }));
  if (fromPages.length) return fromPages;
  return result.hits.map((h) => ({
    title: h.title,
    url: h.url,
    snippet: h.snippet,
  }));
}
