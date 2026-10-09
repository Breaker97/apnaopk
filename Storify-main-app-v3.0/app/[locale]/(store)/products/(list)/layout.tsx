// Canonical, hreflang and robots from the URL being served (the root layout
// cannot know it); see lib/storefront/request-path-metadata.tsx. The listing's
// alone: a product page is served from the cache, so it may not read the
// request and states its own (products/[slug]/page.tsx).
export { default, generateMetadata } from "@/lib/storefront/request-path-metadata";
