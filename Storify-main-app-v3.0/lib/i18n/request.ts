import { getRequestConfig } from "next-intl/server";
import { locales, defaultLocale, type Locale } from "@/config/i18n.config";

/**
 * Import all locale files statically
 * Files use language tags matching config/i18n.config.ts
 * Standard folder: /locales/
 */
import enMessages from "@/locales/en.json";
import bnMessages from "@/locales/bn.json";
import arMessages from "@/locales/ar.json";
import esMessages from "@/locales/es.json";
import frMessages from "@/locales/fr.json";
import deMessages from "@/locales/de.json";
import trMessages from "@/locales/tr.json";
import hiMessages from "@/locales/hi.json";
import nlMessages from "@/locales/nl.json";
import zhMessages from "@/locales/zh.json";
import jaMessages from "@/locales/ja.json";
import zuMessages from "@/locales/zu.json";
import xhMessages from "@/locales/xh.json";
import afMessages from "@/locales/af.json";
import swMessages from "@/locales/sw.json";
import haMessages from "@/locales/ha.json";
import yoMessages from "@/locales/yo.json";
import igMessages from "@/locales/ig.json";
import { isRecord } from "@/lib/utils";

type MessageValue = Record<string, unknown>;

function mergeDeep(base: MessageValue, override: MessageValue): MessageValue {
  const result: MessageValue = { ...base };

  for (const [key, overrideValue] of Object.entries(override)) {
    const baseValue = result[key];

    if (isRecord(baseValue) && isRecord(overrideValue)) {
      result[key] = mergeDeep(baseValue, overrideValue);
      continue;
    }

    result[key] = overrideValue;
  }

  return result;
}

const baseMessages = enMessages as unknown as MessageValue;

const messages: Record<Locale, MessageValue> = {
  en: baseMessages,
  bn: mergeDeep(baseMessages, bnMessages as unknown as MessageValue),
  ar: mergeDeep(baseMessages, arMessages as unknown as MessageValue),
  es: mergeDeep(baseMessages, esMessages as unknown as MessageValue),
  fr: mergeDeep(baseMessages, frMessages as unknown as MessageValue),
  de: mergeDeep(baseMessages, deMessages as unknown as MessageValue),
  tr: mergeDeep(baseMessages, trMessages as unknown as MessageValue),
  hi: mergeDeep(baseMessages, hiMessages as unknown as MessageValue),
  nl: mergeDeep(baseMessages, nlMessages as unknown as MessageValue),
  zh: mergeDeep(baseMessages, zhMessages as unknown as MessageValue),
  ja: mergeDeep(baseMessages, jaMessages as unknown as MessageValue),
  zu: mergeDeep(baseMessages, zuMessages as unknown as MessageValue),
  xh: mergeDeep(baseMessages, xhMessages as unknown as MessageValue),
  af: mergeDeep(baseMessages, afMessages as unknown as MessageValue),
  sw: mergeDeep(baseMessages, swMessages as unknown as MessageValue),
  ha: mergeDeep(baseMessages, haMessages as unknown as MessageValue),
  yo: mergeDeep(baseMessages, yoMessages as unknown as MessageValue),
  ig: mergeDeep(baseMessages, igMessages as unknown as MessageValue),
};

export default getRequestConfig(async ({ locale: explicitLocale, requestLocale }) => {
  // An explicit locale — `getTranslations({ locale })` from a route handler,
  // where no `[locale]` segment was matched — wins over the request's own.
  const requested = explicitLocale ?? (await requestLocale);
  const locale: Locale = locales.includes(requested as Locale)
    ? (requested as Locale)
    : defaultLocale;

  return {
    locale,
    messages: messages[locale],
  };
});
