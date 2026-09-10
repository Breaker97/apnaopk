"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Scale } from "lucide-react";
import { useTranslations } from "next-intl";
import { type Locale } from "@/config/i18n.config";
import { useCompare } from "@/hooks/use-compare";
import { buildCompareHref } from "@/lib/products/compare";

/**
 * The bridge between picking and comparing: a floating bar that appears once
 * something is in the tray and links to `/compare` with the picks as the
 * query.
 *
 * It hides itself ON the compare page — the page already shows every pick as
 * a column, so a bar restating them would only cover the table. It also
 * renders nothing until its own effect has run (see `useCompare`), which is
 * what keeps it from painting over server HTML drawn with an empty tray.
 */
export function CompareBar({ locale }: { locale: Locale }) {
  const t = useTranslations();
  const pathname = usePathname();
  const { slugs, hydrated, clear } = useCompare();

  const onComparePage = pathname?.startsWith(`/${locale}/compare`) ?? false;
  if (!hydrated || slugs.length === 0 || onComparePage) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4"
      // Clears the mobile bottom nav, which is fixed at the same edge.
      style={{ bottom: "calc(4.25rem + env(safe-area-inset-bottom))" }}
    >
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-background/95 py-1.5 pe-1.5 ps-4 shadow-lg backdrop-blur xl:mb-2">
        <Scale className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="text-sm font-medium text-foreground">
          {t("compare.bar", { count: slugs.length })}
        </span>
        <button
          type="button"
          onClick={clear}
          className="rounded-full px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("compare.clear")}
        </button>
        <Link
          href={buildCompareHref(locale, slugs, {})}
          className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-sm font-semibold text-background transition-opacity hover:opacity-90"
        >
          {t("compare.short")}
          <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
        </Link>
      </div>
    </div>
  );
}

/**
 * Keeps the tray honest on the compare page itself: the URL is what the
 * shopper is looking at, so it wins. Removing a column navigates to a new
 * URL and this adopts it, so the tray never drifts from the table behind it.
 */
export function CompareUrlSync({ slugs }: { slugs: string[] }) {
  const { replace, hydrated } = useCompare();
  // The joined string is the real dependency — `slugs` is a fresh array on
  // every server render and would re-run this on every navigation.
  const key = slugs.join(",");

  useEffect(() => {
    if (!hydrated) return;
    replace(key ? key.split(",") : []);
  }, [key, hydrated, replace]);

  return null;
}
