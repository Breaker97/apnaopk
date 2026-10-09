import "server-only";

import type { Metadata } from "next";
import { headers } from "next/headers";
import { REQUEST_PATH_HEADER } from "@/lib/auth/return-path";
import {
  canonicalPageFromRequestPath,
  storefrontPageMetadata,
} from "@/lib/storefront/storefront-metadata";

/**
 * Canonical, hreflang and robots for whatever URL is being served, read from
 * the request path.
 *
 * This used to live in the root layout, which made every page read the
 * request — including the home page, which is now served from the cache
 * (app/[locale]/(store)/(home)/page.tsx) and so may read nothing from it. The
 * layout of every other route segment re-exports this instead; the home page
 * states its own path. tests/storefront-isr-home.test.ts checks that no
 * segment is left without one.
 *
 * `x-request-path` is stamped by the proxy on every page request and
 * overwrites any client-sent value, so it is safe to build URLs from. When it
 * is absent (no proxy in the request path) no canonical is emitted at all.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return storefrontPageMetadata(
    locale,
    canonicalPageFromRequestPath((await headers()).get(REQUEST_PATH_HEADER)),
  );
}

/** For a segment with no layout of its own: the metadata above, nothing else. */
export default function RequestPathMetadataLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
