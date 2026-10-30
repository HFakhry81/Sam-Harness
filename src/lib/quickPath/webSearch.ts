/**
 * Pluggable web search + page fetch for the quick web-research path.
 * Default: DuckDuckGo HTML (no API key). Optional: Tavily / Brave / SearXNG via .env.
 */
import { appendAudit } from "../trust/auditLog.js";
import {
  getEffectiveTrustPolicy,
  type TrustPolicy,
} from "../trust/config.js";
import { requireNetworkEgressApproval } from "../trust/approvals.js";
import type { QuickPathSource } from "./types.js";

export type WebSearchProviderId = "duckduckgo" | "tavily" | "brave" | "searxng";

export type WebSearchHit = {
  title: string;
  url: string;
  snippet: string;
};

export type WebSearchResult = {
  provider: WebSearchProviderId;
  query: string;
  hits: WebSearchHit[];
  pages: Array<WebSearchHit & { text: string }>;
};

function providerFromEnv(): WebSearchProviderId {
  const raw = String(process.env.SAM_WEB_SEARCH_PROVIDER || "duckduckgo")
    .trim()
    .toLowerCase();
  if (raw === "tavily" || raw === "brave" || raw === "searxng" || raw === "duckduckgo") {
    return raw;
  }
  return "duckduckgo";
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(html: string): string {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
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

async function searchDuckDuckGo(query: string): Promise<WebSearchHit[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Sam-Harness/1.0 (+local; quick-path web research; respectful fetch)",
      Accept: "text/html",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);
  const html = await res.text();
  const hits: WebSearchHit[] = [];
  const re =
    /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && hits.length < 5) {
    let href = decodeHtml(m[1]);
    // DDG sometimes wraps redirects
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) {
      try {
        href = decodeURIComponent(uddg[1]);
      } catch {
        /* keep */
      }
    }
    if (!/^https?:\/\//i.test(href)) continue;
    const title = stripTags(m[2]).slice(0, 160);
    hits.push({ title: title || href, url: href, snippet: "" });
  }
  // Snippets
  const snipRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td|div)>/gi;
  let i = 0;
  while ((m = snipRe.exec(html)) && i < hits.length) {
    hits[i].snippet = stripTags(m[1]).slice(0, 280);
    i++;
  }
  return hits;
}

async function searchTavily(query: string): Promise<WebSearchHit[]> {
  const key = String(process.env.TAVILY_API_KEY || "").trim();
  if (!key) throw new Error("TAVILY_API_KEY missing");
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
      headers: { Accept: "application/json" },
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
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Sam-Harness/1.0 (+local; quick-path page fetch)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return "";
    const ctype = res.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml/i.test(ctype) && !ctype.includes("text/")) {
      return "";
    }
    const html = await res.text();
    return stripTags(html).slice(0, 4000);
  } catch {
    return "";
  }
}

export async function runWebSearch(input: {
  query: string;
  runId?: string;
  approved?: boolean | string;
  fetchPages?: boolean;
  maxPages?: number;
  /** Injected fetch/search for tests. */
  searchFn?: (query: string) => Promise<WebSearchHit[]>;
  fetchFn?: (url: string) => Promise<string>;
}): Promise<WebSearchResult> {
  assertNetworkEgressAllowed({
    purpose: `web_search:${input.query.slice(0, 80)}`,
    runId: input.runId,
    approved: input.approved,
  });

  const provider = providerFromEnv();
  let hits: WebSearchHit[];
  if (input.searchFn) {
    hits = await input.searchFn(input.query);
  } else if (provider === "tavily") {
    hits = await searchTavily(input.query);
  } else if (provider === "brave") {
    hits = await searchBrave(input.query);
  } else if (provider === "searxng") {
    hits = await searchSearxng(input.query);
  } else {
    hits = await searchDuckDuckGo(input.query);
  }

  const maxPages = Math.max(0, Math.min(input.maxPages ?? 3, 5));
  const pages: WebSearchResult["pages"] = [];
  if (input.fetchPages !== false && maxPages > 0) {
    const fetchFn = input.fetchFn || fetchPageText;
    for (const hit of hits.slice(0, maxPages)) {
      const text = await fetchFn(hit.url);
      pages.push({ ...hit, text: text || hit.snippet || "" });
    }
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
      },
    });
  } catch {
    /* ignore */
  }

  return { provider, query: input.query, hits, pages };
}

export function sourcesFromSearch(result: WebSearchResult): QuickPathSource[] {
  const fromPages = result.pages.map((p) => ({
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
