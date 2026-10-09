/**
 * How many media files one product holds: images, videos, YouTube/Vimeo links
 * and 3D models together — Shopify's cap. A variant's picture is picked from
 * these, so it is also the most distinct pictures a product's variants can
 * show. Dependency-free so the product form, the product API's schema and the
 * import all read the same number.
 */
export const MAX_PRODUCT_MEDIA = 250;
