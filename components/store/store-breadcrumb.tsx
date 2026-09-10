import { Fragment } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { JsonLd, generateBreadcrumbJsonLd } from "@/lib/site-config/seo";
import { cn } from "@/lib/utils";

interface StoreBreadcrumbItem {
  /** Already-translated text — this component never guesses a label. */
  label: string;
  /**
   * Locale-relative path (`/products`, `/categories/shoes`) or an absolute URL.
   * Leave it unset on the last crumb: the page you are standing on is never a
   * link, and an unset href renders the crumb as the current page.
   */
  href?: string;
}

interface StoreBreadcrumbProps {
  locale: string;
  /** The trail below Home. The Home crumb is prepended for you. */
  items: StoreBreadcrumbItem[];
  /** Overrides the default `mb-6` spacing as well as anything else. */
  className?: string;
  /**
   * Emit schema.org BreadcrumbList markup alongside the visible trail. Leave it
   * on for indexable pages — it is what turns the trail into the site hierarchy
   * Google prints under a search result. Turn it off on pages robots never see
   * (cart, account, checkout), where it is noise.
   */
  jsonLd?: boolean;
  /**
   * Emit ONLY the structured data, no visible trail — for pages whose body
   * renders its own breadcrumb (the product buy box) but that still owe
   * Google the BreadcrumbList hierarchy.
   */
  hidden?: boolean;
}

/** Every storefront href is locale-scoped; external URLs pass through as-is. */
function toLocalePath(locale: string, href: string) {
  if (/^https?:\/\//i.test(href)) return href;

  const path = href.startsWith("/") ? href : `/${href}`;
  return path === "/" ? `/${locale}` : `/${locale}${path}`;
}

/**
 * The storefront's one breadcrumb. Pages describe where they sit — everything
 * else (the Home crumb, locale prefixing, separators, truncation, structured
 * data) is settled here so no two pages can drift apart.
 *
 * Deliberately not a client component: it renders on the server for the pages
 * that are server-rendered, and still works inside the handful of client pages
 * (cart) that import it, because `useTranslations` resolves against whichever
 * graph it lands in.
 */
export function StoreBreadcrumb({
  locale,
  items,
  className,
  jsonLd = true,
  hidden = false,
}: StoreBreadcrumbProps) {
  const t = useTranslations();

  const trail: StoreBreadcrumbItem[] = [
    { label: t("common.home"), href: "/" },
    ...items,
  ];
  const lastIndex = trail.length - 1;
  const baseUrl = (
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  ).replace(/\/+$/, "");

  return (
    <>
      {jsonLd ? (
        <JsonLd
          data={generateBreadcrumbJsonLd(
            trail.map((item, index) => ({
              name: item.label,
              // Google reads the final crumb as "you are here" when `item` is
              // omitted, so the current page contributes its name only.
              url:
                index === lastIndex || !item.href
                  ? undefined
                  : `${baseUrl}${toLocalePath(locale, item.href)}`,
            })),
          )}
        />
      ) : null}

      {hidden ? null : (
      <Breadcrumb className={cn("mb-6", className)}>
        <BreadcrumbList>
          {trail.map((item, index) => {
            const isCurrent = index === lastIndex || !item.href;

            return (
              <Fragment key={index}>
                {index > 0 ? <BreadcrumbSeparator /> : null}
                <BreadcrumbItem>
                  {isCurrent ? (
                    // `block` is what makes `truncate` bite inside the
                    // inline-flex crumb — a product name has no length limit.
                    <BreadcrumbPage className="block max-w-[60vw] truncate sm:max-w-sm">
                      {item.label}
                    </BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link
                        href={toLocalePath(locale, item.href as string)}
                        className="block max-w-[40vw] truncate sm:max-w-[14rem]"
                      >
                        {item.label}
                      </Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </Fragment>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>
      )}
    </>
  );
}
