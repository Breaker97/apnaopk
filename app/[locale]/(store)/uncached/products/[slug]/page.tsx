// A product page for a URL with a query string, rendered for that request
// alone: the cached copy may only be rendered from the bare URL, or the first
// visitor's query string (a location filter's lat/lng, an ad's click id)
// would be in everyone's page source. The proxy sends such requests here; see
// lib/storefront/cached-pages.ts.
export { default, generateMetadata } from "../../../products/[slug]/page";

export const dynamic = "force-dynamic";
