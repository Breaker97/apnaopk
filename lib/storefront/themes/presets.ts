import { getDefaultProductTemplateSections } from "@/lib/storefront/pages/default-templates";
import { VARIANT_FIELD_KEY } from "@/lib/storefront/sections/types";
import type { SectionInstance } from "@/lib/storefront/sections/types";

/**
 * Per-theme starter layouts — the design a theme delivers when it is
 * activated. Ids are deterministic so a re-seed is idempotent, and settings
 * are partial: the write normalizer fills every remaining field from the
 * section schema.
 *
 * A preset describes SHAPE and DESIGN only — which sections, in what order,
 * and which `variant` each one wears. The slots that carry content are left
 * unset here and bound to the merchant's own catalogue at activation by
 * `preset-content.ts`; a preset cannot know a store's collections, and a
 * shelf that arrives unbound renders nothing at all.
 */

function instance(
  theme: string,
  n: number,
  type: string,
  settings: Record<string, unknown> = {},
  blocks?: { type: string; settings?: Record<string, unknown> }[],
): SectionInstance {
  return {
    id: `preset-${theme}-${n}`,
    type,
    version: 1,
    visible: true,
    settings,
    ...(blocks
      ? {
          blocks: blocks.map((block, index) => ({
            id: `preset-${theme}-${n}-${index + 1}`,
            type: block.type,
            visible: true,
            settings: block.settings ?? {},
          })),
        }
      : {}),
  };
}

/**
 * Essential's own layout — the balanced general-retail home.
 *
 * Reproduced from what Essential stores actually published, not from a
 * mockup: same ten sections in the same order, same headings, same limits.
 * A starter that quietly drops sections a merchant had (the sponsored rail,
 * the articles grid, the Instagram row) reads to them as data loss, whether
 * or not the old version is still recoverable.
 *
 * Essential MUST carry a starter like every other theme. Without one,
 * activating it changes nothing but an id: the storefront keeps rendering
 * whatever the previous theme published, while the Themes page says
 * "Essential — Active". A theme you cannot switch back TO is not a theme.
 */
export const ESSENTIAL_HOME_PRESET: SectionInstance[] = [
  instance(
    "essential",
    1,
    "slideshow",
    {
      layout: "classic",
      width: "contained",
      height: "banner",
      transition: "slide",
      autoplaySeconds: 5,
    },
    Array.from({ length: 5 }, () => ({ type: "slide" })),
  ),
  instance("essential", 2, "category-list", {
    variant: "cards",
    title: "Featured Categories",
    source: "featured",
    limit: 8,
  }),
  instance("essential", 3, "product-grid", {
    title: "Product on Sale",
    source: "discounted",
    limit: 8,
    desktopColumns: 4,
  }),
  // Paid placements. `maxPerPage: 1` keeps it a singleton; the rail simply
  // renders nothing while no boost is running.
  instance("essential", 4, "sponsored-rail", { limit: 8 }),
  instance(
    "essential",
    5,
    "promotion-grid",
    { grid: "bento5", width: "fixed", height: "half" },
    // Empty image cells; the binder fills them from the store's catalogue.
    Array.from({ length: 5 }, () => ({
      type: "cell",
      settings: { kind: "image" },
    })),
  ),
  // Deliberately untitled — the browser's own chips carry the context.
  instance("essential", 6, "product-browser", { source: "all", limit: 12 }),
  // Marketplace block: `available()` hides it on a single-vendor store
  // without dropping it from the document.
  instance("essential", 7, "vendor-list", { title: "Top Vendors", limit: 8 }),
  // A promotional banner in the slot the vendor-recruitment CTA used to
  // take: a home page sells to shoppers first, and "Become a Vendor" lives
  // in the header/footer links for anyone looking for it. Ships without
  // artwork (Essential has none bundled); the muted stage and gradient
  // carry the copy until the merchant drops an image in.
  instance("essential", 8, "promotion-banner", {
    image: "",
    heading: "Big Savings This Season",
    subheading: "Up to 40% off top picks across the store. Limited time only.",
    ctaLabel: "Shop the Sale",
    link: "/products",
  }),
  instance("essential", 9, "blog-posts", {
    title: "Top Articles",
    limit: 9,
    desktopColumns: 4,
  }),
  instance(
    "essential",
    10,
    "image-gallery",
    { title: "From Instagram" },
    Array.from({ length: 5 }, () => ({ type: "image" })),
  ),
];

/**
 * Essential's chrome: the plain bars, nothing above or below them. Listed
 * explicitly so switching back from a theme that ADDS chrome (Electronics'
 * announcement strip and tag row) actually removes it again.
 */
export const ESSENTIAL_GROUP_PRESETS = {
  header: [instance("essential-header", 1, "header-bar", {})],
  footer: [instance("essential-footer", 1, "footer-bar", {})],
};

/**
 * Dense, comparison-friendly retail, mirroring the approved Electronics
 * design top-to-bottom: showcase hero (category rail + slider + promo
 * cards), brand strip, circular categories, promo bento, tabbed best
 * sellers, deal countdown, three collection shelves, a wide banner slot,
 * the filterable catalog, coupon, articles, and the Instagram row.
 */
export const ELECTRONICS_HOME_PRESET: SectionInstance[] = [
  // Artwork under /public/templates/electronics ships with the product
  // (exported from the approved design), so the starter arrives dressed —
  // the binder fills only what a slot leaves empty.
  instance(
    "electronics",
    1,
    "slideshow",
    {
      layout: "showcase",
      showCategoryRail: true,
      height: "banner",
      transition: "slide",
      sideCardOneImage: "/templates/electronics/side-card-1.png",
      sideCardOneHeading: "Latest Smartphones",
      sideCardOneCta: "Shop Now",
      sideCardOneLink: "/products",
      sideCardTwoImage: "/templates/electronics/side-card-2.png",
      sideCardTwoHeading: "Smart Watches",
      sideCardTwoCta: "Shop Now",
      sideCardTwoLink: "/products",
    },
    [
      {
        type: "slide",
        settings: {
          // The artwork is the product cutout ONLY — the design's headline
          // and button are real, translatable elements over it, which is
          // also what lets a merchant retitle the slide.
          image: "/templates/electronics/hero-slide.png",
          backgroundColor: "#e3e5e8",
          alt: "Surface laptops",
          // The design breaks the headline after "on"; the slider honours
          // a newline in showcase layout, so the starter arrives set the
          // way it was drawn.
          heading: "Go All in on\nBig Screen Action",
          ctaLabel: "Shop Now",
          link: "/products",
          position: "top-center",
        },
      },
    ],
  ),
  // With no curated brand blocks the section auto-fills from the store's
  // Brands, running untitled under the hero as the design draws it.
  instance("electronics", 2, "brand-list", { variant: "strip" }),
  instance("electronics", 3, "category-list", {
    variant: "circles",
    title: "Shop by Categories",
    source: "featured",
    limit: 6,
  }),
  // The old "split" design, now stated as a grid: tall ends with two small
  // tiles over a wide one. Cells fill the grid's slots IN ORDER (a b c d e),
  // so the wide tile has to sit at index 3 — the slot it occupies — not last
  // as it did when the layout was hand-wired.
  instance(
    "electronics",
    4,
    "promotion-grid",
    { grid: "feature", width: "fixed", height: "half" },
    [
      {
        type: "cell",
        settings: {
          kind: "image",
          image: "/templates/electronics/tile-tall-1.png",
        },
      },
      {
        type: "cell",
        settings: {
          kind: "image",
          image: "/templates/electronics/tile-small-1.png",
          alt: "10% OFF!",
        },
      },
      {
        type: "cell",
        settings: {
          kind: "image",
          image: "/templates/electronics/tile-small-2.png",
          alt: "Nomad Tech Collection",
        },
      },
      {
        type: "cell",
        settings: {
          kind: "image",
          image: "/templates/electronics/tile-wide.png",
        },
      },
      {
        type: "cell",
        settings: {
          kind: "image",
          image: "/templates/electronics/tile-tall-2.png",
          alt: "15% OFF! Power Bank",
        },
      },
    ],
  ),
  instance(
    "electronics",
    5,
    "product-group",
    { variant: "centered", title: "Best Selling" },
    [
      { type: "tab", settings: { label: "Featured", source: "featured" } },
      { type: "tab", settings: { label: "New Arrivals", source: "latest" } },
      { type: "tab", settings: { label: "On Sale", source: "discounted" } },
    ],
  ),
  // The paid boost rail. Not in the approved mockup, but boost placement
  // DEPTHS are read from the published home's sponsored-rail — a default
  // template without one would zero the home ladder and make home boosts
  // unsellable out of the box. It renders as an ordinary product row (with
  // organic fill) until boosts run, and it is deletable, not locked.
  instance("electronics", 15, "sponsored-rail", { limit: 8 }),
  instance("electronics", 6, "countdown-offer", {
    variant: "deals-panel",
    subheading: "Today's Featured",
    heading: "Deals",
    ctaLabel: "View All Deals",
    link: "/products",
  }),
  // Three collection shelves ("Top Collections" in the design) — quiet
  // until the merchant binds each one to a collection.
  instance("electronics", 16, "heading", {
    title: "Top",
    accent: "Collections",
    align: "center",
    size: "large",
  }),
  instance("electronics", 7, "featured-collection"),
  instance("electronics", 8, "featured-collection"),
  instance("electronics", 9, "featured-collection"),
  // The flagship-product strip, dressed from the design.
  instance("electronics", 10, "promotion-banner", {
    image: "/templates/electronics/banner-macbook.png",
    heading: "MacBook Pro",
    subheading:
      "Market-specific assortments balancing contemporary styling, comfort, durability.",
    ctaLabel: "Shop Now",
    link: "/products",
  }),
  instance("electronics", 17, "heading", {
    title: "Find",
    accent: "Products",
    align: "center",
    size: "large",
  }),
  // Untitled on purpose: the heading above carries the title, the browser
  // brings the chips and filter row.
  instance("electronics", 11, "product-browser", {
    title: "",
    source: "all",
  }),
  instance("electronics", 12, "coupon-banner", {
    heading: "Get 20% off",
    subheading: "Use coupon code at checkout",
    ctaLabel: "Shop Now",
    link: "/products",
  }),
  instance("electronics", 13, "blog-posts", {
    title: "Top Articles",
    limit: 3,
    desktopColumns: 3,
  }),
  instance(
    "electronics",
    14,
    "image-gallery",
    { title: "From Our Instagram" },
    Array.from({ length: 5 }, () => ({ type: "image" })),
  ),
];

/**
 * Electronics' product page, to the approved design (Figma 675:5021): the
 * `electronics` buy-box design over the gallery arrangement the mockup
 * shows — one large image with the thumbnail row beneath it — followed by
 * the shared reviews/sponsored/related run and the closing promo banner.
 *
 * Reusing the default template's deterministic ids keeps a publish of an
 * unchanged layout a no-op for the activation guard. `product-sponsored`
 * stays even though the mockup omits it: `getSponsoredPlacementDepths`
 * zeroes the product-page depth when a published template has no visible
 * rail, so dropping it would quietly make product-page boosts unsellable.
 */
// product-main, product-specification and product-reviews are absent on
// purpose: they ship ONE design each (Figma 774:4992 / 829-2420) rather
// than stored variants.
const ELECTRONICS_PRODUCT_VARIANTS: Record<string, string> = {
  "product-related": "electronics",
};

export const ELECTRONICS_PRODUCT_PRESET: SectionInstance[] = (() => {
  const base = getDefaultProductTemplateSections("bottom").map((section) => {
    const design = ELECTRONICS_PRODUCT_VARIANTS[section.type];
    return design
      ? {
          ...section,
          settings: { ...section.settings, [VARIANT_FIELD_KEY]: design },
        }
      : section;
  });
  // The design runs spec BEFORE the reviews thread, and the spec table is a
  // section here rather than a tab inside product-main.
  const mainIndex = base.findIndex((s) => s.type === "product-main");
  return [
    ...base.slice(0, mainIndex + 1),
    {
      id: "product-specification",
      type: "product-specification",
      version: 1,
      visible: true,
      settings: { title: "" },
    },
    ...base.slice(mainIndex + 1),
    // Artwork is left empty on purpose — the binder fills it from the
    // store's own catalogue at activation, like every other promo slot.
    instance("electronics-product", 1, "promotion-banner", {
      fullWidth: false,
    }),
  ];
})();

/**
 * Classic's and Luxe's product pages — the engine's own arrangement with the
 * gallery under the image, which is what both themes have always rendered.
 *
 * They exist for the same reason the plain chrome presets do: a surface ANY
 * theme designs, EVERY theme has to state, or switching away from the one
 * that designed it leaves its layout behind. Electronics publishes a GRID
 * gallery on activation; without these two, going back to Classic changed
 * the id and the home page while the product page stayed Electronics'
 * forever. `tests/section-variants.test.ts` pins the parity.
 *
 * Luxe deliberately shares the arrangement for now — its own product design
 * arrives with the Fashion bundle. Until then this preset's job is purely to
 * undo Electronics', which it does.
 */
export const ESSENTIAL_PRODUCT_PRESET: SectionInstance[] =
  getDefaultProductTemplateSections("bottom");

export const LUXE_PRODUCT_PRESET: SectionInstance[] =
  getDefaultProductTemplateSections("bottom");

/**
 * Electronics' chrome: the announcement strip and tag row the design carries
 * above and below the header. The bars themselves are required cores, so
 * they are listed first — a group preset that omits them fails the write
 * gate, which is exactly the check that keeps chrome from being deleted.
 */
export const ELECTRONICS_GROUP_PRESETS = {
  header: [
    instance("electronics-header", 1, "announcement-bar", {
      text: "Free shipping on orders over $50",
    }),
    instance("electronics-header", 2, "header-bar", {}),
  ],
  footer: [instance("electronics-footer", 1, "footer-bar", {})],
};

/** Imagery-first editorial: full-bleed hero, mosaic, story blocks, voices. */
export const LUXE_HOME_PRESET: SectionInstance[] = [
  instance(
    "luxe",
    1,
    "slideshow",
    {
      width: "full",
      height: "threeQuarters",
      transition: "fade",
      autoplaySeconds: 6,
    },
    [{ type: "slide" }],
  ),
  instance("luxe", 2, "category-mosaic", { source: "featured", limit: 5 }),
  instance("luxe", 3, "featured-collection"),
  instance("luxe", 4, "product-grid", {
    title: "New In",
    source: "latest",
    limit: 8,
  }),
  instance("luxe", 5, "image-text", { imagePosition: "left" }),
  instance("luxe", 6, "testimonials", {
    title: "Voices",
    minRating: 4,
    limit: 6,
  }),
  instance(
    "luxe",
    7,
    "image-gallery",
    { title: "Follow Us" },
    Array.from({ length: 5 }, () => ({ type: "image" })),
  ),
];

/**
 * Women's Fashion — the apparel home, to the design top-to-bottom: the
 * campaign hero, the four department tiles with their names on the picture,
 * the tabbed Best Selling shelf, the five-tile magazine grid, two collection
 * rows (a feature panel beside three pieces), the deals panel, the Get the
 * Look outfit with Add All to Cart, the Looks row, and the journal.
 *
 * Every section here either carries its own copy or is one the activation
 * binder fills from the merchant's catalogue (`preset-binding.ts`) — nothing
 * arrives as a blank frame. The hero and the magazine grid are authored in
 * the grid/cell shape the current sections use, so their v1 migration is a
 * pass-through rather than a reshape. The Looks row is automatic: it lists
 * whatever the merchant marks as a Look, and stays quiet until they do.
 */
export const WOMEN_FASHION_HOME_PRESET: SectionInstance[] = [
  // Full-bleed campaign image: the theme's own slider tokens already say
  // full/threeQuarters, but the hero states them so switching TO this theme
  // from a contained one actually changes the frame.
  instance(
    "women-fashion",
    1,
    "slideshow",
    { grid: "single", width: "full", height: "threeQuarters" },
    [{ type: "cell", settings: { kind: "image" } }],
  ),
  // The design's four tiles, names on the pictures. Untitled: the tiles
  // read as departments without a heading over them.
  instance("women-fashion", 2, "category-list", {
    variant: "overlay",
    title: "",
    source: "featured",
    limit: 4,
  }),
  instance(
    "women-fashion",
    3,
    "product-group",
    { variant: "centered", title: "Best Selling" },
    [
      { type: "tab", settings: { label: "Featured", source: "featured" } },
      { type: "tab", settings: { label: "New In", source: "latest" } },
      { type: "tab", settings: { label: "On Sale", source: "discounted" } },
    ],
  ),
  // The magazine grid: tall ends, two small tiles over a wide one — the
  // same "feature" shape as Electronics, dressed by the binder.
  instance(
    "women-fashion",
    4,
    "promotion-grid",
    { grid: "feature", width: "fixed", height: "half" },
    Array.from({ length: 5 }, () => ({
      type: "cell",
      settings: { kind: "image" },
    })),
  ),
  // Two collection rows, no heading over them — the panel carries each
  // row's name. Three pieces beside the panel, as drawn.
  instance(
    "women-fashion",
    5,
    "featured-collection",
    { title: "" },
    Array.from({ length: 2 }, () => ({
      type: "collection",
      settings: { limit: 3 },
    })),
  ),
  instance("women-fashion", 6, "countdown-offer", {
    variant: "deals-panel",
    subheading: "Today's Featured",
    heading: "Deals",
    ctaLabel: "View All Deals",
    link: "/products",
  }),
  // The paid boost rail, for the same reason Electronics carries one: home
  // placement depths are read from the PUBLISHED home's sponsored-rail, so a
  // starter without one makes home boosts unsellable on a fresh install.
  instance("women-fashion", 7, "sponsored-rail", { limit: 8 }),
  instance("women-fashion", 8, "get-the-look", {
    title: "Get the Look",
    subtitle: "Curated pieces styled together for effortless elegance",
    limit: 4,
    ctaLabel: "Add All to Cart",
  }),
  instance("women-fashion", 9, "looks-list", {
    title: "More Looks to Love",
    source: "looks",
    limit: 8,
  }),
  instance("women-fashion", 10, "blog-posts", {
    title: "Top Articles",
    limit: 3,
    desktopColumns: 3,
  }),
];

/**
 * The apparel product page: the side-rail gallery, which is the arrangement
 * a fashion PDP is drawn around — the shot column beside the buy box rather
 * than a thumbnail strip beneath it.
 *
 * Stated at all for the parity reason the Classic and Luxe product presets
 * are: Electronics publishes a bottom-gallery product page on activation, so
 * a theme that stayed silent here would leave Electronics' product page
 * published forever while its home page changed.
 */
export const WOMEN_FASHION_PRODUCT_PRESET: SectionInstance[] =
  getDefaultProductTemplateSections("left");

/**
 * Its chrome: the shipping promise above the header, the plain bar below.
 * Stated in full (bars included) because a group preset missing its required
 * core fails the write gate — which is exactly the check that keeps chrome
 * from being deleted by an activation.
 */
export const WOMEN_FASHION_GROUP_PRESETS = {
  header: [
    instance("women-fashion-header", 1, "announcement-bar", {
      text: "Complimentary shipping on all orders over $100",
    }),
    instance("women-fashion-header", 2, "header-bar", {}),
  ],
  footer: [instance("women-fashion-footer", 1, "footer-bar", {})],
};
