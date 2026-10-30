/** Supported UI / content locales. Arabic is the product default. */
export type AppLocale = "ar" | "en";

/** Numeral rendering for UI + generated documents. */
export type NumeralSystem = "eastern" | "western";

export type LocaleConfig = {
  /** Default / configured locale (Arabic-first). */
  locale: AppLocale;
  /** Document / agent reply locale (may mirror UI). */
  contentLocale: AppLocale;
  /** HTML dir for the configured locale. */
  dir: "rtl" | "ltr";
  /** BCP-47 language tag. */
  lang: string;
  /** Number shaping. */
  numerals: NumeralSystem;
  /** Prefer Egyptian-friendly colloquial phrasing in UI copy. */
  egyptianFriendly: boolean;
};

/** Flat message catalog — every key must exist in both `ar` and `en`. */
export type MessageCatalog = Record<string, string>;
