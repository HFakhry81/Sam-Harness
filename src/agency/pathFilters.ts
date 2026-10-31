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

/**
 * Navigation shells, mock/fixture data, and constants must never count as
 * feature implementation evidence (at most weak/partial keyword signal).
 */
export function isNonFeatureEvidencePath(relPath: string): boolean {
  const p = String(relPath || "").replace(/\\/g, "/");
  if (!p) return true;
  if (/(^|\/)(navigation|navigators?|routes?|routing)(\/|$)/i.test(p)) return true;
  if (/(Stack|Tabs|Navigator|Router)\.(m?[jt]sx?|jsx?)$/i.test(p)) return true;
  if (/(^|\/)(mocks?|fixtures?|constants?|theme|assets|__mocks__)(\/|$)/i.test(p)) {
    return true;
  }
  if (/mockData|sampleData|dummyData|fixtures?\./i.test(p)) return true;
  if (/(^|\/)constants\.\w+$/i.test(p)) return true;
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

/** Spec section headings that are not actionable requirements. */
export function isSpecHeadingNotRequirement(text: string): boolean {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return true;
  if (
    /^(project\s+overview|functional\s+requirements(\s+analysis)?|tech(nical)?\s+stack|introduction|overview|scope|glossary|appendix|table\s+of\s+contents|executive\s+summary|background|architecture\s+overview|system\s+overview|document\s+control|references|assumptions|constraints|non-?functional\s+requirements|requirements\s+analysis)$/i.test(
      t
    )
  ) {
    return true;
  }
  // Title-case short label without obligation verbs
  if (
    t.length <= 60 &&
    !/\b(must|should|shall|will|need to|required|support|provide|implement|wire|integrate)\b/i.test(
      t
    ) &&
    /^[A-Z][\w\s/&-]{2,58}$/.test(t)
  ) {
    return true;
  }
  return false;
}

/**
 * Feature-family APIs required for OCR / voice / similar REQs.
 * Returns null when no special family applies.
 */
export function featureFamilySymbols(reqText: string): RegExp | null {
  const t = String(reqText || "").toLowerCase();
  if (/\bocr\b|receipt|document\s*scan|scan\s+receipt|camera\s+scan/.test(t)) {
    return /\b(ocr|tesseract|mlkit|vision|receipt|document.?scan|scan(?:ner|ning)?|expo-camera|barcode|image.?pick|launchCamera|takePicture)\b/i;
  }
  if (/\bvoice\b|speech|audio\s+record|microphone|dictation/.test(t)) {
    return /\b(voice|speech|stt|tts|recognition|microphone|audio.?record|expo-av|Speech|startRecording|dictation)\b/i;
  }
  return null;
}

/** Navigation-only screen registration without feature APIs. */
export function isNavigationOnlyRegistration(body: string): boolean {
  const text = String(body || "");
  const hasNav =
    /create\w*Navigator|Tab\.Screen|Stack\.Screen|createBottomTabNavigator|createNativeStackNavigator|NavigationContainer/i.test(
      text
    );
  if (!hasNav) return false;
  const hasFeatureImpl =
    /\bonPress\s*=|\bfetch\s*\(|axios\.|supabase|createClient|useEffect\s*\(|AsyncStorage|camera|ocr|speech|record/i.test(
      text
    );
  return !hasFeatureImpl;
}

/**
 * Heuristic: body contains a symbol/handler related to the REQ tokens
 * (not a bare keyword in a comment/string alone). Navigation-only
 * registration and mock/constants files do not qualify for implemented.
 */
export function hasSymbolOrHandlerEvidence(
  body: string,
  tokens: string[],
  reqText = "",
  relPath = ""
): boolean {
  const text = String(body || "");
  if (!text.trim()) return false;
  if (relPath && isNonFeatureEvidencePath(relPath)) return false;
  if (isNavigationOnlyRegistration(text)) return false;

  const family = featureFamilySymbols(reqText || tokens.join(" "));
  if (family) {
    // OCR/voice/etc. require family-specific APIs — not just Screen export
    if (!family.test(text)) return false;
  }

  // Common UI/service handlers
  if (
    /\b(onPress|onClick|onSubmit|onChange|addEventListener|create\w*Handler|use\w+)\s*[=(:]/.test(
      text
    )
  ) {
    // Still require a token or family hit so AuthStack onPress doesn't satisfy OCR
    if (family) return true;
    if (
      tokens.some((t) => t.length >= 4 && text.toLowerCase().includes(t.toLowerCase()))
    ) {
      return true;
    }
  }
  if (
    /\b(export\s+(default\s+)?(async\s+)?function|export\s+(const|class)|function\s+\w+|class\s+\w+)/i.test(
      text
    )
  ) {
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
    // Exported screen/service — NOT Navigator — when tokens appear (and family ok)
    if (
      /\b(Screen|Service|Controller|Provider|Repository|ViewModel)\b/.test(text) &&
      !/\bNavigator\b/.test(text) &&
      tokens.some((t) => t.length >= 4 && text.toLowerCase().includes(t.toLowerCase()))
    ) {
      return true;
    }
  }
  return false;
}
