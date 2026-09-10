"use client";

import { useEffect } from "react";

/**
 * Syncs <html lang/dir> with the active locale.
 *
 * The root layout sits above the [locale] segment, so its server-rendered
 * <html lang> is a static fallback ("en"). This runs inside the [locale]
 * layout and stamps the real values post-hydration — which matters for
 * assistive tech and for portaled UI (Radix popovers/menus render into
 * document.body, outside the locale wrapper div, and would otherwise miss the
 * RTL direction).
 */
export function HtmlLangSync({
  locale,
  direction,
}: {
  locale: string;
  direction: "ltr" | "rtl";
}) {
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = direction;
  }, [locale, direction]);

  return null;
}
