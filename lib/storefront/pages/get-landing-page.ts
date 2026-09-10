import { unstable_cache } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { connectDB } from "@/lib/db";
import { sanitizeSectionInstances } from "@/lib/storefront/sections/instances";
import type {
  LocalizedText,
  SectionInstance,
} from "@/lib/storefront/sections/types";
import { buildLandingKey } from "@/lib/storefront/pages/handles";
import { StorePage } from "@/models/store-page.model";

interface LandingPageData {
  title: LocalizedText;
  sections: SectionInstance[];
}

/**
 * A landing page's PUBLISHED sections, cached per handle. Returns null when
 * no published landing page exists — the /pages/[handle] route then falls
 * back to the legacy custom content pages, which is also the migration path
 * for them.
 */
export const getLandingPage = unstable_cache(
  async (handle: string): Promise<LandingPageData | null> => {
    await connectDB();
    const page = await StorePage.findOne({ key: buildLandingKey(handle) })
      .select("title published")
      .lean();
    if (!page?.published || !Array.isArray(page.published.sections)) {
      return null;
    }
    return {
      title: (page.title as LocalizedText) ?? "",
      sections: sanitizeSectionInstances(page.published.sections),
    };
  },
  ["store-page-landing"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.storePages],
  },
);

/** DRAFT variant for draft-mode preview. Uncached on purpose. */
export async function getDraftLandingPage(
  handle: string,
): Promise<LandingPageData | null> {
  await connectDB();
  const page = await StorePage.findOne({ key: buildLandingKey(handle) })
    .select("title draft published")
    .lean();
  if (!page) return null;
  const sections = page.draft?.sections ?? page.published?.sections;
  if (!Array.isArray(sections)) return null;
  return {
    title: (page.title as LocalizedText) ?? "",
    sections: sanitizeSectionInstances(sections),
  };
}
