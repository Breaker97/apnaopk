import { connectDB } from "@/lib/db";
import { successResponse } from "@/lib/api/response";
import { AuthorizationError } from "@/lib/api/errors";
import { canAccessPOS } from "@/lib/access/rbac";
import { withApi } from "@/lib/api/handler";
import {
  listPOSProducts,
  MAX_POS_PRODUCT_PAGE_SIZE,
} from "@/lib/pos/list-products";

/**
 * GET /api/pos/offline-catalog
 *
 * One page of the register's full sellable catalogue, for the snapshot the
 * terminal keeps in IndexedDB (`lib/pos/offline-db.ts`).
 *
 * The grid's own endpoint cannot serve this: it pages at 50 and answers the
 * *current filter*, while an offline scan can hit any product in the shop. The
 * query itself is `listPOSProducts` unchanged, so the snapshot can only ever
 * contain what the grid would have shown — same vendor ownership, same
 * `publishing.pointOfSale` gate, same per-location stock.
 *
 * Rate limited because this is, by construction, the cheapest way to read a
 * merchant's whole catalogue in a few requests. Every caller already holds POS
 * access for that merchant, so the limit is about traffic shape rather than
 * disclosure — a terminal pulls a snapshot at the start of a shift, not in a
 * loop.
 *
 * `lenient`, per cashier. Every caller is a store role (`canAccessPOS` admits
 * no shopper), and store roles get the preset twenty times over
 * (`STORE_ROLE_ALLOWANCE` in `lib/api/rate-limit-middleware.ts`): 2,000
 * requests per quarter hour. One pull is one request per 500 products, so a
 * 20k-product store has room for about fifty full pulls in a window, against
 * the register's one every fifteen minutes (`hooks/use-pos-offline.ts`) plus
 * one per reload. `moderate` would still be too tight for the largest
 * catalogues — a partial pull is discarded.
 *
 * Should a till hit it anyway, a 429 is not an outage: the limit is counted
 * after the session check, so the register reads it as "reachable, try again
 * in a minute" and keeps its previous snapshot, rather than calling itself
 * offline.
 */
export const GET = withApi(
  {
    auth: "user",
    rateLimit: { action: "pos:offline-catalog", preset: "lenient" },
  },
  async ({ request, session }) => {
    if (!(await canAccessPOS(session.user))) throw new AuthorizationError();

    await connectDB();

    const { searchParams } = new URL(request.url);

    const data = await listPOSProducts(session.user, {
      paged: true,
      cursor: searchParams.get("cursor") || undefined,
      locationId: searchParams.get("locationId") || "",
      limit: MAX_POS_PRODUCT_PAGE_SIZE,
      // A snapshot has to carry sold-out products too: the register still needs
      // to resolve a scan of one, so it can say "out of stock" instead of "no
      // such product" — and a continue-selling line is sellable at 0 anyway.
      stockStatus: "all",
      // Categories are store-wide; the first page carries them and later pages
      // skip the query.
      includeFilterLists: !searchParams.get("cursor"),
    });

    return successResponse(data);
  },
);
