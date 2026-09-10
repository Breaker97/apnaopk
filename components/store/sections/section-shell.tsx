import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { type Locale } from "@/config/i18n.config";

/**
 * Shared bits for theme-engine sections: the locale-aware href resolver the
 * home sections already use, and the standard section heading so every new
 * section matches the established storefront rhythm.
 */

export function resolveSectionHref(locale: Locale, href: string): string {
  if (!href) return `/${locale}`;
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith("/")) {
    if (href === `/${locale}` || href.startsWith(`/${locale}/`)) return href;
    return `/${locale}${href}`;
  }
  return `/${locale}/${href}`;
}

export function isExternalSectionHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

export function SectionHeading({
  title,
  subtitle,
  viewAllHref,
  viewAllLabel,
  className,
}: {
  title: string;
  subtitle?: string;
  viewAllHref?: string;
  viewAllLabel?: string;
  className?: string;
}) {
  if (!title && !subtitle) return null;
  return (
    <div className={cn("flex items-center justify-between gap-6", className)}>
      <h2 className="text-[length:var(--sec-title,1.125rem)] font-bold tracking-tight sm:text-[length:var(--sec-title-lg,1.5rem)]">
        <span className="text-foreground">{title}</span>{" "}
        {subtitle ? (
          <span className="font-medium text-muted-foreground">{subtitle}</span>
        ) : null}
      </h2>
      {viewAllHref && viewAllLabel ? (
        <Link
          href={viewAllHref}
          className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {viewAllLabel}
          <ArrowRight className="h-4 w-4 rtl:rotate-180" />
        </Link>
      ) : null}
    </div>
  );
}
