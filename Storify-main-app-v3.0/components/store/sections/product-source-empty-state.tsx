import { getTranslations } from "next-intl/server";
import { type Locale } from "@/config/i18n.config";
import type { ProductSourceMissing } from "@/lib/storefront/section-data/product-source";
import {
  isProductTargetSource,
  type ProductTargetSource,
} from "@/lib/storefront/sections/product-source";
import type { SectionRenderContext } from "@/lib/storefront/sections/types";
import { sectionEmptyState } from "./section-empty-state";

/**
 * Why a product shelf with a picked category, brand or collection shows
 * nothing — in the builder's preview only. The live storefront hides the
 * shelf (or the tab) instead, as it hides every section with nothing to
 * show; the preview names the reason, so a merchant can tell a pick still
 * to make from a pick that was deleted or has no products.
 */

type Translate = (key: string, fallback: string, values?: Record<string, string>) => string;

const TITLES: Record<ProductTargetSource, string> = {
  category: "Category products",
  brand: "Brand products",
  collection: "Collection products",
};

const REASONS: Record<ProductSourceMissing, Record<ProductTargetSource, string>> = {
  unpicked: {
    category:
      "Pick a category for this section. It shows the category's products and those of every category below it.",
    brand: "Pick a brand for this section.",
    collection: "Pick a collection for this section.",
  },
  unavailable: {
    category: "The picked category was deleted or is switched off. Pick another one.",
    brand:
      "The picked brand was deleted, archived, switched off or is not approved. Pick another one.",
    collection:
      "The picked collection was deleted, is a draft, or is not published to the online store. Pick another one.",
  },
  empty: {
    category:
      "Neither the picked category nor any category below it has products to show yet.",
    brand: "The picked brand has no products to show yet.",
    collection: "The picked collection has no products to show yet.",
  },
};

async function translator(locale: Locale): Promise<Translate> {
  const t = await getTranslations({ locale });
  return (key, fallback, values) =>
    t.has(key) ? t(key, values) : fallback.replace(/\{(\w+)\}/g, (_, name) => values?.[name] ?? "");
}

function reasonText(tf: Translate, source: ProductTargetSource, missing: ProductSourceMissing) {
  return tf(
    `home.productSourcePreview.${missing}.${source}`,
    REASONS[missing][source],
  );
}

/** The preview's outline for a product shelf whose picked source gives it nothing. */
export async function productSourceEmptyState(
  ctx: Pick<SectionRenderContext, "preview">,
  options: { locale: Locale; source: ProductTargetSource; missing: ProductSourceMissing },
) {
  if (!ctx.preview) return null;
  const tf = await translator(options.locale);
  return sectionEmptyState(ctx, {
    title: tf(
      `home.productSourcePreview.title.${options.source}`,
      TITLES[options.source],
    ),
    hint: `${reasonText(tf, options.source, options.missing)} ${tf(
      "home.productSourcePreview.hiddenSection",
      "Shoppers don't see this section until it has products.",
    )}`,
  });
}

/**
 * The preview's outline for the tabs of a tabbed shelf whose picked
 * category, brand or collection gives them nothing, and why. Null when there
 * is nothing to say.
 */
export async function productTabsEmptyState(
  ctx: Pick<SectionRenderContext, "preview">,
  options: {
    locale: Locale;
    hidden: { label: string; source: string; missing: ProductSourceMissing }[];
    /** Whether any tab still shows: the outline then names only the hidden ones. */
    someShown: boolean;
  },
) {
  const hidden = options.hidden.filter(({ source }) => isProductTargetSource(source));
  if (!ctx.preview || hidden.length === 0) return null;
  const tf = await translator(options.locale);
  const lines = hidden.map(({ label, source, missing }) => {
    const reason = reasonText(tf, source as ProductTargetSource, missing);
    return tf("home.productSourcePreview.hiddenTab", "“{label}” tab: {reason}", {
      label: label || tf("home.productSourcePreview.untitledTab", "Untitled"),
      reason,
    });
  });
  return sectionEmptyState(ctx, {
    title: options.someShown
      ? tf("home.productSourcePreview.title.hiddenTabs", "Hidden tabs")
      : tf("home.productSourcePreview.title.tabs", "Product tabs"),
    hint: `${lines.join(" ")} ${tf(
      options.someShown
        ? "home.productSourcePreview.hiddenTabs"
        : "home.productSourcePreview.hiddenSection",
      options.someShown
        ? "Shoppers don't see these tabs until they have products."
        : "Shoppers don't see this section until it has products.",
    )}`,
  });
}
