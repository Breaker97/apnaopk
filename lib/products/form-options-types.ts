/**
 * Shape of GET /api/{admin,vendor}/products/form-options.
 *
 * Kept apart from `form-options.ts` so the client editor can import the types
 * without pulling the Mongoose models and `next/cache` that the builder needs.
 */

export type ProductFormCategory = {
  _id: string;
  name: string;
  slug: string;
  parentId: string | null;
  /** Ancestor names ending in this category's own name. */
  path: string[];
  isLeaf: boolean;
  options?: {
    name: string;
    position?: number;
    values: { value: string; colorCode?: string; position?: number }[];
  }[];
};

type ProductFormBrand = { _id: string; name: string; slug: string };

type ProductFormCollection = {
  _id: string;
  title: string;
  slug: string;
};

export type ProductFormLocation = {
  _id: string;
  name: string;
  isDefault: boolean;
};

export type ProductFormShippingContext = {
  enabled: boolean;
  weightUnit: "kg" | "lb";
  usesWeightRates: boolean;
  customsEnabled: boolean;
};

export type ProductFormOptions = {
  categories: ProductFormCategory[];
  brands: ProductFormBrand[];
  collections: ProductFormCollection[];
  locations: ProductFormLocation[];
  shipping: ProductFormShippingContext;
  /**
   * Whether the editor may offer its inline "add location" control. False for
   * staff pinned to a fixed set of locations, whose create request the API
   * refuses — showing the control anyway is what made it fail silently.
   */
  canManageLocations: boolean;
};
