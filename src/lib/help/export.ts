/**
 * Export Help as self-contained HTML, PDF-ready HTML, and Markdown bundle per locale.
 * Writes to SAM_OUTPUT_HOME/documents/help and dist/help.
 */
import * as fs from "fs";
import * as path from "path";
import { ensureOutputHome, getOutputHome } from "../outputHome.js";
import {
  HELP_TOPICS,
  loadHelpDoc,
  listHelpIndex,
  verifyHelpIntegrity,
  type HelpLocale,
} from "./catalog.js";
import { markdownToHtml, wrapHelpHtml } from "./render.js";

export type HelpExportResult = {
  ok: boolean;
  locale: HelpLocale;
  documentsDir: string;
  distDir: string;
  files: string[];
  integrityOk: boolean;
};

function writeFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf-8");
}

function buildBundleMarkdown(locale: HelpLocale, cwd?: string): string {
  const index = listHelpIndex(locale, cwd);
  const parts: string[] = [];
  parts.push(
    locale === "ar"
      ? `# حزمة مساعدة Sam-Harness\n\nمولَّدة من الكود والوثائق الحالية. العناصر المخططة مُعلَّمة صراحةً.\n`
      : `# Sam-Harness Help Bundle\n\nGenerated from current code and docs. Planned items are marked explicitly.\n`
  );
  parts.push(
    locale === "ar" ? `## المحتويات\n` : `## Contents\n`
  );
  for (const e of index) {
    parts.push(`- [${e.title}](#${e.id}) — ${e.summary}`);
  }
  parts.push("");
  for (const e of index) {
    const doc = loadHelpDoc(e.id, locale, cwd);
    parts.push(`\n\n---\n\n<a id="${e.id}"></a>\n\n# ${doc.title}\n\n${doc.body.trim()}\n`);
  }
  return parts.join("\n");
}

function buildCombinedHtml(
  locale: HelpLocale,
  opts: { pdfReady?: boolean; cwd?: string }
): string {
  const index = listHelpIndex(locale, opts.cwd);
  const tocItems = index
    .map((e) => `<li><a href="#${e.id}">${escape(e.title)}</a></li>`)
    .join("\n");
  const tocHtml = `<nav class="toc"><strong>${
    locale === "ar" ? "المحتويات" : "Contents"
  }</strong><ol>${tocItems}</ol></nav>`;

  const body = index
    .map((e) => {
      const doc = loadHelpDoc(e.id, locale, opts.cwd);
      const html = markdownToHtml(doc.body);
      return `<article class="topic" id="${e.id}">
  <header>
    <p class="badge">${e.id}</p>
    <h1>${escape(doc.title)}</h1>
    <p class="summary">${escape(doc.summary)}</p>
  </header>
  ${html}
</article>`;
    })
    .join("\n");

  const title =
    locale === "ar" ? "مساعدة Sam-Harness" : "Sam-Harness Help";
  const subtitle =
    locale === "ar"
      ? "دليل الوكالة مبني على الكود الفعلي — للاستخدام كملف تعريف / مقدمة."
      : "Agency guide grounded in actual code — usable as a profile / intro pack.";

  return wrapHelpHtml({
    locale,
    title,
    subtitle,
    tocHtml,
    bodyHtml: body,
    pdfReady: opts.pdfReady,
  });
}

function escape(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function exportHelpLocale(opts: {
  locale: HelpLocale;
  cwd?: string;
  /** Override SAM_OUTPUT_HOME documents target */
  documentsHelpDir?: string;
  distHelpDir?: string;
}): HelpExportResult {
  const cwd = opts.cwd || process.cwd();
  const integrity = verifyHelpIntegrity(cwd);
  const layout = ensureOutputHome(getOutputHome());
  const documentsDir =
    opts.documentsHelpDir || path.join(layout.documents, "help", opts.locale);
  const distDir =
    opts.distHelpDir || path.join(cwd, "dist", "help", opts.locale);

  fs.mkdirSync(documentsDir, { recursive: true });
  fs.mkdirSync(distDir, { recursive: true });

  const files: string[] = [];

  // Per-topic markdown copies
  for (const meta of HELP_TOPICS) {
    const doc = loadHelpDoc(meta.id, opts.locale, cwd);
    const name = `${meta.id}.md`;
    writeFile(path.join(documentsDir, name), `# ${doc.title}\n\n${doc.body}`);
    writeFile(path.join(distDir, name), `# ${doc.title}\n\n${doc.body}`);
    files.push(name);
  }

  const bundleMd = buildBundleMarkdown(opts.locale, cwd);
  writeFile(path.join(documentsDir, "HELP_BUNDLE.md"), bundleMd);
  writeFile(path.join(distDir, "HELP_BUNDLE.md"), bundleMd);
  files.push("HELP_BUNDLE.md");

  const html = buildCombinedHtml(opts.locale, { cwd, pdfReady: false });
  writeFile(path.join(documentsDir, "index.html"), html);
  writeFile(path.join(distDir, "index.html"), html);
  files.push("index.html");

  const pdfHtml = buildCombinedHtml(opts.locale, { cwd, pdfReady: true });
  writeFile(path.join(documentsDir, "HELP_PRINT.html"), pdfHtml);
  writeFile(path.join(distDir, "HELP_PRINT.html"), pdfHtml);
  files.push("HELP_PRINT.html");

  // Manifest for agency profile / intro use
  const manifest = {
    product: "Sam-Harness",
    kind: "help-export",
    locale: opts.locale,
    generatedAt: new Date().toISOString(),
    topics: HELP_TOPICS.map((t) => t.id),
    integrityOk: integrity.ok,
    files,
  };
  writeFile(
    path.join(documentsDir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n"
  );
  writeFile(
    path.join(distDir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n"
  );
  files.push("manifest.json");

  return {
    ok: integrity.ok,
    locale: opts.locale,
    documentsDir,
    distDir,
    files,
    integrityOk: integrity.ok,
  };
}

export function exportAllHelp(opts?: {
  cwd?: string;
  locales?: HelpLocale[];
}): HelpExportResult[] {
  const locales = opts?.locales || (["ar", "en"] as HelpLocale[]);
  return locales.map((locale) =>
    exportHelpLocale({ locale, cwd: opts?.cwd })
  );
}
