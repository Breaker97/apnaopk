import type { RouteEntry } from "@/lib/api-core/registry";
import { aboutRoute } from "./about";
import { blogArticleRoute, blogListRoute } from "./blog";
import { contactMessageRoute, contactPageRoute } from "./contact";
import { faqRoute } from "./faq";
import { contentPageRoute } from "./pages";
import { returnPolicyRoute } from "./return-policy";

/**
 * The store's own pages and its blog, for the app's native screens.
 *
 * One module per kind of page in this folder, each exporting its
 * `defineRoute` entries; the route files import the entry from that module,
 * and they are listed here for the registry.
 */
export const contentRoutes: readonly RouteEntry[] = [
  contentPageRoute,
  faqRoute,
  aboutRoute,
  contactPageRoute,
  contactMessageRoute,
  returnPolicyRoute,
  blogListRoute,
  blogArticleRoute,
];
