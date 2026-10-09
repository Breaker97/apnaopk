/**
 * GET /home and POST /events/sponsored.
 *
 * GET /home: the home screen as a list of blocks, in the order the merchant
 * arranged the storefront's home page. The web's home page is the one source:
 * there is no separate app home to edit. Each block is one section of it, and
 * its `id` is that section's.
 *
 * A store can gain a kind of block the installed app has never heard of, so the
 * response is typed loosely (`type` + `id`) and each known block has its own
 * schema in `HOME_BLOCKS`. The app draws the blocks it knows and skips the rest;
 * a new kind of block is therefore an additive change.
 *
 * Texts arrive in the path's language, prices formatted, pictures as
 * `ImageSet`s. What changes on a schedule (a slide's window, a coupon's dates,
 * a countdown, a paid placement) is decided when the answer is made, which can
 * be up to a minute before the app shows it: the app hides a countdown or a
 * coupon whose end has passed on its own clock.
 */
import * as z from "zod";

import { CollectionSummary, NamedLink, ProductCard, Rating } from "./catalog";
import { ImageSet, Money } from "./common";

/**
 * Where a tap leads: a path of the storefront on the web, such as
 * `/products?collection=summer`, or a full URL elsewhere. The app opens it as a
 * screen when it has one for that path (links.ts) and in a browser when it has
 * not.
 */
export const Href = z.string();

/** A button: its words, and where it leads. */
export const HomeCta = z.object({
  label: z.string(),
  href: Href.optional(),
});
export type HomeCta = z.infer<typeof HomeCta>;

export const GRADIENT_KINDS = ["LINEAR", "RADIAL"] as const;

/** A gradient: CSS angle in degrees (0 points up), stops at 0–100. */
export const Gradient = z.object({
  kind: z.enum(GRADIENT_KINDS),
  angle: z.number(),
  stops: z.array(
    z.object({
      color: z.string(),
      at: z.number(),
    }),
  ),
});
export type Gradient = z.infer<typeof Gradient>;

/**
 * What a surface is painted with, besides its picture: a colour (`#rrggbb`, or
 * `#rrggbbaa` with transparency), a gradient, a video that plays muted and
 * looping over the picture (the picture is its still), and how much the
 * picture or video is darkened (0–0.8) so the text on it reads.
 */
export const HomePaint = z.object({
  color: z.string().optional(),
  gradient: Gradient.optional(),
  video: z.string().optional(),
  overlay: z.number().optional(),
});
export type HomePaint = z.infer<typeof HomePaint>;

export const IMAGE_FITS = [
  /** The whole picture fills the frame, stretched: how the store's slides are made. */
  "STRETCH",
  /** The picture fills the frame, cropped to it. */
  "COVER",
] as const;
export const ImageFit = z.enum(IMAGE_FITS);
export type ImageFit = z.infer<typeof ImageFit>;

export const ALIGNMENTS = ["START", "CENTER", "END"] as const;
/** START is left in a left-to-right language and right in a right-to-left one. */
export const Alignment = z.enum(ALIGNMENTS);
export type Alignment = z.infer<typeof Alignment>;

/**
 * One slide of a carousel, or one picture of a grid. The store designs a slide
 * for a frame of a given shape; these are its contents for the frame it gets
 * on a phone.
 *
 * Draw, from the back: `background` (colour or gradient), `image` (fitted as
 * `imageFit` says), the video, the darkening, `artwork`, then the copy where
 * `align` puts it, in `textColor`.
 */
export const Slide = z.object({
  id: z.string(),
  /** The slide's picture. Left out when it is painted (`background`) instead. */
  image: ImageSet.optional(),
  /** Where a tap on the slide leads. */
  href: Href.optional(),
  imageFit: ImageFit,
  background: HomePaint.optional(),
  /** A product cut-out placed on the slide. */
  artwork: ImageSet.optional(),
  tagline: z.string().optional(),
  heading: z.string().optional(),
  description: z.string().optional(),
  /** The heading's colour, for the copy over the picture. */
  textColor: z.string().optional(),
  align: z
    .object({
      horizontal: Alignment,
      vertical: Alignment,
    })
    .optional(),
  cta: HomeCta.optional(),
  secondaryCta: HomeCta.optional(),
  /** The bound product's price, and the price before its discount. */
  price: Money.optional(),
  compareAtPrice: Money.optional(),
  /** ISO time a countdown on the slide runs to. */
  countdownEndsAt: z.string().optional(),
});
export type Slide = z.infer<typeof Slide>;

/**
 * One frame of a grid: a carousel. A single picture is a carousel of one
 * slide; a frame with no slides draws a quiet plate (the store left it
 * unassigned), so the grid keeps its shape.
 */
export const MediaFrame = z.object({
  id: z.string(),
  /** Width divided by height. Left out: as tall as the column beside it. */
  aspectRatio: z.number().optional(),
  slides: z.array(Slide),
  /** Seconds each slide stays before the next; left out, the shopper swipes. */
  autoplaySeconds: z.number().optional(),
});
export type MediaFrame = z.infer<typeof MediaFrame>;

/**
 * One row of a grid, laid out as the web lays it out on a phone. One column
 * runs the full width; two share it equally. Each column stacks its frames.
 */
export const MediaRow = z.object({
  columns: z.array(z.array(MediaFrame)),
});
export type MediaRow = z.infer<typeof MediaRow>;

/**
 * The store's hero. `aspectRatio` and `slides` are its main carousel (the
 * first frame). When the hero is a grid of several frames, `rows` describes it
 * whole, the main carousel included: draw `rows` instead.
 */
export const SlideshowBlock = z.object({
  type: z.literal("SLIDESHOW"),
  id: z.string(),
  /** Width divided by height. The picture fills the frame, stretched. */
  aspectRatio: z.number(),
  slides: z.array(Slide),
  autoplaySeconds: z.number().optional(),
  rows: z.array(MediaRow).optional(),
  /**
   * The hero carries the store's departments: the web shows the top-level
   * categories (GET /categories) as a row of chips above it on a phone.
   */
  showsCategories: z.boolean(),
});
export type SlideshowBlock = z.infer<typeof SlideshowBlock>;

/** A grid of promotional pictures and carousels. */
export const PromotionGridBlock = z.object({
  type: z.literal("PROMOTION_GRID"),
  id: z.string(),
  rows: z.array(MediaRow),
});
export type PromotionGridBlock = z.infer<typeof PromotionGridBlock>;

/** One promotional banner: a single slide in a frame of its own. */
export const BannerBlock = Slide.omit({ id: true }).extend({
  type: z.literal("BANNER"),
  id: z.string(),
  aspectRatio: z.number(),
});
export type BannerBlock = z.infer<typeof BannerBlock>;

export const CATEGORY_LIST_LAYOUTS = [
  "CARDS",
  "CIRCLES",
  /** Tall pictures with the name on them. */
  "OVERLAY",
] as const;

/** A category tile. A tap opens the category: `/categories/{slug}`. */
export const CategoryTile = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  image: ImageSet.optional(),
});
export type CategoryTile = z.infer<typeof CategoryTile>;

export const CategoryListBlock = z.object({
  type: z.literal("CATEGORY_LIST"),
  id: z.string(),
  title: z.string().optional(),
  categories: z.array(CategoryTile),
  layout: z.enum(CATEGORY_LIST_LAYOUTS),
});
export type CategoryListBlock = z.infer<typeof CategoryListBlock>;

/** A bento of categories: the first is the large tile, the rest share the grid beside it. */
export const CategoryMosaicBlock = z.object({
  type: z.literal("CATEGORY_MOSAIC"),
  id: z.string(),
  title: z.string().optional(),
  categories: z.array(CategoryTile),
});
export type CategoryMosaicBlock = z.infer<typeof CategoryMosaicBlock>;

/** A row of product cards. */
export const ProductRailBlock = z.object({
  type: z.literal("PRODUCT_RAIL"),
  id: z.string(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  products: z.array(ProductCard),
  /** Where "See all" leads. */
  href: Href.optional(),
});
export type ProductRailBlock = z.infer<typeof ProductRailBlock>;

/**
 * Paid placements: a row where the product holding position N is the Nth
 * card, and a position nobody bought shows a regular product. Every paid card
 * carries `sponsored`, and the app MUST label each of those cards "Sponsored":
 * the label is the legal disclosure. `title` is the store's word for a paid
 * shelf in this language and cannot be changed by the merchant; show it as it
 * is. The row is only sent while at least one of its cards is paid.
 */
export const SponsoredRailBlock = z.object({
  type: z.literal("SPONSORED_RAIL"),
  id: z.string(),
  title: z.string(),
  products: z.array(ProductCard),
});
export type SponsoredRailBlock = z.infer<typeof SponsoredRailBlock>;

/**
 * A grid of product cards. `browse` is present when the section is the
 * catalogue browser: more of the same come from GET /products with
 * `sort=NEWEST`, `limit=pageSize` and `cursor=nextCursor`, and a category chip
 * filters it with `category=<slug>` (from the first page). With `maxProducts`
 * the grid stops there (trim the last page to it) and offers the catalogue
 * for the rest; without it, it pages on for as long as the shopper scrolls.
 *
 * A grid of one category, brand or collection never has `browse` — it is a
 * fixed set of cards — and carries `href` instead: the page of that
 * category, brand or collection, where "See all" leads.
 */
export const ProductGridBlock = z.object({
  type: z.literal("PRODUCT_GRID"),
  id: z.string(),
  title: z.string().optional(),
  products: z.array(ProductCard),
  browse: z
    .object({
      categories: z.array(NamedLink),
      pageSize: z.number().int(),
      nextCursor: z.string().nullable(),
      /** The most cards the grid shows, in whole rows. */
      maxProducts: z.number().int().optional(),
    })
    .optional(),
  /** Where "See all" leads, for a grid of one category, brand or collection. */
  href: Href.optional(),
});
export type ProductGridBlock = z.infer<typeof ProductGridBlock>;

/**
 * Product rows under tabs ("New", "On sale"); the first tab shows first. A
 * tab of one category, brand or collection carries `href`, the page of that
 * category, brand or collection, where its "See all" leads.
 */
export const ProductTabsBlock = z.object({
  type: z.literal("PRODUCT_TABS"),
  id: z.string(),
  title: z.string().optional(),
  tabs: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      products: z.array(ProductCard),
      href: Href.optional(),
    }),
  ),
});
export type ProductTabsBlock = z.infer<typeof ProductTabsBlock>;

/**
 * Collections, each as a feature panel beside a few of its products. The
 * panel is a carousel of slides (often one); a tap on a panel with no link of
 * its own opens the collection, `href`.
 */
export const CollectionRowsBlock = z.object({
  type: z.literal("COLLECTION_ROWS"),
  id: z.string(),
  title: z.string().optional(),
  rows: z.array(
    z.object({
      id: z.string(),
      collection: z.object({
        slug: z.string(),
        title: z.string(),
      }),
      href: Href,
      panel: z.object({
        /** Width divided by height. */
        aspectRatio: z.number(),
        slides: z.array(Slide),
        autoplaySeconds: z.number().optional(),
      }),
      products: z.array(ProductCard),
    }),
  ),
});
export type CollectionRowsBlock = z.infer<typeof CollectionRowsBlock>;

/** Collections as cards; a tap opens `/collections/{slug}`. */
export const CollectionListBlock = z.object({
  type: z.literal("COLLECTION_LIST"),
  id: z.string(),
  title: z.string().optional(),
  collections: z.array(CollectionSummary),
});
export type CollectionListBlock = z.infer<typeof CollectionListBlock>;

export const BRAND_LIST_LAYOUTS = [
  "CARDS",
  /** Plain logos, evenly spaced. */
  "STRIP",
] as const;

/** Brand logos, untitled. */
export const BrandListBlock = z.object({
  type: z.literal("BRAND_LIST"),
  id: z.string(),
  layout: z.enum(BRAND_LIST_LAYOUTS),
  brands: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
      name: z.string(),
      logo: ImageSet.optional(),
      href: Href,
    }),
  ),
});
export type BrandListBlock = z.infer<typeof BrandListBlock>;

/** The best rated sellers, then the best selling. A tap opens `/vendors/{slug}`. */
export const VendorListBlock = z.object({
  type: z.literal("VENDOR_LIST"),
  id: z.string(),
  title: z.string().optional(),
  vendors: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
      name: z.string(),
      tagline: z.string().optional(),
      logo: ImageSet.optional(),
      banner: ImageSet.optional(),
      rating: Rating.optional(),
      unitsSold: z.number().int(),
      /** How expensive the seller is, in the store's currency symbol: "$", "$$", "$$$". */
      priceTier: z.string(),
    }),
  ),
});
export type VendorListBlock = z.infer<typeof VendorListBlock>;

export const COUNTDOWN_LAYOUTS = [
  /** A strip over a picture. */
  "BANNER",
  /** A painted panel with the deals laid out under the countdown. */
  "DEALS",
] as const;

/**
 * A deadline and what it is about. Hide the block once `endsAt` has passed:
 * a countdown frozen at zero advertises an offer that is over.
 */
export const CountdownBlock = z.object({
  type: z.literal("COUNTDOWN"),
  id: z.string(),
  layout: z.enum(COUNTDOWN_LAYOUTS),
  /** ISO time the countdown runs to. */
  endsAt: z.string(),
  heading: z.string().optional(),
  subheading: z.string().optional(),
  cta: HomeCta.optional(),
  /** BANNER: the picture behind the strip, covering it. */
  image: ImageSet.optional(),
  /** DEALS: the panel's own paint; left out, the app's own. */
  background: HomePaint.optional(),
  textColor: z.string().optional(),
  /** DEALS: the deals, in the merchant's slot order. */
  products: z.array(ProductCard),
  /** DEALS: "Up to 30% off", read off the deals themselves. */
  savingsLabel: z.string().optional(),
});
export type CountdownBlock = z.infer<typeof CountdownBlock>;

/**
 * A discount code: what it is worth, what it needs, and a way to copy it. Its
 * words are read off the discount at checkout, so they never promise more
 * than it gives. Hide it once `endsAt` has passed.
 */
export const CouponBlock = z.object({
  type: z.literal("COUPON"),
  id: z.string(),
  code: z.string(),
  offer: z.string(),
  condition: z.string().optional(),
  /** "Ends 12 Oct", when the store shows the end. */
  endsOn: z.string().optional(),
  /** ISO time the discount ends. */
  endsAt: z.string().optional(),
  cta: HomeCta.optional(),
  image: ImageSet.optional(),
  background: HomePaint.optional(),
});
export type CouponBlock = z.infer<typeof CouponBlock>;

/** One styled outfit: its picture and the pieces in it, to add to the cart together. */
export const LookBlock = z.object({
  type: z.literal("LOOK"),
  id: z.string(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  look: z.object({
    slug: z.string(),
    title: z.string(),
  }),
  image: ImageSet,
  /** START: the picture comes first (on the left, on a wide screen). */
  imagePosition: Alignment,
  products: z.array(ProductCard),
  /** The words on the "add all to cart" button. */
  ctaLabel: z.string().optional(),
});
export type LookBlock = z.infer<typeof LookBlock>;

/** A row of Looks (outfits kept as collections); a tap opens `/collections/{slug}`. */
export const LookListBlock = z.object({
  type: z.literal("LOOK_LIST"),
  id: z.string(),
  title: z.string().optional(),
  /** Every picture's width divided by its height. */
  aspectRatio: z.number(),
  looks: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
      title: z.string(),
      image: ImageSet,
    }),
  ),
});
export type LookListBlock = z.infer<typeof LookListBlock>;

/**
 * Formatted text, as sanitized HTML: paragraphs, headings, lists, links,
 * bold and italic. Links carry web paths or full URLs, like `Href`.
 */
export const RichTextBlock = z.object({
  type: z.literal("RICH_TEXT"),
  id: z.string(),
  heading: z.string().optional(),
  html: z.string(),
});
export type RichTextBlock = z.infer<typeof RichTextBlock>;

/** A picture beside formatted text (sanitized HTML, as in RICH_TEXT). */
export const ImageTextBlock = z.object({
  type: z.literal("IMAGE_TEXT"),
  id: z.string(),
  image: ImageSet.optional(),
  /** START: the picture comes first. */
  imagePosition: Alignment,
  heading: z.string().optional(),
  html: z.string().optional(),
  cta: HomeCta.optional(),
});
export type ImageTextBlock = z.infer<typeof ImageTextBlock>;

export const HEADING_SIZES = ["SMALL", "MEDIUM", "LARGE"] as const;

/** A heading of its own. `accent` continues it in the store's accent treatment. */
export const HeadingBlock = z.object({
  type: z.literal("HEADING"),
  id: z.string(),
  title: z.string(),
  accent: z.string().optional(),
  align: Alignment,
  size: z.enum(HEADING_SIZES),
});
export type HeadingBlock = z.infer<typeof HeadingBlock>;

/** Empty space between blocks. */
export const SpacerBlock = z.object({
  type: z.literal("SPACER"),
  id: z.string(),
  /** Points (density-independent pixels). */
  height: z.number(),
});
export type SpacerBlock = z.infer<typeof SpacerBlock>;

/** A row of square pictures, each covering its frame. */
export const ImageGalleryBlock = z.object({
  type: z.literal("IMAGE_GALLERY"),
  id: z.string(),
  title: z.string().optional(),
  images: z.array(
    z.object({
      id: z.string(),
      image: ImageSet,
      href: Href.optional(),
    }),
  ),
});
export type ImageGalleryBlock = z.infer<typeof ImageGalleryBlock>;

/** The newest articles of the store's blog. The app opens `href` (`/blog/{slug}`). */
export const ArticleListBlock = z.object({
  type: z.literal("ARTICLE_LIST"),
  id: z.string(),
  title: z.string().optional(),
  articles: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
      title: z.string(),
      excerpt: z.string().optional(),
      image: ImageSet.optional(),
      authorName: z.string(),
      /** ISO time it was published. */
      publishedAt: z.string().optional(),
      href: Href,
    }),
  ),
});
export type ArticleListBlock = z.infer<typeof ArticleListBlock>;

/** What customers wrote in their reviews. */
export const TestimonialsBlock = z.object({
  type: z.literal("TESTIMONIALS"),
  id: z.string(),
  title: z.string().optional(),
  testimonials: z.array(
    z.object({
      id: z.string(),
      rating: z.number(),
      title: z.string().optional(),
      comment: z.string(),
      reviewerName: z.string().optional(),
    }),
  ),
});
export type TestimonialsBlock = z.infer<typeof TestimonialsBlock>;

export const BENEFIT_ICONS = [
  "TRUCK",
  "SHIELD",
  "RETURNS",
  "SUPPORT",
  "WALLET",
  "DISCOUNT",
  "GIFT",
] as const;

/** The store's promises: delivery, returns, support. An icon the app does not know draws a plain one. */
export const BenefitsBlock = z.object({
  type: z.literal("BENEFITS"),
  id: z.string(),
  items: z.array(
    z.object({
      id: z.string(),
      icon: z.enum(BENEFIT_ICONS),
      title: z.string(),
      text: z.string().optional(),
    }),
  ),
});
export type BenefitsBlock = z.infer<typeof BenefitsBlock>;

/** Questions and their answers (plain text). */
export const FaqBlock = z.object({
  type: z.literal("FAQ"),
  id: z.string(),
  title: z.string().optional(),
  items: z.array(
    z.object({
      id: z.string(),
      question: z.string(),
      answer: z.string(),
    }),
  ),
});
export type FaqBlock = z.infer<typeof FaqBlock>;

/** An invitation to sell on the store; its button leads to the web's sign-up. */
export const SellerInviteBlock = z.object({
  type: z.literal("SELLER_INVITE"),
  id: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  image: ImageSet.optional(),
  cta: HomeCta,
});
export type SellerInviteBlock = z.infer<typeof SellerInviteBlock>;

export const HOME_BLOCKS = {
  SLIDESHOW: SlideshowBlock,
  PROMOTION_GRID: PromotionGridBlock,
  BANNER: BannerBlock,
  CATEGORY_LIST: CategoryListBlock,
  CATEGORY_MOSAIC: CategoryMosaicBlock,
  PRODUCT_RAIL: ProductRailBlock,
  SPONSORED_RAIL: SponsoredRailBlock,
  PRODUCT_GRID: ProductGridBlock,
  PRODUCT_TABS: ProductTabsBlock,
  COLLECTION_ROWS: CollectionRowsBlock,
  COLLECTION_LIST: CollectionListBlock,
  BRAND_LIST: BrandListBlock,
  VENDOR_LIST: VendorListBlock,
  COUNTDOWN: CountdownBlock,
  COUPON: CouponBlock,
  LOOK: LookBlock,
  LOOK_LIST: LookListBlock,
  RICH_TEXT: RichTextBlock,
  IMAGE_TEXT: ImageTextBlock,
  HEADING: HeadingBlock,
  SPACER: SpacerBlock,
  IMAGE_GALLERY: ImageGalleryBlock,
  ARTICLE_LIST: ArticleListBlock,
  TESTIMONIALS: TestimonialsBlock,
  BENEFITS: BenefitsBlock,
  FAQ: FaqBlock,
  SELLER_INVITE: SellerInviteBlock,
} as const;

export type HomeBlock =
  | SlideshowBlock
  | PromotionGridBlock
  | BannerBlock
  | CategoryListBlock
  | CategoryMosaicBlock
  | ProductRailBlock
  | SponsoredRailBlock
  | ProductGridBlock
  | ProductTabsBlock
  | CollectionRowsBlock
  | CollectionListBlock
  | BrandListBlock
  | VendorListBlock
  | CountdownBlock
  | CouponBlock
  | LookBlock
  | LookListBlock
  | RichTextBlock
  | ImageTextBlock
  | HeadingBlock
  | SpacerBlock
  | ImageGalleryBlock
  | ArticleListBlock
  | TestimonialsBlock
  | BenefitsBlock
  | FaqBlock
  | SellerInviteBlock;

/** A block before the app has checked whether it knows its type. */
export const RawHomeBlock = z.looseObject({
  type: z.string(),
  id: z.string(),
});
export type RawHomeBlock = z.infer<typeof RawHomeBlock>;

export const Home = z.object({
  blocks: z.array(RawHomeBlock),
});
export type Home = z.infer<typeof Home>;

export const SPONSORED_PLACEMENTS = [
  /** A card of a SPONSORED_RAIL block. */
  "HOME",
  /** A card of GET /products marked `sponsored`. */
  "LISTING",
  /** A card of a product's `sponsoredRail`. */
  "PRODUCT_PAGE",
] as const;

export const SPONSORED_EVENT_KINDS = [
  /** The card came into view. */
  "IMPRESSION",
  /** The card was opened. */
  "CLICK",
] as const;

/**
 * POST /events/sponsored: impressions and clicks of the cards marked
 * `sponsored`, for the vendors who paid for them. Send them in batches, at
 * most one impression per card per screen visit; the app never waits for the
 * answer and never retries one.
 */
export const SponsoredEventsRequest = z.object({
  events: z
    .array(
      z.object({
        /** The card's `sponsored.campaignId`. */
        campaignId: z.string().regex(/^[0-9a-fA-F]{24}$/),
        placement: z.enum(SPONSORED_PLACEMENTS),
        kind: z.enum(SPONSORED_EVENT_KINDS),
      }),
    )
    .min(1)
    .max(50),
});
export type SponsoredEventsRequest = z.infer<typeof SponsoredEventsRequest>;

/** How many of the events were counted: an ended campaign's are not. */
export const SponsoredEventsResult = z.object({
  recorded: z.number().int(),
});
export type SponsoredEventsResult = z.infer<typeof SponsoredEventsResult>;
