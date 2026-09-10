type ProductGridPaginationQuery = {
  category?: string;
  collection?: string;
  brand?: string;
  search?: string;
  minPrice?: string;
  maxPrice?: string;
  sortBy?: string;
  sortOrder?: string;
  lat?: string;
  lng?: string;
  radius?: string;
  city?: string;
  pickup?: string;
  extra?: Record<string, string | undefined>;
};

/** Build a relative page URL without dropping the listing's active filters. */
export function buildProductGridPageHref(
  query: ProductGridPaginationQuery,
  page: number,
): string {
  const params = new URLSearchParams();
  const carry: Array<[string, string | undefined]> = [
    ["category", query.category],
    ["collection", query.collection],
    ["brand", query.brand],
    ["search", query.search],
    ["minPrice", query.minPrice],
    ["maxPrice", query.maxPrice],
    ["sortBy", query.sortBy],
    ["sortOrder", query.sortOrder],
    ["lat", query.lat],
    ["lng", query.lng],
    ["radius", query.radius],
    ["city", query.city],
    ["pickup", query.pickup],
  ];

  for (const [key, value] of carry) {
    if (value) params.set(key, value);
  }
  for (const [key, value] of Object.entries(query.extra ?? {})) {
    if (value) params.set(key, value);
  }
  params.set("page", String(page));

  return `?${params.toString()}`;
}

/**
 * Build the `/api/products` query a listing's continuation pages are fetched
 * with — the same filters the server grid rendered under, minus `page`.
 *
 * Kept beside the page-href builder because the two carry the same set: a
 * filter added to one and not the other is a grid whose "load more" quietly
 * returns a different set of products than the page it is extending.
 */
export function buildProductApiQuery(
  query: ProductGridPaginationQuery & { vendor?: string; preorder?: boolean },
  limit: number,
): string {
  const params = new URLSearchParams(buildProductGridPageHref(query, 1).slice(1));
  params.delete("page");

  if (query.vendor) params.set("vendor", query.vendor);
  if (query.preorder) params.set("preorder", "true");
  // Pinned to the page size the server actually used, so the second page picks
  // up exactly where the first one stopped even if the default ever moves.
  params.set("limit", String(limit));
  // The cards rendered here need only PRODUCT_CARD_SELECT; without this the
  // continuation pages would pull full variant- and media-heavy documents that
  // the first page deliberately did not.
  params.set("cardFieldsOnly", "true");

  return params.toString();
}
