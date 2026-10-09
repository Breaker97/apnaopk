import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { type Locale } from "@/config/i18n.config";
import { StoreSections } from "@/components/store/store-sections";
import { getHomePageRender } from "@/lib/storefront/pages/get-home-page";
import { storefrontPageMetadata } from "@/lib/storefront/storefront-metadata";

interface PageProps {
  params: Promise<{ locale: string }>;
}

/**
 * Served from the cache. Nothing is built ahead (no database at build time):
 * each language's home page is rendered on its first visit, kept, and
 * rendered again when an admin edit expires a tag it read
 * (lib/cache-invalidation.ts) or when the shortest-lived data it read runs
 * out (a minute, the store settings), whichever comes first. Content switched
 * on and off by a schedule — a slide's window, a coupon's dates, a boost — is
 * therefore decided when the page is rendered, up to that minute late.
 *
 * Everything in the page and the layouts above it must stay out of the
 * request: a `headers()`, `cookies()` or search-param read anywhere turns
 * this back into a per-request render, silently. tests/storefront-isr-home.test.ts
 * guards the files it can.
 */
export function generateStaticParams() {
  return [];
}

// The layout above cannot know which page it wraps; this one is the store root.
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  return storefrontPageMetadata(locale, "");
}

/**
 * The home page renders whatever the theme engine's home document (or, until
 * the migration runs, the mapped legacy `settings.homePage`) says: an ordered
 * list of section instances resolved against the section registry.
 *
 * Only the PUBLISHED state renders here — draft preview lives on its own
 * admin-gated /draft route, so this page never touches a request API and
 * stays fully cacheable for shoppers.
 *
 * It is deliberately **not** location-filtered.
 *
 * Every other listing narrows to the shopper's place, but this page is the
 * storefront's shop window: its job is to show the breadth of the catalogue,
 * and filtering it to one city empties most of the strips a store spent effort
 * curating. A shopper who wants "near me" reaches the filtered listings one
 * click away, where the location banner explains what is being narrowed.
 *
 * The header's "Deliver to" control (when the store switches shopper location
 * on) sets the place from here without narrowing this page: the choice is
 * saved and follows the shopper to every page that does filter, and on to
 * checkout.
 */
export default async function HomePage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { sections, ctx } = await getHomePageRender(locale as Locale);
  return <StoreSections sections={sections} ctx={ctx} />;
}
