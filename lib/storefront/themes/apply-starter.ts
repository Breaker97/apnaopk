import "server-only";

import {
  CACHE_TAGS,
  revalidateCacheTags,
  revalidateLocalizedPaths,
  revalidateSettingsContent,
} from "@/lib/cache-invalidation";
import {
  prepareSectionsForWrite,
  SectionWriteError,
} from "@/lib/storefront/sections/write";
import {
  buildGroupKey,
  buildTemplateKey,
  type StoreGroupType,
  type StoreTemplateType,
} from "@/lib/storefront/pages/handles";
import {
  buildPublishState,
  sectionsEqual,
} from "@/lib/storefront/pages/lifecycle";
import { resolvePresetContent } from "@/lib/storefront/themes/preset-content";
import type { ThemeManifest } from "@/lib/storefront/themes/types";
import type { SectionInstance } from "@/lib/storefront/sections/types";
import {
  getDefaultProductCardConfig,
  isUntouchedProductCardConfig,
  normalizeProductCardConfig,
  PRODUCT_CARD_TEMPLATES,
} from "@/lib/products/product-card-config";
import { Settings } from "@/models/settings.model";
import { buildStorePageIdentity, StorePage } from "@/models/store-page.model";

/** How far an activation carries the theme's starter — see the route doc. */
export type StarterMode = "keep" | "draft" | "publish";

interface ApplyStarterResult {
  seededTemplates: string[];
  draftedTemplates: string[];
  publishedTemplates: string[];
}

/**
 * Activate a theme: seed/draft/publish its starter surfaces and flip the
 * active id. Extracted from the admin activation route UNCHANGED so the
 * install wizard applies a template through the exact same rules — binder
 * fill, write-gate validation, the no-op publish guard, revalidation.
 * `actorId` stamps draft/published authorship ("install" for the wizard).
 */
export async function applyThemeStarter(
  manifest: ThemeManifest,
  mode: StarterMode,
  actorId: string,
): Promise<ApplyStarterResult> {
    // Seed FIRST, switch second: if seeding blows up, the theme has not
    // flipped underneath the admin's feet and the gallery stays truthful.
    // The upsert with $setOnInsert makes the fresh-install check race-safe —
    // two concurrent activations cannot throw a duplicate-key, and an
    // EXISTING page is never touched (nothing outside $setOnInsert).
    const seededTemplates: string[] = [];
    const draftedTemplates: string[] = [];
    const publishedTemplates: string[] = [];
    const templatePresets = manifest.presets?.templates ?? {};
    const groupPresets = manifest.presets?.groups ?? {};

    // Every surface the theme has a design for. Chrome groups ride the same
    // path as templates: a theme that changes the page but leaves the old
    // announcement bar and header in place has not really been applied.
    const surfaces: {
      label: string;
      key: string;
      title: string;
      preset: SectionInstance[];
      templateType?: StoreTemplateType;
      zone?: StoreGroupType;
    }[] = [
      ...Object.entries(templatePresets).flatMap(([type, preset]) =>
        preset
          ? [
              {
                label: type,
                key: buildTemplateKey(type as StoreTemplateType),
                title: type.charAt(0).toUpperCase() + type.slice(1),
                preset,
                templateType: type as StoreTemplateType,
              },
            ]
          : [],
      ),
      ...Object.entries(groupPresets).flatMap(([group, preset]) =>
        preset
          ? [
              {
                label: `${group} group`,
                key: buildGroupKey(group as StoreGroupType),
                title: group.charAt(0).toUpperCase() + group.slice(1),
                preset,
                zone: group as StoreGroupType,
              },
            ]
          : [],
      ),
    ];

    // Bind the starter's collection/product slots to what this store
    // actually has, ONCE for the whole activation — an unbound shelf renders
    // nothing, which is what made a freshly applied starter look half-built.
    // In "keep" mode over a fully-installed store every write is a no-op,
    // so skip the catalogue reads entirely. (Template/group pages have no
    // delete API, so a key that exists at this check still exists later.)
    let content: Awaited<ReturnType<typeof resolvePresetContent>> | null = null;
    if (surfaces.length > 0) {
      const willWrite =
        mode !== "keep" ||
        (await StorePage.countDocuments({
          key: { $in: surfaces.map((surface) => surface.key) },
        })) < surfaces.length;
      if (willWrite) content = await resolvePresetContent();
    }

    for (const surface of surfaces) {
      const { key, preset, templateType, zone } = surface;
      let sections: SectionInstance[];
      try {
        sections = prepareSectionsForWrite(
          content ? content.fill(preset) : preset,
          { templateType, zone },
        );
      } catch (error) {
        // A preset failing its own write validation is a product bug, not a
        // reason to fail the switch; activate without the seed — but say so,
        // or a buyer gets an empty starter and no way to know why.
        if (!(error instanceof SectionWriteError)) throw error;
        console.error(
          `[theme:${manifest.id}] "${surface.label}" preset failed validation and was skipped: ${error.message}`,
        );
        continue;
      }

      const now = new Date();
      const draft = { sections, updatedAt: now, updatedBy: actorId };

      const result = await StorePage.updateOne(
        { key },
        {
          $setOnInsert: {
            ...buildStorePageIdentity(key),
            title: surface.title,
            draft,
            published: null,
            history: [],
          },
        },
        { upsert: true },
      );
      const seeded = result.upsertedCount > 0;
      if (seeded) seededTemplates.push(surface.label);

      // The page already existed: replace its DRAFT on the admin's explicit
      // say-so. Published state and history stay untouched, so Discard
      // restores the previous layout in one click.
      if (!seeded && mode !== "keep") {
        await StorePage.updateOne({ key }, { $set: { draft } });
      }
      if (seeded || mode !== "keep") draftedTemplates.push(surface.label);

      if (mode === "publish") {
        // Publish the starter the same way the builder does: the layout it
        // replaces moves to the front of version history, so "put my old
        // home back" stays one restore away.
        const doc = await StorePage.findOne({ key })
          .select("published history")
          .lean();
        // No-op guard: templates SHARE chrome presets (Classic and Fashion
        // ship the same plain bars), and history holds only 10 snapshots per
        // surface — re-publishing an identical layout would spend the
        // merchant's rollback depth on nothing. Skip; the draft above
        // already equals published, so the builder reads clean.
        if (
          doc?.published &&
          Array.isArray(doc.published.sections) &&
          sectionsEqual(sections, doc.published.sections)
        ) {
          continue;
        }
        const state = buildPublishState(
          sections,
          doc?.published && Array.isArray(doc.published.sections)
            ? {
                sections: doc.published.sections as SectionInstance[],
                publishedAt: doc.published.publishedAt,
                publishedBy: doc.published.publishedBy,
              }
            : null,
          (doc?.history ?? []) as {
            sections: SectionInstance[];
            publishedAt?: Date;
            publishedBy?: string;
          }[],
          actorId,
          now,
        );
        await StorePage.updateOne(
          { key },
          {
            $set: {
              published: state.published,
              history: state.history,
              "draft.sections": sections,
            },
          },
        );
        publishedTemplates.push(surface.label);
      }
    }

    // The theme's product card rides with it: every listing renders the ONE
    // configurator card, so a theme designed around a particular card
    // (Electronics) must seed it or its grids arrive in the wrong design.
    // A card the merchant customized is theirs — it survives a "keep"
    // switch and is replaced only when they asked for the starter.
    const current = await Settings.findOne({}).select("productCard").lean();
    const storedCard = normalizeProductCardConfig(current?.productCard);
    const cardTemplate = manifest.productCard
      ? PRODUCT_CARD_TEMPLATES[manifest.productCard]
      : getDefaultProductCardConfig();
    const reseedCard =
      mode !== "keep" ||
      !current?.productCard ||
      isUntouchedProductCardConfig(storedCard);

    await Settings.updateOne(
      {},
      {
        $set: {
          "onlineStore.activeTheme": manifest.id,
          ...(reseedCard ? { productCard: cardTemplate } : {}),
        },
      },
    );

    revalidateSettingsContent();
    revalidateCacheTags([CACHE_TAGS.storePages]);
    if (publishedTemplates.length > 0) {
      // Fixed-path surfaces are the ones that can be statically cached; the
      // per-resource templates refresh through the storePages tag above.
      const paths = publishedTemplates
        .map((label) => ({ home: "/", products: "/products", cart: "/cart" })[
          label
        ])
        .filter((path): path is string => Boolean(path));
      // Chrome renders on EVERY page; the tag reaches the layout's fetcher
      // and "/" covers the most-cached entry point.
      if (publishedTemplates.some((label) => label.endsWith(" group"))) {
        paths.push("/");
      }
      if (paths.length > 0) revalidateLocalizedPaths([...new Set(paths)]);
    }
    return { seededTemplates, draftedTemplates, publishedTemplates };
}
