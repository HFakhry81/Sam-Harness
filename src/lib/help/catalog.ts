/**
 * Load Help markdown from docs/help/{locale}/ — source of truth for CLI, API, UI, export.
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { AppLocale } from "../i18n/types.js";
import { parseAppLocale } from "../i18n/config.js";
import {
  HELP_TOPICS,
  HELP_TOPIC_IDS,
  resolveTopicId,
  topicMeta,
  type HelpTopicId,
  type HelpTopicMeta,
} from "./topics.js";

export type HelpLocale = AppLocale;

export type HelpDoc = {
  id: HelpTopicId;
  locale: HelpLocale;
  title: string;
  summary: string;
  body: string;
  path: string;
  keywords: string[];
};

export type HelpIndexEntry = {
  id: HelpTopicId;
  title: string;
  summary: string;
  aliases: string[];
  keywords: string[];
  order: number;
};

function repoRootFromHere(): string {
  // src/lib/help → ../../../
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "..");
}

export function helpDocsRoot(cwd: string = repoRootFromHere()): string {
  return path.join(cwd, "docs", "help");
}

export function helpLocaleDir(locale: HelpLocale, cwd?: string): string {
  return path.join(helpDocsRoot(cwd), locale);
}

export function helpDocPath(
  id: HelpTopicId,
  locale: HelpLocale,
  cwd?: string
): string {
  return path.join(helpLocaleDir(locale, cwd), `${id}.md`);
}

/** Strip YAML-ish front matter if present; return body + optional title override. */
export function parseHelpMarkdown(raw: string): { title?: string; body: string } {
  const text = String(raw || "").replace(/^\uFEFF/, "");
  if (!text.startsWith("---")) return { body: text.trim() + "\n" };
  const end = text.indexOf("\n---", 3);
  if (end < 0) return { body: text.trim() + "\n" };
  const fm = text.slice(3, end).trim();
  const body = text.slice(end + 4).replace(/^\n/, "");
  let title: string | undefined;
  for (const line of fm.split("\n")) {
    const m = /^title:\s*(.+)$/i.exec(line.trim());
    if (m) title = m[1].replace(/^["']|["']$/g, "").trim();
  }
  return { title, body: body.trim() + "\n" };
}

export function loadHelpDoc(
  id: HelpTopicId,
  locale: HelpLocale = "ar",
  cwd?: string
): HelpDoc {
  const meta = topicMeta(id);
  if (!meta) throw new Error(`Unknown help topic: ${id}`);
  const file = helpDocPath(id, locale, cwd);
  if (!fs.existsSync(file)) {
    throw new Error(`Missing help doc: ${file}`);
  }
  const parsed = parseHelpMarkdown(fs.readFileSync(file, "utf-8"));
  const title =
    parsed.title || (locale === "ar" ? meta.titleAr : meta.titleEn);
  const summary = locale === "ar" ? meta.summaryAr : meta.summaryEn;
  return {
    id,
    locale,
    title,
    summary,
    body: parsed.body,
    path: file,
    keywords: meta.keywords,
  };
}

export function tryLoadHelpDoc(
  idOrAlias: string,
  locale: HelpLocale = "ar",
  cwd?: string
): HelpDoc | null {
  const id = resolveTopicId(idOrAlias);
  if (!id) return null;
  try {
    return loadHelpDoc(id, locale, cwd);
  } catch {
    return null;
  }
}

export function listHelpIndex(locale: HelpLocale = "ar", cwd?: string): HelpIndexEntry[] {
  // Touch files so integrity callers can rely on existence when listing.
  return HELP_TOPICS.map((meta) => {
    const file = helpDocPath(meta.id, locale, cwd);
    if (!fs.existsSync(file)) {
      throw new Error(`Missing help doc for index: ${file}`);
    }
    return {
      id: meta.id,
      title: locale === "ar" ? meta.titleAr : meta.titleEn,
      summary: locale === "ar" ? meta.summaryAr : meta.summaryEn,
      aliases: meta.aliases,
      keywords: meta.keywords,
      order: meta.order,
    };
  }).sort((a, b) => a.order - b.order);
}

export type HelpIntegrityIssue = {
  locale: HelpLocale;
  id?: string;
  problem: string;
};

/** Verify every catalog topic exists in both locales with non-empty body. */
export function verifyHelpIntegrity(cwd?: string): {
  ok: boolean;
  issues: HelpIntegrityIssue[];
  topics: HelpTopicId[];
} {
  const issues: HelpIntegrityIssue[] = [];
  for (const locale of ["ar", "en"] as HelpLocale[]) {
    const dir = helpLocaleDir(locale, cwd);
    if (!fs.existsSync(dir)) {
      issues.push({ locale, problem: `missing directory ${dir}` });
      continue;
    }
    const onDisk = new Set(
      fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".md"))
        .map((f) => f.replace(/\.md$/i, ""))
    );
    for (const id of HELP_TOPIC_IDS) {
      if (!onDisk.has(id)) {
        issues.push({ locale, id, problem: "missing markdown file" });
        continue;
      }
      try {
        const doc = loadHelpDoc(id, locale, cwd);
        if (!doc.body.trim()) {
          issues.push({ locale, id, problem: "empty body" });
        }
      } catch (e: any) {
        issues.push({ locale, id, problem: e?.message || String(e) });
      }
    }
    for (const extra of onDisk) {
      if (!HELP_TOPIC_IDS.includes(extra as HelpTopicId)) {
        issues.push({
          locale,
          id: extra,
          problem: "orphan markdown not in HELP_TOPICS catalog",
        });
      }
    }
  }
  return { ok: issues.length === 0, issues, topics: [...HELP_TOPIC_IDS] };
}

export function normalizeHelpLocale(raw?: string | null): HelpLocale {
  return parseAppLocale(raw || undefined);
}

export { HELP_TOPICS, HELP_TOPIC_IDS, resolveTopicId, topicMeta };
export type { HelpTopicId, HelpTopicMeta };
