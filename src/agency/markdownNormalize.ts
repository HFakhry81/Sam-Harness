/**
 * Structural markdown cleanup after claim sentence/line deletion.
 * Drops empty bullets, renumbers ordered lists, removes empty headings,
 * and never leaves trailing colons with nothing under them.
 * English/ASCII only — no placeholders.
 */

function isHeading(line: string): boolean {
  return /^#{1,6}\s+\S/.test(line);
}

function headingLevel(line: string): number {
  const m = line.match(/^(#{1,6})\s+/);
  return m ? m[1].length : 0;
}

function isEmptyBullet(line: string): boolean {
  // "- " / "* " / "+ " with optional trailing colon and nothing else
  return /^\s*[-*+]\s*:?\s*$/.test(line);
}

function isEmptyOrderedItem(line: string): boolean {
  return /^\s*\d+[.)]\s*:?\s*$/.test(line);
}

/** Label-only lines that end with a colon and have no content (e.g. "Verification:"). */
function isTrailingColonHole(line: string): boolean {
  const t = line.trim();
  if (!t || isHeading(t)) return false;
  if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
    // bullet/number with only a label colon: "- Missing Critical Dependencies:"
    return /^\s*(?:[-*+]|\d+[.)])\s+[^:\n]{1,80}:\s*$/.test(line);
  }
  // Bare "Verification:" / "Current State vs. Gaps:"
  return /^[A-Za-z][^:\n]{0,80}:\s*$/.test(t);
}

function isBlank(line: string): boolean {
  return /^\s*$/.test(line);
}

function sectionBodyEmpty(lines: string[], startIdx: number): boolean {
  const level = headingLevel(lines[startIdx] || "");
  let i = startIdx + 1;
  let sawContent = false;
  while (i < lines.length) {
    const line = lines[i];
    if (isHeading(line) && headingLevel(line) <= level) break;
    if (!isBlank(line) && !isEmptyBullet(line) && !isEmptyOrderedItem(line) && !isTrailingColonHole(line)) {
      sawContent = true;
      break;
    }
    i += 1;
  }
  return !sawContent;
}

/**
 * Renumber contiguous ordered-list blocks to 1..N (fixes skips like 2,4,6).
 */
function renumberOrderedLists(lines: string[]): string[] {
  const out: string[] = [];
  let n = 0;
  let inList = false;
  for (const line of lines) {
    const m = line.match(/^(\s*)(\d+)([.)])(\s+)(.*)$/);
    if (m) {
      if (!inList) {
        inList = true;
        n = 0;
      }
      n += 1;
      out.push(`${m[1]}${n}${m[3]}${m[4]}${m[5]}`);
      continue;
    }
    // Blank lines inside a list keep the block open; other content ends it
    if (inList && isBlank(line)) {
      out.push(line);
      continue;
    }
    inList = false;
    n = 0;
    out.push(line);
  }
  return out;
}

function isTableRow(line: string): boolean {
  return /^\s*\|.+\|\s*$/.test(line) || /^\s*\|.+\|\s*$/.test(line.trim());
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

/** True when every cell is empty / placeholder (trailing pipes, blank cells). */
function isEmptyTableRow(line: string): boolean {
  if (!isTableRow(line) || isTableSeparator(line)) return false;
  const cells = line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
  if (!cells.length) return true;
  return cells.every((c) => !c || c === "-" || c === "—" || c === "–");
}

/**
 * Drop empty table rows, trailing empty cells, and tables that are only
 * header + separator (or header + empty body).
 */
function normalizeTables(lines: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!isTableRow(line) && !isTableSeparator(line)) {
      out.push(line);
      i += 1;
      continue;
    }
    // Collect contiguous table block
    const block: string[] = [];
    while (
      i < lines.length &&
      (isTableRow(lines[i]) || isTableSeparator(lines[i]) || isBlank(lines[i]))
    ) {
      if (isBlank(lines[i])) {
        // Blank ends the table unless next line continues it
        if (
          i + 1 < lines.length &&
          (isTableRow(lines[i + 1]) || isTableSeparator(lines[i + 1]))
        ) {
          i += 1;
          continue;
        }
        break;
      }
      block.push(lines[i]);
      i += 1;
    }
    // Strip trailing empty cells: `| a | b |  |` → `| a | b |`
    const cleaned = block
      .map((row) => {
        if (isTableSeparator(row)) return row.replace(/\|\s*$/, "|").replace(/^\s*/, "");
        const parts = row.trim().split("|");
        // split("| a | b |") → ["", " a ", " b ", ""]
        while (parts.length && !String(parts[parts.length - 1]).trim()) {
          parts.pop();
        }
        while (parts.length && !String(parts[0]).trim()) {
          parts.shift();
        }
        if (!parts.length) return "";
        return `| ${parts.map((p) => p.trim()).join(" | ")} |`;
      })
      .filter((row) => row && !isEmptyTableRow(row));

    // Drop table that is only header + separator (no body) or separator alone
    const bodyRows = cleaned.filter((r) => !isTableSeparator(r));
    const hasSep = cleaned.some((r) => isTableSeparator(r));
    if (bodyRows.length === 0) {
      continue; // empty table — drop entirely
    }
    if (bodyRows.length === 1 && hasSep) {
      // header + sep only, no data rows
      continue;
    }
    out.push(...cleaned);
  }
  return out;
}

/**
 * Normalize markdown after deletions so the auditor never sees structural holes.
 */
export function normalizeMarkdownStructure(text: string): string {
  let lines = String(text || "").replace(/\r\n/g, "\n").split("\n");

  // Pass 1: drop empty bullets, empty ordered items, trailing-colon holes
  lines = lines.filter(
    (line) =>
      !isEmptyBullet(line) && !isEmptyOrderedItem(line) && !isTrailingColonHole(line)
  );

  // Pass 1b: normalize tables (empty rows / trailing empty cells / empty tables)
  lines = normalizeTables(lines);

  // Pass 2: drop headings whose section body is empty (repeat until stable)
  let changed = true;
  while (changed) {
    changed = false;
    const next: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (isHeading(line) && sectionBodyEmpty(lines, i)) {
        changed = true;
        continue;
      }
      next.push(line);
    }
    lines = next;
  }

  // Pass 3: renumber ordered lists
  lines = renumberOrderedLists(lines);

  // Pass 4: collapse 3+ blank lines; trim edges
  const collapsed: string[] = [];
  let blankRun = 0;
  for (const line of lines) {
    if (isBlank(line)) {
      blankRun += 1;
      if (blankRun <= 1) collapsed.push("");
      continue;
    }
    blankRun = 0;
    collapsed.push(line);
  }

  return collapsed.join("\n").replace(/^\n+/, "").replace(/\n+$/, "") + (collapsed.length ? "\n" : "");
}

/** True when text still has structural holes the auditor flags. */
export function hasStructuralMarkdownHoles(text: string): boolean {
  const lines = String(text || "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isEmptyBullet(line) || isEmptyOrderedItem(line) || isTrailingColonHole(line)) {
      return true;
    }
    if (isEmptyTableRow(line)) return true;
    if (isHeading(line) && sectionBodyEmpty(lines, i)) return true;
  }
  // Skipped numbers in an ordered list (e.g. 2 then 4)
  let prev: number | null = null;
  for (const line of lines) {
    const m = line.match(/^\s*(\d+)[.)]\s+/);
    if (m) {
      const n = Number(m[1]);
      if (prev !== null && n > prev + 1) return true;
      prev = n;
    } else if (!/^\s*$/.test(line)) {
      prev = null;
    }
  }
  return false;
}
