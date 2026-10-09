import "server-only";

import { getTemplateSections } from "@/lib/storefront/pages/get-template";
import {
  parseProductDetailConfig,
  type ProductDetailImageFit,
} from "@/lib/storefront/sections/product-detail-style";

/**
 * How the product page's gallery shows a picture — its fit and the air
 * around a contained one — for blocks elsewhere that show product pictures
 * and are set to match it (the deals panel). Read from the published
 * product template's main section, the same cached entry the product page
 * renders from, so the two can never disagree.
 */
export async function getProductDetailImageStyle(): Promise<{
  fit: ProductDetailImageFit;
  /** px; -1 = the block's own default padding. */
  padding: number;
}> {
  try {
    const { sections } = await getTemplateSections("product");
    const main = sections.find((section) => section.type === "product-main");
    const { style } = parseProductDetailConfig(main?.settings?.detailStyle);
    return { fit: style.imageFit, padding: style.imagePadding };
  } catch {
    return { fit: "contain", padding: -1 };
  }
}
