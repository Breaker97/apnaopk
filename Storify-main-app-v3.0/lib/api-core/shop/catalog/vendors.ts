import { VendorList } from "@/contracts/mobile/shop/v1/catalog";
import { ListQuery, LIST_DEFAULT_LIMIT } from "@/contracts/mobile/shop/v1/common";
import { MobileApiError } from "@/lib/api-core/errors";
import { defineRoute } from "@/lib/api-core/registry";
import { getStorefrontVendorDirectory } from "@/lib/storefront/storefront-vendors";
import { nextPageCursor, pageFromCursor } from "../page-cursor";
import { toVendorSummary } from "./summaries";

/**
 * GET /vendors: every live seller, newest first, as the web's sellers page
 * lists them. A store with one seller has no directory: 404.
 */
export const vendorListRoute = defineRoute({
  id: "catalog.vendors.list",
  method: "GET",
  path: "/vendors",
  auth: "none",
  cache: { kind: "public", sMaxAge: 60, swr: 120 },
  etag: true,
  rateLimit: { bucket: "catalog:vendors", preset: "browse" },
  input: ListQuery,
  output: VendorList,
  handler: async ({ input }) => {
    const page = pageFromCursor(input.cursor);
    const directory = await getStorefrontVendorDirectory(page, input.limit ?? LIST_DEFAULT_LIMIT);
    if (!directory) throw new MobileApiError(404, "NOT_FOUND", "This store has no seller directory.");
    // The reader clamps a page past the end to the last one; that page has
    // already been seen, so it is an empty one here.
    if (directory.page < page) return { items: [], nextCursor: null };
    return {
      items: directory.vendors.map(toVendorSummary),
      nextCursor: nextPageCursor(directory.page, directory.totalPages),
    };
  },
});
