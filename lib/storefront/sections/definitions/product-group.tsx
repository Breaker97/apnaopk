import { ProductGroup } from "@/components/store/sections/product-group";
import {
  PRODUCT_GROUP_SOURCES,
  type ProductGroupSource,
} from "@/lib/storefront/sections/product-group-query";
import { NewArrivalsSkeleton } from "@/components/store/home-section-skeletons";
import {
  NEW_ARRIVALS_COLUMNS_MAX,
  NEW_ARRIVALS_COLUMNS_MIN,
  NEW_ARRIVALS_LIMIT_MAX,
  NEW_ARRIVALS_LIMIT_MIN,
} from "@/lib/site-config/home-page-config";
import { lt } from "../localized";
import {
  isProductTargetUnpicked,
  productSourceTargetFields,
} from "../product-source";
import type {
  LocalizedText,
  SectionDefinition,
  SectionRenderProps,
} from "../types";

/** A setting read as a string, or "" — what a tab's id settings hold. */
function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function props({ settings, blocks, ctx }: SectionRenderProps) {
  return {
    locale: ctx.locale,
    preview: ctx.preview,
    title: lt(settings.title as LocalizedText, ctx.locale, ctx.defaultLanguage),
    limit: settings.limit as number,
    desktopColumns: settings.desktopColumns as number,
    // A vendor's landing page: the store's own products in every tab.
    vendor: ctx.vendor,
    tabs: blocks
      .filter((block) => block.visible)
      .map((block) => ({
        id: block.id,
        label: lt(block.settings.label as LocalizedText, ctx.locale, ctx.defaultLanguage),
        source: block.settings.source as ProductGroupSource,
        productIds: block.settings.productIds as string[],
        categoryId: str(block.settings.categoryId),
        brandId: str(block.settings.brandId),
        collectionId: str(block.settings.collectionId),
      })),
  };
}

/** The original arrangement: heading left, tab rail right. */
const standard: SectionDefinition["Render"] = (renderProps) => (
  <ProductGroup {...props(renderProps)} appearance="standard" />
);

/** Centred two-tone heading over a centred pill rail — the Figma pattern. */
const centered: SectionDefinition["Render"] = (renderProps) => (
  <ProductGroup {...props(renderProps)} appearance="centered" />
);

const Skeleton: SectionDefinition["Skeleton"] = ({ settings }) => (
  <NewArrivalsSkeleton desktopColumns={(settings.desktopColumns as number) || 4} />
);

/** Tabbed product shelves — the Figma "Best Selling" pattern. */
export const productGroup: SectionDefinition = {
  type: "product-group",
  version: 1,
  category: "products",
  // FIRST entry is the default every existing document falls back to — never
  // reorder this list, only append.
  variants: [
    { key: "standard", name: "Heading + side tabs", Render: standard, Skeleton },
    { key: "centered", name: "Centered tabs", Render: centered, Skeleton },
  ],
  fields: [
    // A short heading: shares its row with the two numbers beside it.
    {
      key: "title",
      type: "text",
      translatable: true,
      default: "Best Selling",
      width: "third",
    },
    // How many products each tab pulls, and how many share the visible row
    // on desktop — same knobs, same bounds as the product-grid section.
    {
      key: "limit",
      type: "number",
      default: 8,
      min: NEW_ARRIVALS_LIMIT_MIN,
      max: NEW_ARRIVALS_LIMIT_MAX,
    },
    {
      key: "desktopColumns",
      type: "number",
      default: 4,
      min: NEW_ARRIVALS_COLUMNS_MIN,
      max: NEW_ARRIVALS_COLUMNS_MAX,
    },
  ],
  blocks: [
    {
      type: "tab",
      max: 5,
      fields: [
        {
          key: "label",
          type: "text",
          translatable: true,
          default: "",
          width: "half",
        },
        {
          key: "source",
          type: "select",
          options: PRODUCT_GROUP_SOURCES,
          default: "latest",
          width: "half",
        },
        // Each tab's own pick — a tab of a category, another of a brand.
        ...productSourceTargetFields(),
        {
          key: "productIds",
          type: "productList",
          hint: "Drag to set the order the products appear in.",
          showWhen: { key: "source", values: ["manual"] },
        },
      ],
    },
  ],
  starter: {
    blocks: [
      { type: "tab", settings: { label: "New", source: "latest" } },
      { type: "tab", settings: { label: "On Sale", source: "discounted" } },
    ],
  },
  // No tab that can fill: none visible, or only hand-picked ones with no
  // products picked and category, brand or collection ones with nothing
  // picked. ProductGroup draws nothing then.
  isEmpty: ({ blocks }) =>
    !blocks.some(
      (block) =>
        block.visible &&
        !isProductTargetUnpicked(block.settings) &&
        (block.settings.source !== "manual" ||
          (Array.isArray(block.settings.productIds) &&
            block.settings.productIds.some(Boolean))),
    ),
  Render: standard,
  Skeleton,
};
