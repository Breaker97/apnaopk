"use client";

import { createContext, useContext } from "react";

/**
 * Where the page builder — and the slider editor it embeds — reads and
 * writes. The admin's Customize and Sliders screens and the vendor's Online
 * Store (landing page and sliders) mount the same components; the scope is
 * the only thing that differs between them.
 *
 * The admin scope is the default — every value below is exactly what the
 * components hard-coded before scopes existed — so the admin screens need no
 * prop and behave as they always have.
 */
export interface StoreBuilderScope {
  kind: "admin" | "vendor";
  /** One page document: PATCH saves the draft; /publish, /discard, /history hang off it. */
  pageEndpoint: (handle: string) => string;
  /** The redirect into the draft preview (page or one section). */
  previewEndpoint: string;
  /** Product search and lookup for the product pickers. */
  productsEndpoint: string;
  /** Active discounts for the coupon picker. */
  couponsEndpoint: string;
  /** Categories for the category-row editor's picker and preview. */
  categoriesEndpoint: string;
  /**
   * Collections for the collection pickers (Featured Collection rows, Get
   * the Look, Looks): `{ data: [{ _id, title }] }` or a bare array.
   */
  collectionsEndpoint: string;
  /**
   * A collection's products for hand-placing in a Featured Collection row
   * (`CollectionProductsResult`); a vendor's narrows to the store's own.
   */
  collectionProductsEndpoint: (collectionId: string) => string;
  /** Brands for the Brand List picker and preview. */
  brandsEndpoint: string;
  /**
   * The store's own approved reviews, for the Review Highlights hand-pick;
   * null where no section offers one (the admin's pages).
   */
  reviewsEndpoint: string | null;
  /**
   * Saved sliders: GET lists, POST creates, `/<id>` reads, saves and
   * deletes, `/<id>/publish|discard|restore` run the draft lifecycle.
   */
  slidersEndpoint: string;
  /** Where the slider picker's "Manage sliders" link goes. */
  manageSlidersHref: string;
  /** The saved-section library; null hides it (bookmark button, picker tab). */
  savedSectionsEndpoint: string | null;
  /**
   * Whose AI routes the studios (images and slide copy) call —
   * /api/<scope>/ai-authoring/… — or null to hide them. Each control still
   * hides itself unless the dashboard's AI availability allows it, which on
   * the vendor's side is the store's plan and its AI Studio permission.
   */
  aiScope: "admin" | "vendor" | null;
  /** Section types whose bespoke studio gives way to the generic inspector. */
  genericEditorTypes: ReadonlySet<string>;
  /** Slider extras that read store-wide data only the admin has. */
  sliders: {
    /** Where on the store a slider is placed, for the editor's frame picker. */
    placements: boolean;
    /** The shelf of saved slide templates (kept in the store's settings). */
    savedTemplates: boolean;
    /** Views and clicks per slide. */
    stats: boolean;
    /** A published slide as a PNG link (/api/sliders/<handle>/image). */
    imageLinks: boolean;
  };
}

export const ADMIN_STORE_BUILDER_SCOPE: StoreBuilderScope = {
  kind: "admin",
  pageEndpoint: (handle) => `/api/admin/store-pages/${handle}`,
  previewEndpoint: "/api/admin/store-pages/preview",
  productsEndpoint: "/api/admin/products",
  couponsEndpoint: "/api/admin/coupons",
  categoriesEndpoint: "/api/categories?flat=true",
  collectionsEndpoint: "/api/admin/collections?page=1&limit=100&status=active",
  collectionProductsEndpoint: (collectionId) =>
    `/api/admin/collections/${collectionId}/products`,
  // assignable = approved, live brands — the storefront-visible set.
  brandsEndpoint: "/api/brands?assignable=true",
  reviewsEndpoint: null,
  slidersEndpoint: "/api/admin/sliders",
  manageSlidersHref: "/admin/online-store/sliders",
  savedSectionsEndpoint: "/api/admin/store-pages/saved-sections",
  aiScope: "admin",
  genericEditorTypes: new Set(),
  sliders: {
    placements: true,
    savedTemplates: true,
    stats: true,
    imageLinks: true,
  },
};

/**
 * The signed-in vendor's own Online Store: their landing page and their
 * sliders. One page per vendor, so the page endpoint ignores the handle.
 * Pickers list only the vendor's own products, discounts, categories and
 * sliders, and the collections and brands its products are in. The AI
 * studios run on the vendor's own AI routes, gated by its plan. No
 * saved-section library or slide-template shelf (both are the admin's).
 */
export const VENDOR_STORE_BUILDER_SCOPE: StoreBuilderScope = {
  kind: "vendor",
  pageEndpoint: () => "/api/vendor/store-page",
  previewEndpoint: "/api/vendor/store-page/preview",
  productsEndpoint: "/api/vendor/products",
  couponsEndpoint: "/api/vendor/coupons",
  categoriesEndpoint: "/api/vendor/store-page/categories",
  // The collections and brands the store sells in — what its sections can
  // show anything from.
  collectionsEndpoint: "/api/vendor/store-page/collections",
  collectionProductsEndpoint: (collectionId) =>
    `/api/vendor/store-page/collections/${collectionId}/products`,
  brandsEndpoint: "/api/vendor/store-page/brands",
  reviewsEndpoint: "/api/vendor/store-page/reviews",
  slidersEndpoint: "/api/vendor/sliders",
  manageSlidersHref: "/vendor/online-store/sliders",
  savedSectionsEndpoint: null,
  // The vendor's own AI routes: the same gate as its product AI (the plan's
  // AI Studio pack, the AI Studio permission, the admin's daily caps).
  aiScope: "vendor",
  // Every section runs its own studio, the promotional banner's slides too.
  genericEditorTypes: new Set(),
  sliders: {
    placements: false,
    savedTemplates: false,
    stats: false,
    imageLinks: false,
  },
};

export const STORE_BUILDER_SCOPES = {
  admin: ADMIN_STORE_BUILDER_SCOPE,
  vendor: VENDOR_STORE_BUILDER_SCOPE,
} as const;

export type StoreBuilderScopeKey = keyof typeof STORE_BUILDER_SCOPES;

const StoreBuilderScopeContext = createContext<StoreBuilderScope>(
  ADMIN_STORE_BUILDER_SCOPE,
);

export const StoreBuilderScopeProvider = StoreBuilderScopeContext.Provider;

export function useStoreBuilderScope(): StoreBuilderScope {
  return useContext(StoreBuilderScopeContext);
}
