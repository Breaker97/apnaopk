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
  preorder: {
    /**
     * Whether any gateway this store has switched on could take the rest of a
     * pre-order later. False means the editor must not offer the deposit and
     * pay-later modes: nothing would ever collect the balance, and the shopper
     * would be the one to discover it, at checkout, weeks later.
     */
    deferredBalanceSupported: boolean;
    /**
     * Whether this vendor may open a pre-order at all. Vendor editor only —
     * the admin editor is never gated, so it leaves this out.
     */
    access?: VendorPreorderAccess;
  };
};

/**
 * Whether a vendor may open a new pre-order, answered before they try.
 *
 * The same two gates `assertPreorderAllowed` applies on save, in the same
 * order. Without it the editor let a vendor fill in a whole pre-order and the
 * refusal only arrived on Save, as "Validation failed: preorder".
 */
export type VendorPreorderAccess = {
  allowed: boolean;
  /**
   * `store`: pre-orders are switched off for everyone. `approval`: the store
   * reviews vendors and this one has not been cleared yet.
   */
  blockedBy: "store" | "approval" | null;
  /** When this vendor asked for access, if they are waiting on an admin. */
  requestedAt: string | null;
  maxLeadDays: number;
  maxDepositPercent: number;
};
