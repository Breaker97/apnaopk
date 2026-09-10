"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { StoreBreadcrumb } from "@/components/store/store-breadcrumb";

type AccountCrumb = {
  key: string;
  /** Used when the key is missing from a locale that has not caught up yet. */
  fallback?: string;
  /** Locale-relative path; omit to render the crumb as the current page. */
  href?: string;
};

/**
 * The trail below "Account", keyed by exact path. Rendered from the layout, so
 * this table is the only place an account route declares where it sits.
 */
const ACCOUNT_SECTIONS: Record<string, AccountCrumb[]> = {
  // The dashboard is the Account crumb itself, so it adds nothing below it.
  "/account": [],
  "/account/orders": [{ key: "account.orders" }],
  "/account/orders/pre-orders": [
    { key: "account.orders", href: "/account/orders" },
    { key: "orders.preOrders" },
  ],
  "/account/notifications": [{ key: "common.notifications" }],
  // `account.inbox` is a namespace object: t.has() reports true for it but t()
  // throws INSUFFICIENT_PATH, so the title key is addressed directly.
  "/account/inbox": [{ key: "account.inbox.title", fallback: "Inbox" }],
  "/account/wishlist": [{ key: "account.wishlist" }],
  "/account/profile": [{ key: "account.profile" }],
  "/account/preferences": [{ key: "customerProfile.preferences" }],
  "/account/addresses": [{ key: "account.addresses" }],
  "/account/security": [{ key: "account.security" }],
};

/** A single order sits under the list it was opened from. */
const ORDER_DETAIL_SECTION: AccountCrumb[] = [
  { key: "account.orders", href: "/account/orders" },
  { key: "orders.orderDetails" },
];

function stripLocale(pathname: string, locale: string) {
  const path = pathname.startsWith(`/${locale}`)
    ? pathname.slice(locale.length + 1)
    : pathname;
  const normalized = path.replace(/\/+$/, "");
  return normalized || "/account";
}

/**
 * One breadcrumb for every account route, resolved from the URL. The sidebar
 * says which section is active; this says how to get back out of it — and it
 * lives in the layout so a new account page inherits the trail by adding a row
 * above rather than by remembering to render anything.
 */
export function AccountBreadcrumb({
  locale,
  className,
}: {
  locale: string;
  className?: string;
}) {
  const t = useTranslations();
  const path = stripLocale(usePathname(), locale);

  const section =
    ACCOUNT_SECTIONS[path] ??
    (path.startsWith("/account/orders/") ? ORDER_DETAIL_SECTION : []);

  return (
    <StoreBreadcrumb
      locale={locale}
      className={className}
      // The account area is behind a login and never indexed; structured data
      // for it would only mislead a crawler that got this far.
      jsonLd={false}
      items={[
        {
          label: t("common.account"),
          href: section.length > 0 ? "/account" : undefined,
        },
        ...section.map((crumb) => ({
          label:
            crumb.fallback && !t.has(crumb.key) ? crumb.fallback : t(crumb.key),
          href: crumb.href,
        })),
      ]}
    />
  );
}
