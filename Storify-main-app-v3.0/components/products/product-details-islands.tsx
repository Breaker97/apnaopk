"use client";

import type { ComponentProps, ComponentType } from "react";
import {
  PurchaseCartRow,
  PurchaseChatButton,
  PurchaseDetailsFields,
  PurchaseGallery,
  PurchaseInfoCard,
  PurchasePriceRow,
  PurchaseVariantsRow,
} from "./product-purchase-rows";
import { ProductSectionTabs } from "./product-section-tabs";
import { ShareCopyLink } from "./share-copy-link";

export { ProductPurchaseProvider } from "./product-purchase";

/*
 * Every client control of the product page, from one module so that
 * product-details-lazy.tsx loads them as ONE chunk. Split across modules,
 * the controls inside the provider would start loading only once the
 * provider's own chunk had arrived — a second round trip on every soft
 * navigation to a product.
 */

const ISLANDS = {
  gallery: PurchaseGallery,
  price: PurchasePriceRow,
  variants: PurchaseVariantsRow,
  cart: PurchaseCartRow,
  details: PurchaseDetailsFields,
  infoCard: PurchaseInfoCard,
  chat: PurchaseChatButton,
  copyLink: ShareCopyLink,
  tabs: ProductSectionTabs,
};

type Islands = typeof ISLANDS;

type ProductIslandProps = {
  [Name in keyof Islands]: { island: Name } & ComponentProps<Islands[Name]>;
}[keyof Islands];

/**
 * One of the controls above, by name. The server shell renders them all
 * through this one component because every client component a server
 * component renders is a module reference in the page's payload, and each
 * reference carries the route's whole chunk list (~0.8 KB): nine controls as
 * nine references cost the product page ~6 KB of payload, and nine
 * `dynamic()` wrappers in product-details-lazy.tsx a kilobyte of script on
 * EVERY storefront page.
 */
export function ProductIsland({ island, ...props }: ProductIslandProps) {
  const Island = ISLANDS[island] as ComponentType<typeof props>;
  return <Island {...props} />;
}
