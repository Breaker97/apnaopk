import { CartPageContentLazy as CartPageContent } from "@/components/cart/cart-page-content-lazy";
import type { SectionDefinition } from "../types";

/**
 * The shopping bag itself — lines, summary, estimator, coupon — as the
 * cart template's locked core. Everything lives in the client cart store;
 * the section only mounts it. Trust badges, banners, and recommendation
 * sections arrange around it.
 */
export const cartMain: SectionDefinition = {
  type: "cart-main",
  version: 1,
  category: "more",
  templates: ["cart"],
  required: true,
  locked: true,
  maxPerPage: 1,
  resourceType: "cart",
  fields: [],
  Render({ ctx }) {
    if (ctx.resource?.type !== "cart") return null;
    return <CartPageContent />;
  },
};
