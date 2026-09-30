"use client";

import NextLink from "next/link";
import { useState, type ComponentProps } from "react";
import { useLocaleHref, useRememberLocale } from "@/hooks/use-locale-navigation";
import { startNavigationProgress } from "@/components/layout/navigation-progress";

type NextLinkProps = ComponentProps<typeof NextLink>;

/**
 * `next/link` that prints the URL this store actually serves, and prefetches
 * on intent rather than on sight.
 *
 * The store's default language has no prefix in the address bar, so a href
 * written the way the app has always written it — `/${locale}/products` — has
 * to be translated before it reaches the browser, or every click would spend a
 * redirect getting rid of the prefix. Locale-less hrefs (`/products`) are
 * accepted too and resolve to the current page's language, which is how call
 * sites can drop the prefix from their own code over time.
 *
 * Prefetching: Next prefetches every link that scrolls into view. A storefront
 * page is mostly links — product cards, menus, footer — so one page view sent
 * 18–51 prefetch requests, each a server render. On a phone far from the
 * server they queue in front of the request the shopper's tap is waiting for,
 * and every visitor multiplies the server's work by the same factor. A link
 * now prefetches when the pointer rests on it, a finger touches it or it takes
 * keyboard focus — the same prefetch, started by intent. A call site that sets
 * `prefetch` itself keeps exactly what it asked for.
 *
 * Every in-app navigation also starts the progress bar
 * (components/layout/navigation-progress.tsx): without a prefetched skeleton,
 * a tap on a phone shows nothing until the server answers.
 *
 * A click records the language of the page it leads to, as the router's
 * `push` does (see `rememberLocale`) — on click rather than in `onNavigate`,
 * so a link opened in a new tab arrives in the right language too.
 *
 * This is a drop-in replacement: `import Link from "@/components/language/link"`
 * in place of `next/link`, same props, same ref forwarding (React 19 passes
 * `ref` through as a prop).
 */
export default function Link({
  href,
  prefetch,
  onClick,
  onMouseEnter,
  onTouchStart,
  onFocus,
  onNavigate,
  ...props
}: NextLinkProps) {
  const localeHref = useLocaleHref();
  const rememberLocaleOf = useRememberLocale();
  // Off until the shopper shows intent; from then on Next prefetches this link
  // as it would any visible one (it is visible — it is being pointed at).
  const [intent, setIntent] = useState(false);
  const chosen = prefetch !== undefined && prefetch !== null;

  const resolved: NextLinkProps["href"] =
    typeof href === "string"
      ? localeHref(href)
      : href?.pathname
        ? { ...href, pathname: localeHref(href.pathname) }
        : href;

  const showIntent = () => {
    if (!chosen && !intent) setIntent(true);
  };

  const navigateWithProgress: NextLinkProps["onNavigate"] = (event) => {
    let cancelled = false;
    onNavigate?.({
      preventDefault: () => {
        cancelled = true;
        event.preventDefault();
      },
    });
    if (!cancelled && !isCurrentPage(resolved)) startNavigationProgress();
  };

  return (
    <NextLink
      href={resolved}
      prefetch={chosen ? prefetch : intent ? null : false}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        const path = internalPath(resolved);
        if (path) rememberLocaleOf(path);
      }}
      onMouseEnter={(event) => {
        onMouseEnter?.(event);
        showIntent();
      }}
      onTouchStart={(event) => {
        onTouchStart?.(event);
        showIntent();
      }}
      onFocus={(event) => {
        onFocus?.(event);
        showIntent();
      }}
      onNavigate={navigateWithProgress}
      {...props}
    />
  );
}

/**
 * Whether a link points at the page already shown (a hash jump, or the current
 * URL again): no new route will commit, so no bar should start.
 */
function isCurrentPage(href: NextLinkProps["href"]): boolean {
  if (typeof href === "string" && href.startsWith("#")) return true;
  const path = internalPath(href);
  if (!path) return false;
  const target = new URL(path, window.location.href);
  return (
    target.pathname === window.location.pathname &&
    target.search === window.location.search
  );
}

/** The in-app path a href leads to, or null for external, hash-only or empty hrefs. */
function internalPath(href: NextLinkProps["href"]): string | null {
  if (typeof href === "string") return href.startsWith("/") ? href : null;
  if (!href?.pathname?.startsWith("/")) return null;

  const query =
    typeof href.query === "string"
      ? href.query
      : href.query
        ? new URLSearchParams(
            Object.entries(href.query).flatMap(([key, value]) =>
              value === undefined || value === null
                ? []
                : (Array.isArray(value) ? value : [value]).map(
                    (item): [string, string] => [key, String(item)],
                  ),
            ),
          ).toString()
        : (href.search ?? "").replace(/^\?/, "");
  return query ? `${href.pathname}?${query}` : href.pathname;
}
