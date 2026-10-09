import { MobileApiError } from "@/lib/api-core/errors";

/**
 * The cursor of a list paged by position: the catalogue's product, collection,
 * brand, seller and review lists, whose web readers page by number. Opaque to
 * the app (contracts … common.ts, `ListQuery`): a page number inside today,
 * so the paging can change without the app knowing.
 */

const PAGE = /^p([1-9]\d{0,5})$/;

/** The page a cursor names: the first without one; a cursor this API never gave out is a 400. */
export function pageFromCursor(cursor: string | undefined): number {
  if (!cursor) return 1;
  const match = PAGE.exec(Buffer.from(cursor, "base64url").toString("utf8"));
  if (!match) {
    throw new MobileApiError(400, "VALIDATION_ERROR", "The cursor is not one this list gave out.", {
      errors: { cursor: ["Send back the nextCursor of the previous page."] },
    });
  }
  return Number(match[1]);
}

/** The cursor of the page after `page`, or null on the last one. */
export function nextPageCursor(page: number, totalPages: number): string | null {
  return page < totalPages ? Buffer.from(`p${page + 1}`).toString("base64url") : null;
}
