import "server-only";

import { getStorefrontProductBySlug } from "@/lib/products/storefront-product-detail";
import { getStorefrontProductCards } from "@/lib/products/storefront-product-cards";
import { getStorefrontProductFilters } from "@/lib/products/storefront-product-filters";
import type { RenderableTemplateType } from "@/lib/storefront/pages/default-templates";
import { getDraftHomeSections } from "@/lib/storefront/pages/get-home-page";
import { getDraftLandingPage } from "@/lib/storefront/pages/get-landing-page";
import { getDraftTemplateSections } from "@/lib/storefront/pages/get-template";
import { isValidPageHandle } from "@/lib/storefront/pages/handles";
import type {
  CollectionTemplateResource,
  SectionInstance,
  SectionRenderContext,
  TemplateResource,
} from "@/lib/storefront/sections/types";
import { getStorefrontCategoryBySlug } from "@/lib/storefront/storefront-categories";
import { getStorefrontCollectionDetail } from "@/lib/storefront/storefront-collections";

type DraftQuery = { [key: string]: string | string[] | undefined };

const RENDERABLE_TEMPLATE_TYPES: RenderableTemplateType[] = [
  "product",
  "products",
  "category",
  "collection",
  "cart",
];

function isRenderableTemplateType(
  value: string,
): value is RenderableTemplateType {
  return (RENDERABLE_TEMPLATE_TYPES as string[]).includes(value);
}

/**
 * The resource a template preview renders against: the product/category/
 * collection named in the query, else the first one the storefront would
 * list, so a template always has something real to draw.
 */
async function resolveSampleResource(
  type: RenderableTemplateType,
  query: DraftQuery,
): Promise<{ resource?: TemplateResource; livePath?: string }> {
  if (type === "cart") {
    return { resource: { type: "cart" }, livePath: "/cart" };
  }
  if (type === "products") {
    return {
      resource: { type: "products", searchParams: {}, location: {} },
      livePath: "/products",
    };
  }
  if (type === "product") {
    const requested =
      typeof query.product === "string" ? query.product : undefined;
    let product = requested
      ? await getStorefrontProductBySlug(requested)
      : null;
    if (!product) {
      const [card] = await getStorefrontProductCards({ limit: 1 });
      if (card?.slug) product = await getStorefrontProductBySlug(card.slug);
    }
    if (!product) return {};
    return {
      resource: { type: "product", product, location: {} },
      livePath: `/products/${product.slug}`,
    };
  }
  if (type === "category") {
    let slug = typeof query.category === "string" ? query.category : undefined;
    if (!slug) {
      const { categories } = await getStorefrontProductFilters();
      slug = categories[0]?.slug;
    }
    const category = slug ? await getStorefrontCategoryBySlug(slug) : null;
    if (!category) return {};
    return {
      resource: {
        type: "category",
        category,
        searchParams: {},
        location: {},
      },
      livePath: `/categories/${category.slug}`,
    };
  }
  let slug =
    typeof query.collection === "string" ? query.collection : undefined;
  if (!slug) {
    const { collections } = await getStorefrontProductFilters();
    slug = collections[0]?.slug;
  }
  const data = slug
    ? await getStorefrontCollectionDetail({ slug, page: 1, limit: 24 })
    : null;
  if (!data) return {};
  const detail = data as unknown as Pick<
    CollectionTemplateResource,
    "collection" | "products" | "pagination"
  >;
  return {
    resource: {
      type: "collection",
      collection: detail.collection,
      products: detail.products,
      pagination: detail.pagination,
      searchParams: {},
      location: {},
    },
    livePath: `/collections/${detail.collection.slug}`,
  };
}

interface DraftPage {
  sections: SectionInstance[];
  ctx: SectionRenderContext;
  /** The live URL this draft stands in for, locale-less. */
  livePath: string;
}

/**
 * The draft of a page-shaped surface — the home template, another template
 * (`template/<type>`) or a landing page (`<handle>`) — plus the render
 * context its sections expect. Chrome groups are not pages and are handled
 * by the /draft route itself. `null` when the handle does not resolve.
 */
export async function resolveDraftPage(
  handleParts: string[] | undefined,
  query: DraftQuery,
  baseCtx: SectionRenderContext,
): Promise<DraftPage | null> {
  if (handleParts?.[0] === "template") {
    const type = handleParts[1];
    if (handleParts.length !== 2 || !isRenderableTemplateType(type)) {
      return null;
    }
    const [sections, sample] = await Promise.all([
      getDraftTemplateSections(type),
      resolveSampleResource(type, query),
    ]);
    return {
      sections,
      ctx: {
        ...baseCtx,
        templateType: type,
        ...(sample.resource ? { resource: sample.resource } : {}),
      },
      livePath: sample.livePath ?? "/",
    };
  }
  if (handleParts?.length) {
    const handle = handleParts[0];
    if (handleParts.length > 1 || !isValidPageHandle(handle)) return null;
    const landing = await getDraftLandingPage(handle);
    if (!landing) return null;
    return { sections: landing.sections, ctx: baseCtx, livePath: `/pages/${handle}` };
  }
  return {
    sections: await getDraftHomeSections(),
    ctx: { ...baseCtx, templateType: "home" },
    livePath: "/",
  };
}

/**
 * ONE section of a draft, optionally narrowed to ONE of its blocks — what a
 * builder row's preview frame shows. Filtering the block list rather than
 * adding a bespoke render keeps the frame showing the real component: a
 * per-row preview is the section itself, with one block.
 */
export function pickPreviewSection(
  sections: SectionInstance[],
  sectionId: string,
  blockId: string,
): SectionInstance[] {
  return sections
    .filter((section) => section.id === sectionId)
    .map((section) =>
      blockId && section.blocks
        ? {
            ...section,
            blocks: section.blocks.filter((block) => block.id === blockId),
          }
        : section,
    );
}
