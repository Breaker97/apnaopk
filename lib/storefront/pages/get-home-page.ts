import { unstable_cache } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { connectDB } from "@/lib/db";
import {
  getDefaultHomePageSettings,
  normalizeHomePageSettings,
} from "@/lib/site-config/home-page-config";
import { sanitizeSectionInstances } from "@/lib/storefront/sections/instances";
import type { SectionInstance } from "@/lib/storefront/sections/types";
import { getSettings } from "@/models/settings.model";
import { HOME_TEMPLATE_KEY, StorePage } from "@/models/store-page.model";
import { homePageSettingsToSections } from "./legacy-home";

interface HomePageSections {
  sections: SectionInstance[];
  /** Which store the sections came from — reported by the migration docs. */
  source: "page" | "legacy";
}

/** Fresh-install / total-failure shape: the defaults, mapped. */
export function getDefaultHomeSections(): SectionInstance[] {
  return homePageSettingsToSections(getDefaultHomePageSettings());
}

/**
 * The DRAFT home sections, for draft-mode preview. Uncached on purpose: the
 * whole point is seeing the edit that was saved a second ago. Falls back
 * like the live path so a store that has never saved a draft previews what
 * it currently shows.
 */
export async function getDraftHomeSections(): Promise<SectionInstance[]> {
  await connectDB();
  const page = await StorePage.findOne({ key: HOME_TEMPLATE_KEY })
    .select("draft published")
    .lean();
  if (page?.draft && Array.isArray(page.draft.sections)) {
    return sanitizeSectionInstances(page.draft.sections);
  }
  if (page?.published && Array.isArray(page.published.sections)) {
    return sanitizeSectionInstances(page.published.sections);
  }
  const settings = await getSettings();
  return homePageSettingsToSections(
    normalizeHomePageSettings(settings.homePage),
  );
}

/**
 * The home page's section list.
 *
 * A published StorePage wins; until the migration has produced one, the
 * legacy `settings.homePage` config is mapped on the fly, so an un-migrated
 * install keeps rendering its customized home unchanged. The settings tag is
 * therefore part of this entry's identity: while the legacy path is live,
 * the old Home builder still saves through the settings document and its
 * revalidation must reach us.
 *
 * A cached entry can predate a deploy that changed section shapes; that is
 * the renderer's problem, not this fetcher's — it re-normalizes every
 * instance against the current registry on each render.
 */
export const getHomePageSections = unstable_cache(
  async (): Promise<HomePageSections> => {
    await connectDB();

    const page = await StorePage.findOne({ key: HOME_TEMPLATE_KEY })
      .select("published")
      .lean();
    if (page?.published && Array.isArray(page.published.sections)) {
      return {
        sections: sanitizeSectionInstances(page.published.sections),
        source: "page",
      };
    }

    const settings = await getSettings();
    return {
      sections: homePageSettingsToSections(
        normalizeHomePageSettings(settings.homePage),
      ),
      source: "legacy",
    };
  },
  ["store-page-home"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.storePages, CACHE_TAGS.settings],
  },
);
