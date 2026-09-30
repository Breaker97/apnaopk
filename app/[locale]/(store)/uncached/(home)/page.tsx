// The home page for a URL with a query string, rendered for that request
// alone: the cached copy may only be rendered from the bare URL, or the first
// visitor's query string would be in everyone's page source. The proxy sends
// such requests here; see lib/storefront/cached-pages.ts.
export { default, generateMetadata } from "../../(home)/page";

export const dynamic = "force-dynamic";
