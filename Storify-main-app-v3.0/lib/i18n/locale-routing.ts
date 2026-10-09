import "server-only";
import { unstable_cache } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";
import {
  FALLBACK_LOCALE_ROUTING,
  resolveLocaleRouting,
  toBrowserPath,
  type LocaleRouting,
} from "@/lib/i18n/locale-prefix";

/**
 * The store's locale routing, read once per minute for the whole server.
 *
 * Which languages a store serves is admin state, not request state, so this is
 * cached on the settings tag exactly like the rest of the storefront's
 * settings reads — a saved language change invalidates it. Every consumer that
 * has to name a URL from the server (canonical tags, the sitemap, `redirect`,
 * the links that go out in email) goes through here, so the address bar, the
 * proxy and Google are never told three different things.
 *
 * Failure falls back to a single default-locale store rather than throwing: a
 * database blip must not take out `generateMetadata`. The fallback is decided
 * outside the cache, so it is never stored as the store's routing (see
 * lib/storefront/cached-read.ts).
 */
async function readLocaleRouting(): Promise<LocaleRouting> {
  await connectDB();
  return resolveLocaleRouting((await getSettings()).general);
}

const cachedLocaleRouting = unstable_cache(readLocaleRouting, ["locale-routing"], {
  revalidate: 60,
  tags: [CACHE_TAGS.settings],
});

export async function getLocaleRouting(): Promise<LocaleRouting> {
  try {
    return await cachedLocaleRouting();
  } catch (error) {
    if (!isWithoutRequestCache(error)) return FALLBACK_LOCALE_ROUTING;
    // `unstable_cache` throws "incrementalCache missing" when there is no
    // request to hang a cache off — a background sweep, a CLI script, a unit
    // test. The answer is still knowable, it just costs a read: a link in a
    // recovery email must not fail to build because nobody was browsing.
    try {
      return await readLocaleRouting();
    } catch {
      return FALLBACK_LOCALE_ROUTING;
    }
  }
}

/**
 * Whether a cached read failed for want of a cache rather than of data. Only
 * then is a direct read worth trying: after a database failure it would just
 * wait out the same timeout a second time.
 */
function isWithoutRequestCache(error: unknown): boolean {
  return error instanceof Error && error.message.includes("incrementalCache missing");
}

/**
 * Server-side `toBrowserPath`: the address-bar form of a path, for `redirect`
 * targets, absolute URLs in email, and anywhere else the server has to print a
 * link. Accepts the app's `/${locale}/…` spelling as well as a locale-less one.
 */
export async function localeHref(
  locale: string,
  href: string,
): Promise<string> {
  const { storeDefault } = await getLocaleRouting();
  return toBrowserPath(href, { currentLocale: locale, storeDefault });
}
