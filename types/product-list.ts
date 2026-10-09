/**
 * Shared client-side product list shapes.
 *
 * These describe what the product list/table APIs actually return to the
 * browser (lean documents with populated names), as opposed to the full
 * server-side `IProduct` document type in `types/index.ts`. Previously each
 * table declared its own drifting copy of this interface.
 */

/** Row shape for the admin/vendor product tables and pickers. */
export interface ProductListItem {
  _id: string;
  name: string;
  title?: string;
  slug: string;
  price: number;
  comparePrice?: number;
  stock: number;
  status: string;
  productSource?: "admin" | "vendor";
  featured: boolean;
  images: string[];
  media?: { url: string }[];
  variants?: { stock: number; price?: number }[];
  vendorId?: { _id?: string; storeName: string; slug: string };
  category?: { _id?: string; name: string };
  tags?: string[];
  publishing?: { onlineStore: boolean; pointOfSale: boolean };
  createdAt: string;
}

/** Minimal shape for product pickers (collection/product selectors). */
export interface ProductPickerItem {
  _id: string;
  name: string;
  title?: string;
  slug: string;
  /** Only where the endpoint sends it — a picker that matches on it. */
  sku?: string;
  price: number;
  images?: string[];
  status: string;
}

/**
 * GET /api/admin/collections/[id]/products — the products a collection puts on
 * the online store, in its own order, plus which of the `picked` ids asked
 * about it still offers.
 */
export interface CollectionProductsResult {
  products: ProductPickerItem[];
  total: number;
  picked: ProductPickerItem[];
}
