/**
 * Normalize punctuation for Windows-safe pack / gate text.
 * Em dashes and en dashes often mojibake in audit-history.md on Windows cp1252.
 */
export function toAsciiDashes(text: string): string {
  return String(text || "")
    .replace(/\u2014/g, "-") // em dash —
    .replace(/\u2013/g, "-") // en dash –
    .replace(/\u2212/g, "-"); // minus sign
}

export function asciiGateReason(text: string): string {
  return toAsciiDashes(text).replace(/\s+/g, " ").trim();
}
