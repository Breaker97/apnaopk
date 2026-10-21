import { cookies } from "next/headers";
import {
  LISTING_VIEW_COOKIE,
  parseListingView,
  type ListingViewChoice,
} from "@/lib/storefront/listing-view";

/**
 * The view the shopper last picked on a product listing, for the server to
 * draw on the first byte. Reads the request, so only a page that is already
 * dynamic (the listings read their filters from the URL) may call it.
 */
export async function readListingView(): Promise<ListingViewChoice> {
  const store = await cookies();
  return parseListingView(store.get(LISTING_VIEW_COOKIE)?.value);
}
