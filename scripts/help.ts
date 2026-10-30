#!/usr/bin/env tsx
/**
 * CLI: pnpm run help [topic|query]
 * Examples:
 *   pnpm run help
 *   pnpm run help workflow
 *   pnpm run help --search "cost cap"
 *   pnpm run help --list
 *   pnpm run help --locale en hybrid-mode
 */
import "../src/lib/loadEnv.js";
import {
  answerHelpQuery,
  detectHelpIntent,
  formatHelpAnswerForCli,
  listHelpIndex,
  loadHelpDoc,
  normalizeHelpLocale,
  resolveTopicId,
  searchHelp,
  verifyHelpIntegrity,
} from "../src/lib/help/index.js";
import { loadLocaleConfig } from "../src/lib/i18n/index.js";

function printUsage(locale: "ar" | "en"): void {
  if (locale === "ar") {
    console.log(`استخدام: pnpm run help [موضوع|استعلام]
  --list              عرضّد المواضيع
  --search <كلمات>    ابحث في الوثائق
  --locale ar|en      لغة المساعدة
  --json              أخرج JSON
  --check             تحقق من سلامة الفهرس

أمثلة:
  pnpm run help
  pnpm run help workflow
  pnpm run help --search "سطح المكتب"
`);
  } else {
    console.log(`Usage: pnpm run help [topic|query]
  --list              list topics
  --search <words>    search docs
  --locale ar|en      help language
  --json              JSON output
  --check             verify index integrity

Examples:
  pnpm run help
  pnpm run help workflow
  pnpm run help --search "desktop"
`);
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  const cfg = loadLocaleConfig();
  let locale = normalizeHelpLocale(cfg.locale);
  let json = false;
  let list = false;
  let check = false;
  let searchQ: string | null = null;
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      printUsage(locale);
      return;
    }
    if (a === "--json") {
      json = true;
      continue;
    }
    if (a === "--list") {
      list = true;
      continue;
    }
    if (a === "--check") {
      check = true;
      continue;
    }
    if (a === "--locale" && argv[i + 1]) {
      locale = normalizeHelpLocale(argv[++i]);
      continue;
    }
    if (a === "--search" && argv[i + 1]) {
      searchQ = argv[++i];
      continue;
    }
    if (a.startsWith("--")) {
      console.error(`Unknown flag: ${a}`);
      process.exitCode = 2;
      return;
    }
    rest.push(a);
  }

  const cwd = process.cwd();

  if (check) {
    const result = verifyHelpIntegrity(cwd);
    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.ok) {
      console.log(`Help integrity OK — ${result.topics.length} topics × ar/en`);
    } else {
      console.error("Help integrity FAILED:");
      for (const issue of result.issues) {
        console.error(`  [${issue.locale}] ${issue.id || "—"}: ${issue.problem}`);
      }
      process.exitCode = 1;
    }
    return;
  }

  if (list) {
    const index = listHelpIndex(locale, cwd);
    if (json) {
      console.log(JSON.stringify({ ok: true, locale, topics: index }, null, 2));
      return;
    }
    console.log(locale === "ar" ? "مواضيع المساعدة:\n" : "Help topics:\n");
    for (const e of index) {
      console.log(`  ${e.id.padEnd(24)} ${e.title}`);
      console.log(`    ${e.summary}`);
    }
    return;
  }

  if (searchQ != null) {
    const hits = searchHelp({ query: searchQ, locale, cwd });
    if (json) {
      console.log(JSON.stringify({ ok: true, locale, query: searchQ, hits }, null, 2));
      return;
    }
    if (!hits.length) {
      console.log(locale === "ar" ? "لا نتائج." : "No hits.");
      return;
    }
    for (const h of hits) {
      console.log(`[${h.score}] ${h.id} — ${h.title}`);
      console.log(`    ${h.snippet}\n`);
    }
    return;
  }

  const query = rest.join(" ").trim() || "index";
  const topicId = resolveTopicId(query);
  if (topicId) {
    const doc = loadHelpDoc(topicId, locale, cwd);
    if (json) {
      console.log(JSON.stringify({ ok: true, locale, topic: doc }, null, 2));
      return;
    }
    console.log(`# ${doc.title}\n`);
    console.log(doc.body);
    return;
  }

  // Free-text / intent answer
  void detectHelpIntent(query);
  const answer = answerHelpQuery({ query, locale, cwd });
  if (json) {
    console.log(JSON.stringify(answer, null, 2));
    return;
  }
  console.log(formatHelpAnswerForCli(answer));
}

main();
