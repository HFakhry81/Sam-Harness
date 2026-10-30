/**
 * Minimal Markdown → HTML for Help export / UI (no extra deps).
 * Supports headings, lists, code fences, tables, links, bold/italic, mermaid fences.
 */

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineFormat(s: string): string {
  let out = escapeHtml(s);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  out = out.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2">$1</a>'
  );
  return out;
}

function renderTable(rows: string[]): string {
  if (rows.length < 2) return rows.map((r) => `<p>${inlineFormat(r)}</p>`).join("\n");
  const parseRow = (line: string) =>
    line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
  const header = parseRow(rows[0]);
  const bodyRows = rows.slice(2).filter((r) => /\|/.test(r));
  const thead = `<thead><tr>${header.map((h) => `<th>${inlineFormat(h)}</th>`).join("")}</tr></thead>`;
  const tbody = `<tbody>${bodyRows
    .map(
      (r) =>
        `<tr>${parseRow(r)
          .map((c) => `<td>${inlineFormat(c)}</td>`)
          .join("")}</tr>`
    )
    .join("")}</tbody>`;
  return `<table>${thead}${tbody}</table>`;
}

/** Convert Help markdown body to HTML fragment. */
export function markdownToHtml(md: string): string {
  const lines = String(md || "").replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  let inUl = false;
  let inOl = false;
  let inBq = false;

  const closeLists = () => {
    if (inUl) {
      out.push("</ul>");
      inUl = false;
    }
    if (inOl) {
      out.push("</ol>");
      inOl = false;
    }
  };
  const closeBq = () => {
    if (inBq) {
      out.push("</blockquote>");
      inBq = false;
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    // fenced code / mermaid
    if (/^```/.test(line)) {
      closeLists();
      closeBq();
      const lang = line.replace(/^```/, "").trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // closing fence
      const code = escapeHtml(buf.join("\n"));
      if (lang === "mermaid") {
        out.push(`<pre class="mermaid">${code}</pre>`);
      } else {
        out.push(
          `<pre class="code"><code class="language-${escapeHtml(lang || "text")}">${code}</code></pre>`
        );
      }
      continue;
    }

    // table block
    if (/^\|/.test(line) && i + 1 < lines.length && /^\|?\s*-+/.test(lines[i + 1])) {
      closeLists();
      closeBq();
      const rows: string[] = [];
      while (i < lines.length && /^\|/.test(lines[i])) {
        rows.push(lines[i]);
        i++;
      }
      out.push(renderTable(rows));
      continue;
    }

    if (!line.trim()) {
      closeLists();
      closeBq();
      i++;
      continue;
    }

    const hm = /^(#{1,4})\s+(.+)$/.exec(line);
    if (hm) {
      closeLists();
      closeBq();
      const level = hm[1].length;
      out.push(`<h${level}>${inlineFormat(hm[2])}</h${level}>`);
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      closeLists();
      if (!inBq) {
        out.push("<blockquote>");
        inBq = true;
      }
      out.push(`<p>${inlineFormat(line.replace(/^>\s?/, ""))}</p>`);
      i++;
      continue;
    } else {
      closeBq();
    }

    const ul = /^[-*]\s+(.+)$/.exec(line);
    if (ul) {
      if (inOl) {
        out.push("</ol>");
        inOl = false;
      }
      if (!inUl) {
        out.push("<ul>");
        inUl = true;
      }
      out.push(`<li>${inlineFormat(ul[1])}</li>`);
      i++;
      continue;
    }

    const ol = /^\d+\.\s+(.+)$/.exec(line);
    if (ol) {
      if (inUl) {
        out.push("</ul>");
        inUl = false;
      }
      if (!inOl) {
        out.push("<ol>");
        inOl = true;
      }
      out.push(`<li>${inlineFormat(ol[1])}</li>`);
      i++;
      continue;
    }

    closeLists();
    out.push(`<p>${inlineFormat(line)}</p>`);
    i++;
  }
  closeLists();
  closeBq();
  return out.join("\n");
}

export function helpShellCss(pdfReady: boolean): string {
  const pageBreak = pdfReady
    ? `
  .topic { page-break-before: always; }
  .topic:first-of-type { page-break-before: auto; }
  @media print {
    body { background: #fff; color: #111; }
    a { color: #000; text-decoration: underline; }
    nav { display: none; }
  }`
    : "";
  return `
:root {
  --bg: #0f1419;
  --fg: #e8eef4;
  --muted: #9aa8b5;
  --accent: #3d8bfd;
  --card: #182029;
  --border: #2a3642;
  --code: #121820;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  font-family: "Readex Pro", "Segoe UI", Tahoma, sans-serif;
  background: radial-gradient(1200px 600px at 10% -10%, #1a2a3a 0%, var(--bg) 55%);
  color: var(--fg);
  line-height: 1.65;
  padding: 1.5rem clamp(1rem, 4vw, 3rem) 3rem;
}
body[dir="rtl"] { font-family: "Readex Pro", "Noto Naskh Arabic", Tahoma, sans-serif; }
h1,h2,h3,h4 { font-family: Fraunces, Georgia, serif; font-weight: 650; line-height: 1.25; }
h1 { font-size: clamp(1.8rem, 3vw, 2.4rem); }
a { color: var(--accent); }
.wrap { max-width: 920px; margin: 0 auto; }
.brand { font-size: 0.85rem; letter-spacing: 0.04em; color: var(--muted); text-transform: uppercase; }
.lede { color: var(--muted); max-width: 62ch; }
nav.toc { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 1rem 1.25rem; margin: 1.5rem 0 2rem; }
nav.toc ol { margin: 0.5rem 0 0; padding-inline-start: 1.25rem; }
nav.toc a { text-decoration: none; }
.topic { margin: 2.5rem 0; padding-top: 0.5rem; border-top: 1px solid var(--border); }
.topic header .summary { color: var(--muted); }
pre.code, pre.mermaid {
  background: var(--code);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0.9rem 1rem;
  overflow-x: auto;
  font-family: "IBM Plex Mono", Consolas, monospace;
  font-size: 0.86rem;
}
code { font-family: "IBM Plex Mono", Consolas, monospace; font-size: 0.9em; }
table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 0.92rem; }
th, td { border: 1px solid var(--border); padding: 0.45rem 0.6rem; text-align: start; vertical-align: top; }
th { background: var(--card); }
blockquote { border-inline-start: 3px solid var(--accent); margin: 1rem 0; padding: 0.2rem 0.9rem; color: var(--muted); }
.badge { display: inline-block; font-size: 0.75rem; padding: 0.15rem 0.45rem; border-radius: 999px; border: 1px solid var(--border); color: var(--muted); }
.planned { color: #e6b85c; }
footer { margin-top: 3rem; color: var(--muted); font-size: 0.85rem; }
${pageBreak}
`.trim();
}

export function wrapHelpHtml(opts: {
  locale: "ar" | "en";
  title: string;
  bodyHtml: string;
  tocHtml?: string;
  pdfReady?: boolean;
  subtitle?: string;
}): string {
  const dir = opts.locale === "ar" ? "rtl" : "ltr";
  const lang = opts.locale === "ar" ? "ar" : "en";
  const css = helpShellCss(Boolean(opts.pdfReady));
  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(opts.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;650&family=IBM+Plex+Mono:wght@400;500&family=Readex+Pro:wght@400;500;600&display=swap" rel="stylesheet" />
  <style>${css}</style>
</head>
<body dir="${dir}">
  <div class="wrap">
    <p class="brand">Sam-Harness · Help</p>
    <h1>${escapeHtml(opts.title)}</h1>
    ${opts.subtitle ? `<p class="lede">${escapeHtml(opts.subtitle)}</p>` : ""}
    ${opts.tocHtml || ""}
    ${opts.bodyHtml}
    <footer>Grounded in current Sam-Harness source · planned items marked explicitly · ${opts.locale.toUpperCase()}</footer>
  </div>
  <script type="module">
    import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
    mermaid.initialize({ startOnLoad: true, theme: "dark", securityLevel: "strict" });
  </script>
</body>
</html>
`;
}
