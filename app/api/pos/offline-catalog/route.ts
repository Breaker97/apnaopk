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
 * `lenient` (100 per 15 min), NOT `moderate` (20): one pull is one request per
 * 500 products, so `moderate` would cut a 10k-product catalogue off mid-pull —
 * and a partial pull is discarded, which would leave the register showing a
 * stale snapshot and flagged offline for the rest of the shift. The budget is
 * deliberate rather than generous: a 20k-product store gets two full pulls per
 * window, and a failed pull keeps the previous snapshot, so the worst outcome
 * of exhausting it is stock figures that are one refresh old.
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
