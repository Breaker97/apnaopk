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

/**
 * Where the demo catalogue's uploaded media lives: the seed data references
 * these buckets directly, so a seeded store shows them before its own storage
 * is set up. Routes that serve remote files byte-for-byte (the 3D model
 * proxy) trust these origins by name, never "any r2.dev bucket".
 * `tests/media-model-proxy.test.ts` fails if the seed data moves to a bucket
 * missing here.
 */
export const DEMO_ASSET_ORIGINS: readonly string[] = [
  "https://pub-266ab20f55f64e0280c0b46b296882c7.r2.dev",
  "https://pub-49808a4ecaf04280b0561965cf5a40a4.r2.dev",
];
