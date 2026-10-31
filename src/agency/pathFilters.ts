/**
 * Shared path filters for evidence scout / REQ traceability.
 * Junk and non-app paths must never count as implementation evidence.
 */

/** Directory basenames that must not be walked for evidence. */
export function isJunkDirName(name: string): boolean {
  const n = String(name || "");
  if (!n) return true;
  if (
    /^(node_modules|\.git|dist|build|\.next|coverage|vendor|\.expo|android|ios)$/i.test(
      n
    )
  ) {
    return true;
  }
  if (/^\.security-backup/i.test(n)) return true;
  if (/backup/i.test(n)) return true;
  if (/^Sam-Harness\b/i.test(n)) return true;
  if (/^sam-harness$/i.test(n)) return true;
  if (/^sam_harness/i.test(n)) return true;
  if (/^reports?$/i.test(n)) return true;
  return false;
}

/** Relative path (posix) that must never be cited as implementation. */
export function isJunkEvidencePath(relPath: string): boolean {
  const p = String(relPath || "").replace(/\\/g, "/");
  if (!p) return true;
  const parts = p.split("/").filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (isJunkDirName(part)) return true;
    // toolbox/maintenance/**
    if (
      part.toLowerCase() === "toolbox" &&
      parts[i + 1] &&
      /^maintenance$/i.test(parts[i + 1])
    ) {
      return true;
    }
  }
  const base = parts[parts.length - 1] || "";
  // Lockfiles
  if (
    /^(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb|npm-shrinkwrap\.json)$/i.test(
      base
    )
  ) {
    return true;
  }
  // Prior pack / harness artifacts at any depth
  if (
    /^(ceo-draft|audit-report|audit-history|final-report|execution-result|engagement|evidence-pack|evidence|REQ_TRACEABILITY|AUDIT_CHECKLIST|gates|agency-verdict|PACK_HANDOFF|PACK_CLAIM_ASSERTION)\.(md|json)$/i.test(
      base
    )
  ) {
    return true;
  }
  // docs/**/*.md and docs/**/*.json are documentation, not app implementation
  if (/(^|\/)docs?\//i.test(p) && /\.(md|json)$/i.test(base)) return true;
  // Root README / markdown-only docs
  if (/^readme\.md$/i.test(base) && parts.length <= 2) return true;
  return false;
}

/** True when path looks like application source (not docs/config/tests). */
export function isAppSourcePath(relPath: string): boolean {
  const p = String(relPath || "").replace(/\\/g, "/");
  if (!p || isJunkEvidencePath(p)) return false;
  if (!/\.(m?[jt]sx?|jsx?|dart|py)$/i.test(p)) return false;
  if (/(^|\/)(test|tests|__tests__|spec|fixtures|stories|e2e)(\/|$)/i.test(p)) {
    return false;
  }
  if (
    /(^|\/)(src|app|lib|screens?|components?|services?|hooks?|api|server|backend|features?|modules?)\//i.test(
      p
    )
  ) {
    return true;
  }
  // Source file outside banned trees
  if (/(^|\/)(docs?|toolbox|tools|scripts|config|ops|infra)(\/|$)/i.test(p)) {
    return false;
  }
  return true;
}

/**
 * Heuristic: body contains a symbol/handler related to the REQ tokens
 * (not a bare keyword in a comment/string alone).
 */
export function hasSymbolOrHandlerEvidence(
  body: string,
  tokens: string[]
): boolean {
  const text = String(body || "");
  if (!text.trim()) return false;
  // Common UI/service handlers
  if (
    /\b(onPress|onClick|onSubmit|onChange|addEventListener|create\w*Handler|use\w+)\s*[=(:]/.test(
      text
    )
  ) {
    return true;
  }
  if (
    /\b(export\s+(default\s+)?(async\s+)?function|export\s+(const|class)|function\s+\w+|class\s+\w+)/i.test(
      text
    )
  ) {
    // Prefer token appearing as an identifier near a definition
    for (const raw of tokens) {
      const t = String(raw || "").replace(/[^\p{L}\p{N}_-]/gu, "");
      if (t.length < 3) continue;
      try {
        const re = new RegExp(
          `\\b(?:function|const|class|async|export)\\s+\\w*${t}\\w*|\\b${t}\\w*\\s*=\\s*(?:async\\s*)?(?:\\(|function|=>)`,
          "i"
        );
        if (re.test(text)) return true;
      } catch {
        /* ignore bad token */
      }
    }
    // Exported screen/service/module is enough when tokens also appear in body
    if (
      /\b(Screen|Service|Controller|Provider|Navigator|Repository|ViewModel)\b/.test(
        text
      ) &&
      tokens.some((t) => t.length >= 4 && text.toLowerCase().includes(t.toLowerCase()))
    ) {
      return true;
    }
  }
  return false;
}
