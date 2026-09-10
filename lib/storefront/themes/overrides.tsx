import "server-only";

import { ElectronicsCartLazy } from "@/components/store/sections/themes/electronics-cart-lazy";
import {
  ElectronicsCategoryHeader,
  ElectronicsCategoryMain,
} from "@/components/store/sections/themes/electronics-category-detail";
import { ElectronicsProductsListing } from "@/components/store/sections/themes/electronics-products-listing";
import { ElectronicsServiceBenefits } from "@/components/store/sections/themes/electronics-service-benefits";
import { LuxeTestimonials } from "@/components/store/sections/themes/luxe-testimonials";
import { lt } from "@/lib/storefront/sections/localized";
import type {
  LocalizedText,
  SectionDefinition,
} from "@/lib/storefront/sections/types";
import { getActiveThemeManifest } from "./registry";

type SectionRender = SectionDefinition["Render"];

/**
 * Targeted per-theme section renderers. An override receives exactly the
 * props the base Render does — same normalized settings, same blocks, same
 * contract — so a document renders under every theme and switching is
 * always content-preserving. Types without an override resolve through the
 * manifest's `extends` chain down to the base library.
 *
 * Overrides restyle and rearrange, but they never read a setting the base
 * ignores — that would make content theme-dependent, which is the one thing
 * this engine refuses.
 *
 * Reach for an override only when the difference is NOT a choice a merchant
 * should be able to make. A design they might reasonably want under any
 * theme belongs in `SectionDefinition.variants` instead — stored on the
 * instance, offered in the inspector, and resolved BEFORE this file.
 */
const THEME_OVERRIDES: Record<
  string,
  Partial<Record<string, SectionRender>>
> = {
  electronics: {
    // No product-main override: the Minimal buy box (Figma 774:4992) is THE
    // product page under every theme — it styles itself from theme tokens.
    "cart-main": ({ ctx }) => {
      // Same guard as the base section: the skin differs, the contract
      // doesn't. All state is shared via `useCartPageState`.
      if (ctx.resource?.type !== "cart") return null;
      return <ElectronicsCartLazy />;
    },
    "category-header": ({ ctx }) => {
      const resource = ctx.resource;
      if (resource?.type !== "category") return null;
      return (
        <ElectronicsCategoryHeader locale={ctx.locale} resource={resource} />
      );
    },
    "category-main": ({ ctx }) => {
      const resource = ctx.resource;
      if (resource?.type !== "category") return null;
      return (
        <ElectronicsCategoryMain locale={ctx.locale} resource={resource} />
      );
    },
    "products-main": ({ settings, ctx }) => {
      const resource = ctx.resource;
      if (resource?.type !== "products") return null;
      return (
        <ElectronicsProductsListing
          locale={ctx.locale}
          // The base section's one setting, resolved the way the base
          // resolves it — an override may rearrange, never read more.
          heading={lt(
            settings.heading as LocalizedText,
            ctx.locale,
            ctx.defaultLanguage,
          ).trim()}
          resource={resource}
        />
      );
    },
    "service-benefits": ({ blocks, ctx }) => (
      <ElectronicsServiceBenefits
        items={blocks
          .filter((block) => block.visible)
          .map((block) => ({
            id: block.id,
            icon: block.settings.icon as string,
            title: lt(block.settings.title as LocalizedText, ctx.locale, ctx.defaultLanguage),
            text: lt(block.settings.text as LocalizedText, ctx.locale, ctx.defaultLanguage),
          }))}
      />
    ),
  },
  luxe: {
    testimonials: ({ settings, ctx }) => (
      <LuxeTestimonials
        locale={ctx.locale}
        title={lt(settings.title as LocalizedText, ctx.locale, ctx.defaultLanguage)}
        minRating={settings.minRating as number}
        limit={settings.limit as number}
      />
    ),
  },
};

/** Walk theme → extends chain → base Render. Cycles are impossible: the
 * chain is authored in the manifests and capped defensively anyway. */
export function resolveSectionRender(
  themeId: string,
  def: SectionDefinition,
): SectionRender {
  // The id is walked RAW, deliberately. Callers always pass an id that
  // `resolveActiveTheme` already settled, so there is nothing to normalize —
  // and normalizing here would tie override lookup to manifest STATUS, which
  // would cut a theme parked as `coming-soon` off from its own overrides
  // while it waits for its next version.
  let currentId: string | undefined = themeId;
  for (let depth = 0; currentId && depth < 4; depth += 1) {
    const override = THEME_OVERRIDES[currentId]?.[def.type];
    if (override) return override;
    currentId = getActiveThemeManifest(currentId).extends;
  }
  return def.Render;
}

/** Section types this theme (or one it extends) renders its own way. */
export function getThemeOverriddenTypes(themeId: string): string[] {
  const types = new Set<string>();
  let currentId: string | undefined = themeId;
  for (let depth = 0; currentId && depth < 4; depth += 1) {
    for (const type of Object.keys(THEME_OVERRIDES[currentId] ?? {})) {
      types.add(type);
    }
    currentId = getActiveThemeManifest(currentId).extends;
  }
  return [...types];
}
