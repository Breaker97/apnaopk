/**
 * Page sizes for the register's catalogue reads.
 *
 * A module of their own, and deliberately free of imports, because both sides
 * of the connection need them: the server route that pages the catalogue and
 * the client that filters a snapshot offline. They used to live in
 * `lib/pos/list-products.ts`, which imports the Mongoose models — so the moment
 * the offline filter was wired into the terminal, a client component pulled the
 * entire server data layer into the browser bundle and the build failed on
 * `revalidatePath`. Constants shared across that boundary have to sit somewhere
 * that imports nothing.
 */

/** What the grid asks for, and what the offline filter returns at most. */
export const POS_PRODUCT_PAGE_SIZE = 50;

/**
 * Ceiling for a single call. The offline snapshot pages through with this so a
 * large catalogue costs a handful of round trips rather than hundreds, while
 * still bounding what one request can materialise.
 */
export const MAX_POS_PRODUCT_PAGE_SIZE = 500;
