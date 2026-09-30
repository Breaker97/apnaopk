"use client";

import { useEffect } from "react";
import { rememberLocale } from "@/hooks/use-locale-navigation";

/**
 * Keeps the locale cookie on the language of the page on screen.
 *
 * The navigation wrappers record a page's language before they request it,
 * but a page can arrive other ways: Back/Forward restores one from the
 * router's cache, a server redirect lands on one, and a full load forwarded
 * by the service worker never gets next-intl's own cookie update. However the
 * visitor got here, the language they are reading is the one an unprefixed
 * URL should serve them next.
 */
export function LocaleCookieSync({ locale }: { locale: string }) {
  useEffect(() => rememberLocale(locale), [locale]);

  return null;
}
