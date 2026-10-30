import type { AppLocale, NumeralSystem } from "./types.js";
import { loadLocaleConfig } from "./config.js";

const EASTERN_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const WESTERN_DIGITS = "0123456789";

/** Convert western digits → eastern Arabic-Indic digits. */
export function toEasternNumerals(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => EASTERN_DIGITS[Number(d)]!);
}

/** Convert eastern Arabic-Indic digits → western. */
export function toWesternNumerals(input: string | number): string {
  const map: Record<string, string> = {};
  for (let i = 0; i < 10; i++) map[EASTERN_DIGITS[i]!] = WESTERN_DIGITS[i]!;
  // Also handle Persian variants ۰-۹
  const persian = "۰۱۲۳۴۵۶۷۸۹";
  for (let i = 0; i < 10; i++) map[persian[i]!] = WESTERN_DIGITS[i]!;
  return String(input).replace(/[٠-٩۰-۹]/g, (d) => map[d] || d);
}

export function formatNumber(
  value: number | string,
  opts?: { numerals?: NumeralSystem; locale?: AppLocale }
): string {
  const cfg = loadLocaleConfig();
  const numerals = opts?.numerals ?? cfg.numerals;
  const s = String(value);
  return numerals === "eastern" ? toEasternNumerals(s) : toWesternNumerals(s);
}

/** Simple ${var} interpolation for catalog messages. */
export function interpolate(
  template: string,
  vars: Record<string, string | number> = {}
): string {
  return template.replace(/\$\{(\w+)\}/g, (_, key: string) =>
    vars[key] !== undefined ? String(vars[key]) : ""
  );
}
