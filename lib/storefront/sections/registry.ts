import "server-only";

import {
  SECTION_TITLE_SIZE_OPTIONS,
  THEME_VARIANT_KEY,
  TITLE_SIZE_FIELD_KEY,
  VARIANT_FIELD_KEY,
} from "./types";
import type { SectionDefinition, SectionVariant } from "./types";
import { slideshow } from "./definitions/slideshow";
import { categoryList } from "./definitions/category-list";
import { productGrid } from "./definitions/product-grid";
import { productBrowser } from "./definitions/product-browser";
import { productGroup } from "./definitions/product-group";
import { promotionGrid } from "./definitions/promotion-grid";
import { promotionBanner } from "./definitions/promotion-banner";
import { countdownOffer } from "./definitions/countdown-offer";
import { couponBanner } from "./definitions/coupon-banner";
import { featuredCollection } from "./definitions/featured-collection";
import { getTheLook } from "./definitions/get-the-look";
import { looksList } from "./definitions/looks-list";
import { collectionList } from "./definitions/collection-list";
import { brandList } from "./definitions/brand-list";
import { categoryMosaic } from "./definitions/category-mosaic";
import { imageText } from "./definitions/image-text";
import { richText } from "./definitions/rich-text";
import { heading } from "./definitions/heading";
import { gap } from "./definitions/gap";
import { testimonials } from "./definitions/testimonials";
import { serviceBenefits } from "./definitions/service-benefits";
import { faq } from "./definitions/faq";
import { sponsoredRail } from "./definitions/sponsored-rail";
import { vendorList } from "./definitions/vendor-list";
import { becomeVendor } from "./definitions/become-vendor";
import { blogPosts } from "./definitions/blog-posts";
import { imageGallery } from "./definitions/image-gallery";
import { productMain } from "./definitions/product-main";
import { productRelated } from "./definitions/product-related";
import { productReviews } from "./definitions/product-reviews";
import { productSpecification } from "./definitions/product-specification";
import { productSponsored } from "./definitions/product-sponsored";
import { productsMain } from "./definitions/products-main";
import { categoryHeader, categoryMain } from "./definitions/category-main";
import {
  collectionHeader,
  collectionMain,
} from "./definitions/collection-main";
import { cartMain } from "./definitions/cart-main";
import {
  announcementBar,
  footerBar,
  headerBar,
  topTags,
} from "./definitions/header-group";

/**
 * The section catalog. Server-only on purpose: definitions carry async
 * server components, so nothing on the client may import this module — the
 * editor consumes serialized metadata via the catalog module instead.
 */
const DEFINITIONS: SectionDefinition[] = [
  slideshow,
  promotionBanner,
  promotionGrid,
  countdownOffer,
  couponBanner,
  productGrid,
  productBrowser,
  productGroup,
  featuredCollection,
  getTheLook,
  looksList,
  sponsoredRail,
  categoryList,
  categoryMosaic,
  collectionList,
  brandList,
  imageText,
  richText,
  heading,
  gap,
  imageGallery,
  blogPosts,
  testimonials,
  serviceBenefits,
  faq,
  vendorList,
  becomeVendor,
  // Template-bound sections (P6/P7) — their `templates` lists keep them off
  // every other surface.
  productMain,
  productSpecification,
  productReviews,
  productSponsored,
  productRelated,
  productsMain,
  categoryHeader,
  categoryMain,
  collectionHeader,
  collectionMain,
  cartMain,
  // Header/footer group sections (P8) — zone-bound, never on page bodies.
  headerBar,
  footerBar,
  announcementBar,
  topTags,
];

/**
 * Turn a definition's `variants` into the `variant` select that carries the
 * choice. Derived rather than hand-written so the two can never disagree:
 * the options ARE the variant keys, and the default IS the first one — which
 * is why the first entry must stay the design already-stored documents show.
 */
function withVariantField(definition: SectionDefinition): SectionDefinition {
  if (!definition.variants?.length) {
    const scoped = [
      ...definition.fields,
      ...(definition.blocks ?? []).flatMap((block) => block.fields),
    ].find((field) => field.variants?.length);
    if (scoped) {
      throw new Error(
        `Section "${definition.type}" scopes field "${scoped.key}" to a variant but declares none`,
      );
    }
    if (definition.designFollowsTheme) {
      throw new Error(
        `Section "${definition.type}" follows the template's design but declares no designs`,
      );
    }
    return definition;
  }
  if (definition.fields.some((field) => field.key === VARIANT_FIELD_KEY)) {
    throw new Error(
      `Section "${definition.type}" declares variants and a "${VARIANT_FIELD_KEY}" field — the registry derives that field`,
    );
  }
  const keys = definition.variants.map((variant) => variant.key);
  if (new Set(keys).size !== keys.length) {
    throw new Error(`Section "${definition.type}" has duplicate variant keys`);
  }
  // "theme" is the reserved "follow the template" value; a design called that
  // could never be pinned, because the resolver would read it as the template.
  if (keys.includes(THEME_VARIANT_KEY)) {
    throw new Error(
      `Section "${definition.type}" names a design "${THEME_VARIANT_KEY}", which is reserved`,
    );
  }
  // A field scoped to a variant that does not exist would simply never show
  // — a typo that reads as "the editor lost my control", so fail the build.
  for (const field of [
    ...definition.fields,
    ...(definition.blocks ?? []).flatMap((block) => block.fields),
  ]) {
    for (const scope of field.variants ?? []) {
      if (!keys.includes(scope)) {
        throw new Error(
          `Section "${definition.type}" scopes field "${field.key}" to unknown variant "${scope}"`,
        );
      }
    }
  }
  return {
    ...definition,
    fields: [
      ...definition.fields,
      {
        key: VARIANT_FIELD_KEY,
        type: "select",
        // A section that follows the template leads with "theme", so every
        // document stored before it had designs keeps following the template.
        options: definition.designFollowsTheme ? [THEME_VARIANT_KEY, ...keys] : keys,
        default: definition.designFollowsTheme ? THEME_VARIANT_KEY : keys[0],
      },
    ],
  };
}

/**
 * Give every section that shows a title the same size control.
 *
 * Derived rather than declared on each definition: twenty sections carry a
 * title, and a control a merchant meets on some blocks and not others reads
 * as a bug in the ones missing it. A section that owns its heading outright
 * (the standalone Heading block) declares its own `size` and is left alone.
 */
function withTitleSizeField(definition: SectionDefinition): SectionDefinition {
  // The three names a section's own headline goes by. "offer" is the coupon
  // banner's: the same line, named for what it says.
  const TITLE_KEYS = ["title", "heading", "offer"];
  const carriesTitle = definition.fields.some(
    (field) =>
      TITLE_KEYS.includes(field.key) &&
      (field.type === "text" || field.type === "textarea"),
  );
  const ownsSize = definition.fields.some(
    (field) => field.key === "size" || field.key === TITLE_SIZE_FIELD_KEY,
  );
  if (!carriesTitle || ownsSize) return definition;

  return {
    ...definition,
    fields: [
      ...definition.fields,
      {
        key: TITLE_SIZE_FIELD_KEY,
        type: "select",
        options: SECTION_TITLE_SIZE_OPTIONS,
        // "default" is the heading's own size, so adding this control
        // changes nothing until a merchant picks a step.
        default: "default",
        width: "third",
      },
    ],
  };
}

/**
 * The design a stored instance renders.
 *
 * A design key stored on the instance always wins — it is the merchant's
 * pin. Otherwise a section that follows the template takes the design the
 * active template names (`preferredVariants`, passed in by the renderer), and
 * everything else falls back to the first design.
 */
export function resolveSectionVariant(
  def: SectionDefinition,
  settings: Record<string, unknown>,
  preferredVariants?: Readonly<Record<string, string>>,
): SectionVariant | undefined {
  if (!def.variants?.length) return undefined;
  const key = settings[VARIANT_FIELD_KEY];
  const pinned = def.variants.find((variant) => variant.key === key);
  if (pinned) return pinned;
  if (def.designFollowsTheme) {
    const preferred = preferredVariants?.[def.type];
    return (
      def.variants.find((variant) => variant.key === preferred) ??
      def.variants[0]
    );
  }
  return def.variants[0];
}

function buildRegistry(): ReadonlyMap<string, SectionDefinition> {
  const registry = new Map<string, SectionDefinition>();
  for (const raw of DEFINITIONS) {
    const definition = withTitleSizeField(withVariantField(raw));
    if (registry.has(definition.type)) {
      throw new Error(`Duplicate section type registered: ${definition.type}`);
    }
    // Placement-contract invariants, enforced at boot so a bad definition
    // fails the deploy, not an admin's save:
    // - `required` needs a placement restriction (templates or a non-body
    //   zone) — otherwise it would be mandatory on every surface including
    //   landing pages, which is never meant and always a typo.
    // - a required section that can be deleted is a contradiction.
    const zoneRestricted =
      definition.zones?.length && !definition.zones.includes("template");
    if (definition.required && !definition.templates?.length && !zoneRestricted) {
      throw new Error(
        `Section "${definition.type}" is required but lists no templates or restricted zones`,
      );
    }
    if (definition.required && !definition.locked) {
      throw new Error(
        `Section "${definition.type}" is required and must therefore be locked`,
      );
    }
    registry.set(definition.type, definition);
  }
  return registry;
}

export const SECTION_REGISTRY = buildRegistry();

/** Unknown types return undefined; the renderer skips them (forward compat). */
export function getSectionDefinition(
  type: string,
): SectionDefinition | undefined {
  return SECTION_REGISTRY.get(type);
}
