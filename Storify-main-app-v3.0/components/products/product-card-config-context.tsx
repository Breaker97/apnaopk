"use client";

import { createContext, useContext, type ReactNode } from "react";
import {
  DEFAULT_PRODUCT_CARD_CONFIG,
  type CardBrand,
  type ProductCardConfig,
} from "@/lib/products/product-card-config";

/**
 * Delivers the store-wide product card configuration to every card without
 * threading a prop through a dozen grid/carousel call sites. Mounted once in
 * the storefront layout with the server-normalized config; anything rendered
 * outside it (admin previews, tests) falls back to the shipped default.
 *
 * One storefront, one card design: a theme that wants its own card seeds
 * the config with a template on activation (`ThemeManifest.productCard`)
 * instead of bypassing the configurator with a fixed layout.
 */
const ProductCardConfigContext = createContext<ProductCardConfig>(
  DEFAULT_PRODUCT_CARD_CONFIG,
);

/** The store's brands by id, for the Brand element. Empty when it is off. */
const CardBrandDirectoryContext = createContext<Record<string, CardBrand>>({});

export function ProductCardConfigProvider({
  config,
  brands = {},
  children,
}: {
  config: ProductCardConfig;
  brands?: Record<string, CardBrand>;
  children: ReactNode;
}) {
  return (
    <ProductCardConfigContext.Provider value={config}>
      <CardBrandDirectoryContext.Provider value={brands}>
        {children}
      </CardBrandDirectoryContext.Provider>
    </ProductCardConfigContext.Provider>
  );
}

export function useCardBrandDirectory(): Record<string, CardBrand> {
  return useContext(CardBrandDirectoryContext);
}

export function useProductCardConfig(): ProductCardConfig {
  return useContext(ProductCardConfigContext);
}
