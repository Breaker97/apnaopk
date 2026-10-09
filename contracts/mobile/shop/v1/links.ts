/**
 * The link table: which paths of the storefront on the web the app opens as
 * its own screens.
 *
 * A push notification, a universal link and a home block all carry a web path
 * (with or without the locale in front). The app's screens use the same paths
 * as the website, so a path in this list opens as it is; any other path opens
 * in a browser.
 *
 * `:name` stands for one path segment.
 *
 * The list grows with the app's screens.
 */
export const APP_LINK_PATTERNS = [
  "/",
  "/products",
  "/products/:slug",
  "/categories",
  "/categories/:slug",
  "/brands",
  "/brands/:slug",
  "/collections",
  "/collections/:slug",
  "/vendors",
  "/vendors/:slug",
  "/cart",
  "/track-order",
  "/account",
  "/account/profile",
  /** The chat: `?conversation={id}` names one (chat.ts). */
  "/account/inbox",
  /** Order and return notifications link here (orders.ts). */
  "/account/orders",
  /** The orders with a pre-order in them (GET /orders with `preOrders`). */
  "/account/orders/:id",
  "/account/notifications",
  "/account/wishlist",
  "/account/addresses",
  "/account/preferences",
  "/account/security",
  "/login",
  /** The store's own pages (content.ts). */
  "/privacy",
  "/terms",
  "/cookies",
  "/accessibility",
  "/faq",
  "/about",
  "/contact",
  /** The return policy (GET /return-policy). */
  "/returns",
  "/pages/:handle",
  /** The blog: `?category=` and `?tag=` narrow the list. */
  "/blog",
  "/blog/:slug",
  /** The comparison: `?products=a,b` names the products, as on the website (compare.ts). */
  "/compare",
  /**
   * How to delete an account, public on the website. In the app a signed-in
   * shopper lands on the delete-account screen, a guest on a page that says how.
   */
  "/account-deletion",
] as const;

export type AppLinkPattern = (typeof APP_LINK_PATTERNS)[number];
