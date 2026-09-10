import { unstable_cache } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { connectDB } from "@/lib/db";
import { sanitizeSectionInstances } from "@/lib/storefront/sections/instances";
import type { SectionInstance } from "@/lib/storefront/sections/types";
import { resolveActiveTheme } from "@/lib/storefront/themes/registry";
import { getSettings } from "@/models/settings.model";
import { StorePage } from "@/models/store-page.model";
import {
  buildDefaultGroupSections,
  buildDefaultTemplateSections,
  readLegacyGalleryLayout,
  type RenderableTemplateType,
} from "./default-templates";
import { buildGroupKey, buildTemplateKey, type StoreGroupType } from "./handles";

interface TemplateSections {
  sections: SectionInstance[];
  source: "page" | "default";
}

async function resolveDefaultSections(
  type: RenderableTemplateType,
): Promise<SectionInstance[]> {
  // Only the product default carries a seed: the retired theme-level
  // gallery setting keeps its effect until the first template publish.
  if (type === "product") {
    const settings = await getSettings();
    const theme = resolveActiveTheme(settings.onlineStore);
    return buildDefaultTemplateSections(type, {
      galleryLayout: readLegacyGalleryLayout(settings.onlineStore, theme.id),
    })!;
  }
  return buildDefaultTemplateSections(type)!;
}

/**
 * A template's section list — the home-page pattern, per template type: a
 * published StorePage wins; until one exists, the built-in default template
 * (the hand-wired page as sections) renders. The settings tag is part of
 * this entry's identity for the product default's legacy gallery read.
 */
export const getTemplateSections = unstable_cache(
  async (type: RenderableTemplateType): Promise<TemplateSections> => {
    await connectDB();

    const page = await StorePage.findOne({ key: buildTemplateKey(type) })
      .select("published")
      .lean();
    if (page?.published && Array.isArray(page.published.sections)) {
      return {
        sections: sanitizeSectionInstances(page.published.sections),
        source: "page",
      };
    }

    return { sections: await resolveDefaultSections(type), source: "default" };
  },
  ["store-page-template"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.storePages, CACHE_TAGS.settings],
  },
);

/**
 * A group's section list — same published-else-default contract as
 * templates. Rendered by the (store) layout on EVERY storefront page, so
 * it stays a single tagged cache entry per group.
 */
export const getGroupSections = unstable_cache(
  async (group: StoreGroupType): Promise<TemplateSections> => {
    await connectDB();

    const page = await StorePage.findOne({ key: buildGroupKey(group) })
      .select("published")
      .lean();
    if (page?.published && Array.isArray(page.published.sections)) {
      return {
        sections: sanitizeSectionInstances(page.published.sections),
        source: "page",
      };
    }
    return { sections: buildDefaultGroupSections(group), source: "default" };
  },
  ["store-page-group"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.storePages],
  },
);

/** DRAFT variant of a group for the /draft preview. Uncached on purpose. */
export async function getDraftGroupSections(
  group: StoreGroupType,
): Promise<SectionInstance[]> {
  await connectDB();
  const page = await StorePage.findOne({ key: buildGroupKey(group) })
    .select("draft published")
    .lean();
  if (page?.draft && Array.isArray(page.draft.sections)) {
    return sanitizeSectionInstances(page.draft.sections);
  }
  if (page?.published && Array.isArray(page.published.sections)) {
    return sanitizeSectionInstances(page.published.sections);
  }
  return buildDefaultGroupSections(group);
}

/** DRAFT variant for the /draft preview. Uncached on purpose. */
export async function getDraftTemplateSections(
  type: RenderableTemplateType,
): Promise<SectionInstance[]> {
  await connectDB();
  const page = await StorePage.findOne({ key: buildTemplateKey(type) })
    .select("draft published")
    .lean();
  if (page?.draft && Array.isArray(page.draft.sections)) {
    return sanitizeSectionInstances(page.draft.sections);
  }
  if (page?.published && Array.isArray(page.published.sections)) {
    return sanitizeSectionInstances(page.published.sections);
  }
  return resolveDefaultSections(type);
}
