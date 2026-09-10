/**
 * Static asset paths used by the seed scripts.
 *
 * Seeded records point at files that ship in `public/` rather than at uploaded
 * media, so a fresh install renders correctly before any storage provider is
 * configured. Real uploads go through `lib/storage` and store their own URLs.
 */

export const LOCAL_ASSET_PATHS = {
  logos: {
    main: "/logo.png",
    dark: "/logo-dark.png",
  },
  placeholders: {
    product: "/placeholder-product.png",
    vendor: "/placeholder-vendor.png",
    category: "/placeholder-category.png",
    blog: "/placeholder-blog.png",
  },
};
