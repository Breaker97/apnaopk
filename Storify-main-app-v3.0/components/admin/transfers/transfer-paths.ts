/**
 * Where the transfer screens live. The same screens serve the admin area and a
 * vendor's own dashboard; only the URLs differ — access to each transfer is
 * decided server-side from the caller's locations either way.
 */
export type TransferArea = "admin" | "vendor";

export function transferPaths(area: TransferArea, locale: string) {
  const api = area === "vendor" ? "/api/vendor/transfers" : "/api/admin/transfers";
  return {
    api,
    catalog: `${api}/catalog`,
    // One locations endpoint serves admin, staff and vendors, scoped by session.
    locations: "/api/admin/locations",
    page: `/${locale}/${area}/transfers`,
  };
}

/** Table text, matched to the orders list: 12px header and body. */
export const TRANSFER_TABLE_CLASS = "w-full text-xs";
export const TRANSFER_TH_CLASS = "px-4 py-3 font-medium text-muted-foreground whitespace-nowrap";
export const TRANSFER_TD_CLASS = "px-4 py-3";
