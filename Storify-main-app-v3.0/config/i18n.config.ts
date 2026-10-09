/**
 * Internationalization (i18n) Configuration
 * Uses BCP 47 / IETF language tags for worldwide standard naming
 * Format: language-REGION (e.g., en-US, ar-SA, bn-BD)
 */

export const locales = [
  "en",
  "bn",
  "ar",
  "es",
  "fr",
  "de",
  "tr",
  "hi",
  "nl",
  "zh",
  "ja",
  "zu",
  "xh",
  "af",
  "sw",
  "ha",
  "yo",
  "ig",
] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

// Locale metadata for UI display
export const localeConfig: Record<
  Locale,
  {
    name: string;
    nativeName: string;
    direction: "ltr" | "rtl";
    flag: string;
    dateFormat: string;
    numberFormat: string;
    languageCode: string; // ISO 639-1
    countryCode: string; // ISO 3166-1 alpha-2
  }
> = {
  "en": {
    name: "English (US)",
    nativeName: "English",
    direction: "ltr",
    flag: "🇺🇸",
    dateFormat: "MM/DD/YYYY",
    numberFormat: "en-US",
    languageCode: "en",
    countryCode: "US",
  },
  "bn": {
    name: "Bengali (Bangladesh)",
    nativeName: "বাংলা",
    direction: "ltr",
    flag: "🇧🇩",
    dateFormat: "DD/MM/YYYY",
    numberFormat: "bn-BD",
    languageCode: "bn",
    countryCode: "BD",
  },
  "ar": {
    name: "Arabic (Saudi Arabia)",
    nativeName: "العربية",
    direction: "rtl",
    flag: "🇸🇦",
    dateFormat: "DD/MM/YYYY",
    numberFormat: "ar-SA",
    languageCode: "ar",
    countryCode: "SA",
  },
  "es": {
    name: "Spanish (Spain)",
    nativeName: "Español",
    direction: "ltr",
    flag: "🇪🇸",
    dateFormat: "DD/MM/YYYY",
    numberFormat: "es-ES",
    languageCode: "es",
    countryCode: "ES",
  },
  "fr": {
    name: "French (France)",
    nativeName: "Français",
    direction: "ltr",
    flag: "🇫🇷",
    dateFormat: "DD/MM/YYYY",
    numberFormat: "fr-FR",
    languageCode: "fr",
    countryCode: "FR",
  },
  "de": {
    name: "German (Germany)",
    nativeName: "Deutsch",
    direction: "ltr",
    flag: "🇩🇪",
    dateFormat: "DD.MM.YYYY",
    numberFormat: "de-DE",
    languageCode: "de",
    countryCode: "DE",
  },
  "tr": {
    name: "Turkish (Turkey)",
    nativeName: "Türkçe",
    direction: "ltr",
    flag: "🇹🇷",
    dateFormat: "DD.MM.YYYY",
    numberFormat: "tr-TR",
    languageCode: "tr",
    countryCode: "TR",
  },
  "hi": {
    name: "Hindi (India)",
    nativeName: "हिन्दी",
    direction: "ltr",
    flag: "🇮🇳",
    dateFormat: "DD/MM/YYYY",
    numberFormat: "hi-IN",
    languageCode: "hi",
    countryCode: "IN",
  },
  "nl": {
    name: "Dutch (Netherlands)",
    nativeName: "Nederlands",
    direction: "ltr",
    flag: "🇳🇱",
    dateFormat: "DD-MM-YYYY",
    numberFormat: "nl-NL",
    languageCode: "nl",
    countryCode: "NL",
  },
  "zh": {
    name: "Chinese (Simplified)",
    nativeName: "中文",
    direction: "ltr",
    flag: "🇨🇳",
    dateFormat: "YYYY/MM/DD",
    numberFormat: "zh-CN",
    languageCode: "zh",
    countryCode: "CN",
  },
  "ja": {
    name: "Japanese (Japan)",
    nativeName: "日本語",
    direction: "ltr",
    flag: "🇯🇵",
    dateFormat: "YYYY/MM/DD",
    numberFormat: "ja-JP",
    languageCode: "ja",
    countryCode: "JP",
  },
  "zu": {
    name: "Zulu (South Africa)",
    nativeName: "isiZulu",
    direction: "ltr",
    flag: "🇿🇦",
    dateFormat: "DD/MM/YYYY",
    numberFormat: "zu-ZA",
    languageCode: "zu",
    countryCode: "ZA",
  },
  "xh": {
    name: "Xhosa (South Africa)",
    nativeName: "isiXhosa",
    direction: "ltr",
    flag: "🇿🇦",
    dateFormat: "DD/MM/YYYY",
    numberFormat: "xh-ZA",
    languageCode: "xh",
    countryCode: "ZA",
  },
  "af": {
    name: "Afrikaans (South Africa)",
    nativeName: "Afrikaans",
    direction: "ltr",
    flag: "🇿🇦",
    dateFormat: "DD/MM/YYYY",
    numberFormat: "af-ZA",
    languageCode: "af",
    countryCode: "ZA",
  },
  "sw": {
    name: "Swahili (Kenya)",
    nativeName: "Kiswahili",
    direction: "ltr",
    flag: "🇰🇪",
    dateFormat: "DD/MM/YYYY",
    numberFormat: "sw-KE",
    languageCode: "sw",
    countryCode: "KE",
  },
  "ha": {
    name: "Hausa (Nigeria)",
    nativeName: "Hausa",
    direction: "ltr",
    flag: "🇳🇬",
    dateFormat: "DD/MM/YYYY",
    numberFormat: "ha-NG",
    languageCode: "ha",
    countryCode: "NG",
  },
  "yo": {
    name: "Yoruba (Nigeria)",
    nativeName: "Yoruba",
    direction: "ltr",
    flag: "🇳🇬",
    dateFormat: "DD/MM/YYYY",
    numberFormat: "yo-NG",
    languageCode: "yo",
    countryCode: "NG",
  },
  "ig": {
    name: "Igbo (Nigeria)",
    nativeName: "Igbo",
    direction: "ltr",
    flag: "🇳🇬",
    dateFormat: "DD/MM/YYYY",
    numberFormat: "ig-NG",
    languageCode: "ig",
    countryCode: "NG",
  },
};

// Helper functions
export function isValidLocale(locale: string): locale is Locale {
  return locales.includes(locale as Locale);
}

export function getLocaleDirection(locale: Locale): "ltr" | "rtl" {
  return localeConfig[locale]?.direction || "ltr";
}

