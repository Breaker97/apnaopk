import { locales, defaultLocale, type Locale } from "@/config/i18n.config";

function isLocale(value: string | undefined): value is Locale {
  return Boolean(value && locales.includes(value as Locale));
}

/**
 * A notification's link as a device opens it: always with a locale in front,
 * the device's own (else the store's default), so a tap lands in the language
 * the device registered with. An absolute URL is left alone; no link is the
 * home page. The website corrects a default-language prefix with a redirect;
 * the mobile app's link table reads the path either way.
 */
export function withLocalePrefix(url: string | undefined, locale: string | undefined) {
  const fallbackLocale = isLocale(locale) ? locale : defaultLocale;
  const target = url && url.trim() ? url.trim() : `/${fallbackLocale}`;

  if (/^https?:\/\//i.test(target)) return target;
  if (!target.startsWith("/")) return `/${fallbackLocale}/${target}`;

  const firstSegment = target.split("/").filter(Boolean)[0];
  if (isLocale(firstSegment)) return target;

  return `/${fallbackLocale}${target === "/" ? "" : target}`;
}
