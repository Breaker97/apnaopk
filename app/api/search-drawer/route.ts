import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { rateLimitByIP } from "@/lib/api/rate-limit-middleware";
import { fetchCollectionShelf } from "@/components/store/sections/featured-collection";
import { MAX_SEARCH_DRAWER_COLLECTIONS } from "@/lib/site-config/header-layout";

/** Enough to fill a row on the widest screen, and a little past it to scroll. */
const SHELF_SIZE = 12;
const COLLECTION_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * GET /api/search-drawer?collections=<id>,<id>
 *
 * The product rows under the header's search drawer, one per collection the
 * merchant picked on the search icon. Asked for when the drawer OPENS rather
 * than on every page render: most visits never open it, and the rows are a
 * dozen products per collection.
 *
 * Reads through `fetchCollectionShelf`, the same cached reader the Featured
 * Collection section uses, so a row carries the same guards — active,
 * published to the online store, manual and automated collections alike —
 * and costs nothing extra when a section on the page already asked.
 */
export const GET = withApi({}, async ({ request }) => {
  await rateLimitByIP(request, "lenient");

  const ids = [
    ...new Set(
      (request.nextUrl.searchParams.get("collections") ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter((id) => COLLECTION_ID.test(id)),
    ),
  ].slice(0, MAX_SEARCH_DRAWER_COLLECTIONS);

  const shelves = await Promise.all(
    ids.map(async (id) => {
      const shelf = await fetchCollectionShelf(id, SHELF_SIZE);
      return shelf
        ? { id, title: shelf.title, slug: shelf.slug, products: shelf.products }
        : null;
    }),
  );

  return successResponse({ shelves: shelves.filter(Boolean) });
});
