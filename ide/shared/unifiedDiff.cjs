/**
 * Minimal, dependency-free unified-diff applier shared by the editor extension
 * and the harness tests. Supports @@ hunks with context / - / + lines.
 *
 * It is intentionally strict: on any structural mismatch it throws, so the
 * editor never writes a partially applied patch.
 *
 * `.cjs` on purpose: the repository is ESM ("type": "module") while the VS Code
 * extension host and this helper are CommonJS.
 */
"use strict";

function applyUnifiedDiff(originalText, diffText) {
  const original = String(originalText == null ? "" : originalText);
  const diff = String(diffText == null ? "" : diffText);
  if (!diff.trim()) throw new Error("empty diff");

  const src = original.split(/\r?\n/);
  const out = [];
  let cursor = 0;
  let hunks = 0;
  const lines = diff.split(/\r?\n/);
  let i = 0;

  while (i < lines.length) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(lines[i]);
    if (!header) {
      i++;
      continue;
    }
    hunks++;
    const oldStart = Math.max(1, parseInt(header[1], 10)) - 1;
    if (oldStart < cursor) throw new Error("overlapping diff hunks");
    while (cursor < oldStart && cursor < src.length) out.push(src[cursor++]);
    i++;

    while (i < lines.length && !/^@@ /.test(lines[i])) {
      const line = lines[i];
      if (line.startsWith("\\")) {
        i++;
        continue;
      }
      if (line.startsWith("--- ") || line.startsWith("+++ ")) {
        i++;
        continue;
      }
      if (line === "" || line.startsWith(" ")) {
        if (cursor >= src.length) throw new Error("diff context beyond end of file");
        out.push(src[cursor++]);
      } else if (line.startsWith("-")) {
        if (cursor >= src.length) throw new Error("diff removal beyond end of file");
        cursor++;
      } else if (line.startsWith("+")) {
        out.push(line.slice(1));
      } else {
        throw new Error(`unsupported diff line: ${line.slice(0, 40)}`);
      }
      i++;
    }
  }

  if (hunks === 0) throw new Error("no @@ hunk found");
  while (cursor < src.length) out.push(src[cursor++]);
  return out.join("\n");
}

module.exports = { applyUnifiedDiff };
