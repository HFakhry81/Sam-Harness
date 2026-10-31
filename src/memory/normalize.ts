/**
 * Fingerprint normalization for memory dedup.
 * Handles case, whitespace, punctuation, Arabic diacritics / letter variants, numbers.
 */

/** Arabic tashkeel + tatweel + Quranic annotation marks. */
const ARABIC_DIACRITICS =
  /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;

/** Map common Arabic letter variants to a canonical form. */
const ARABIC_LETTER_MAP: Record<string, string> = {
  أ: "ا",
  إ: "ا",
  آ: "ا",
  ٱ: "ا",
  ة: "ه",
  ى: "ي",
  ئ: "ي",
  ؤ: "و",
  ـ: "",
};

/** Arabic-Indic and Eastern Arabic-Indic digits → ASCII. */
const ARABIC_INDIC_DIGITS: Record<string, string> = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
};

function mapChar(ch: string): string {
  if (ARABIC_LETTER_MAP[ch] !== undefined) return ARABIC_LETTER_MAP[ch];
  if (ARABIC_INDIC_DIGITS[ch] !== undefined) return ARABIC_INDIC_DIGITS[ch];
  return ch;
}

/**
 * Normalize text for fingerprinting / similarity.
 * Deterministic, locale-safe, no LLM.
 */
export function normalizeMemoryText(raw: string): string {
  let s = String(raw || "");
  // NFKC then strip diacritics / tatweel
  try {
    s = s.normalize("NFKC");
  } catch {
    /* ignore */
  }
  s = s.replace(ARABIC_DIACRITICS, "");
  let out = "";
  for (const ch of s) {
    out += mapChar(ch);
  }
  s = out.toLowerCase();
  // Drop punctuation / symbols; keep letters, numbers, spaces
  s = s.replace(/[^\p{L}\p{N}\s]+/gu, " ");
  // Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/** Stable fingerprint string (normalized text; empty → empty). */
export function fingerprintText(raw: string): string {
  return normalizeMemoryText(raw);
}

/** Tokenize normalized text into unique-ish tokens for Jaccard. */
export function tokenizeNormalized(normalized: string): string[] {
  return String(normalized || "")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}
