import { getTranslations } from "next-intl/server";
import {
  ProductSpecification,
  type ProductSpecificationRow,
} from "@/components/store/sections/product-specification";
import { sectionEmptyState } from "@/components/store/sections/section-empty-state";
import { lt } from "../localized";
import type { LocalizedText, SectionDefinition } from "../types";

/** How many rows a spec table may carry before it stops being a summary. */
const MAX_ROWS = 40;

function readRows(product: Record<string, unknown>): ProductSpecificationRow[] {
  const attributes = product.attributes;
  if (!Array.isArray(attributes)) return [];
  return attributes
    .flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) return [];
      const { name, value } = entry as { name?: unknown; value?: unknown };
      const label = typeof name === "string" ? name.trim() : "";
      const text = typeof value === "string" ? value.trim() : "";
      return label && text ? [{ name: label, value: text }] : [];
    })
    .slice(0, MAX_ROWS);
}

/**
 * The specification table as its own section.
 *
 * The data is the merchant's own `product.attributes` — the same rows the
 * product-main tabs render — so nothing new has to be entered for this to
 * fill in. Its value is placement: the Electronics design gives the spec a
 * full-width block of its own rather than a tab, and a merchant can reorder
 * or hide it like anything else on the page.
 *
 * A product with no attributes renders NOTHING on the live storefront (an
 * empty table reads as a broken page); in the admin preview it says why.
 */
export const productSpecification: SectionDefinition = {
  type: "product-specification",
  version: 1,
  category: "products",
  templates: ["product"],
  maxPerPage: 1,
  resourceType: "product",
  fields: [{ key: "title", type: "text", translatable: true, default: "" }],
  // ONE design (Figma 829-2420) — like product-main, the table's look is not
  // a per-instance choice; it styles itself from the theme's tokens.
  Render: renderSpecification,
};

async function renderSpecification({
  settings,
  ctx,
}: Parameters<SectionDefinition["Render"]>[0]) {
  const resource = ctx.resource;
  if (resource?.type !== "product") return null;

  const rows = readRows(resource.product);
  const custom = lt(
    settings.title as LocalizedText,
    ctx.locale,
    ctx.defaultLanguage,
  ).trim();
  // Falls back to the LOCALIZED storefront string, so the default template
  // reads correctly in every locale until a merchant types their own.
  const title =
    custom ||
    (await getTranslations({ locale: ctx.locale }))("product.specifications");

  if (rows.length === 0) {
    return sectionEmptyState(ctx, {
      title,
      hint: "Add specifications to this product to fill this table.",
    });
  }

  return <ProductSpecification title={title} rows={rows} />;
}
