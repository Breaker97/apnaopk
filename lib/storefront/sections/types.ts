import type { ComponentType, ReactNode } from "react";
import type { Locale } from "@/config/i18n.config";
import type { RequestLocation } from "@/lib/locations/shopper-location";
import type { StoreTemplateType } from "@/lib/storefront/pages/handles";

/**
 * Storefront-visible text. Plain strings are the pre-translation shape every
 * existing document carries; a per-locale record is what translated fields
 * store. Both are always valid — resolve through `lt()` (localized.ts), never
 * by indexing directly.
 */
export type LocalizedText = string | Record<string, string>;

/**
 * Where a section instance may live. "template" is the page body (home,
 * landing pages, and P6 template pages); "header"/"footer" are the shared
 * P8 section groups. Absent on a definition means ["template"].
 */
export type SectionZone = "template" | "header" | "footer";

/**
 * The resource a template page resolves for its sections (the product on
 * the product template, the resolved category/collection on theirs, …).
 */
type TemplateResourceType =
  | "product"
  | "products"
  | "category"
  | "collection"
  | "cart";

/** Raw storefront searchParams, forwarded to listing cores untouched. */
type TemplateSearchParams = Record<
  string,
  string | string[] | undefined
>;

/**
 * Template resources are typed structurally-minimal here so this module
 * stays client-light; core sections read the rest through the index
 * signature exactly as the hand-wired pages did. Every listing resource
 * carries the raw searchParams and the shopper's coarse request location —
 * the two request-scoped inputs sections cannot resolve themselves.
 */
interface ProductTemplateResource {
  type: "product";
  /** Serialized product-detail doc (lib/products/storefront-product-detail). */
  product: {
    _id: string;
    slug: string;
    name: string;
  } & Record<string, unknown>;
  location: RequestLocation;
}

export interface ProductsTemplateResource {
  type: "products";
  searchParams: TemplateSearchParams;
  location: RequestLocation;
}

export interface CategoryTemplateResource {
  type: "category";
  /** Resolved category (lib/storefront-categories). */
  category: {
    _id: string;
    slug: string;
    name: string;
  } & Record<string, unknown>;
  searchParams: TemplateSearchParams;
  location: RequestLocation;
}

export interface CollectionTemplateResource {
  type: "collection";
  /**
   * The ONE `getStorefrontCollectionDetail` response, resolved by the page:
   * header, grid, and pagination sections all read the same fetch.
   */
  collection: {
    _id: string;
    slug: string;
    title: string;
  } & Record<string, unknown>;
  products: unknown[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  searchParams: TemplateSearchParams;
  location: RequestLocation;
}

/** The bag lives in the client cart store — nothing to resolve server-side. */
interface CartTemplateResource {
  type: "cart";
}

export type TemplateResource =
  | ProductTemplateResource
  | ProductsTemplateResource
  | CategoryTemplateResource
  | CollectionTemplateResource
  | CartTemplateResource;

/** Tabs of the "add section" picker (P1). */
export type SectionCategory =
  | "promotions"
  | "products"
  | "categories"
  | "content"
  | "more";

// ============================================
// Field vocabulary
// ============================================
//
// One entry per setting a section exposes. The field list is the single
// source the normalizer (and, from P1, the generated editor and the write
// validator) derive from — a section never hand-writes normalization again.
// The vocabulary grows only alongside a consumer; don't add speculative types.

interface BaseField {
  key: string;
  /**
   * One line under the label explaining what the control does when the label
   * cannot say it alone — "the first pick fills the large card". English
   * fallback; the editor overlays `admin.storeBuilder.fieldHints.<key>`.
   */
  hint?: string;
  /**
   * Editor-only: how much of an inspector row the control takes. The editor
   * infers a width from the type (a number is a third, a text a half, a
   * list the whole row); set this where the inference packs the form badly —
   * a short title that should share its row with the numbers beside it.
   */
  width?: "third" | "half" | "full";
  /**
   * Editor-only: show this control only while a sibling setting holds one
   * of the listed values — a product picker that only matters when the
   * tab's source is "manual". The stored value is untouched either way, so
   * switching back brings the picks straight back.
   */
  showWhen?: { key: string; values: readonly (string | boolean)[] };
  /**
   * Variant keys this field applies to. Absent means every design uses it.
   *
   * A variant may legitimately ignore a setting the others read (the deals
   * panel takes the store's own colour instead of artwork). Listing the
   * designs that DO read it hides the control from the editor under the
   * others, so a merchant never fills in a box that changes nothing.
   *
   * Editor-only: the stored value is never touched, so switching back to a
   * design that reads the field brings the old value back with it.
   */
  variants?: string[];
}

interface TextField extends BaseField {
  type: "text";
  /** Storefront-visible copy stores per-locale values; ids/handles don't. */
  translatable?: boolean;
  default?: LocalizedText;
}

interface TextareaField extends BaseField {
  type: "textarea";
  translatable?: boolean;
  default?: LocalizedText;
}

/**
 * TipTap HTML. Stored sanitized: the write path runs every locale value
 * through `sanitizeHtml()` before it reaches the document, and renderers
 * sanitize again at output like the content pages do.
 */
interface RichTextField extends BaseField {
  type: "richtext";
  translatable?: boolean;
  default?: LocalizedText;
}

/** ISO datetime string (countdown targets, schedule bounds). */
interface DatetimeField extends BaseField {
  type: "datetime";
  default?: string;
}

interface ToggleField extends BaseField {
  type: "toggle";
  default: boolean;
}

/** A single collection id. */
interface CollectionField extends BaseField {
  type: "collection";
  default?: string;
}

/** A single product id (the slide "product binding"). */
interface ProductField extends BaseField {
  type: "product";
  default?: string;
}

/** A CSS hex color (#rgb / #rrggbb), or empty for "none". */
interface ColorField extends BaseField {
  type: "color";
  default?: string;
}

export interface SelectField extends BaseField {
  type: "select";
  options: readonly string[];
  default: string;
}

export interface NumberField extends BaseField {
  type: "number";
  default: number;
  min: number;
  max: number;
}

/** A media URL from the upload pipeline (R2/local), stored as-is. */
interface ImageField extends BaseField {
  type: "image";
  default?: string;
}

/** A link target: internal path or absolute URL, matching Shopify's `url`. */
interface UrlField extends BaseField {
  type: "url";
  default?: string;
}

interface ProductListField extends BaseField {
  type: "productList";
  /**
   * How many picks the section can actually use. The editor stops accepting
   * more and normalization truncates, so a merchant never chooses an eighth
   * product for a five-slot design and wonders where it went.
   */
  max?: number;
}

interface CategoryListField extends BaseField {
  type: "categoryList";
}

/**
 * A discount CODE from Online Store → Discounts, stored as the code string
 * rather than an id: the code is what a shopper types at checkout and what
 * the storefront prints, so a banner keeps showing the code it was given
 * even after that discount is renamed or deleted — a stale code a merchant
 * can see beats a silently empty strip.
 */
interface CouponField extends BaseField {
  type: "coupon";
  default?: string;
}

/**
 * A saved Slider handle (Online Store → Sliders) — the reusable slide-group
 * resource. Stored as the handle string so renaming a slider never orphans
 * the sections that picked it (handles are stable; names aren't).
 */
interface SliderField extends BaseField {
  type: "slider";
  default?: string;
}

/**
 * INLINE slides — a full slide list owned by the section instance itself,
 * not a reference to the saved-slider library. Normalized (read and write)
 * by `normalizeSlides` from lib/sliders/types, the same tamper-proof
 * contract the slider documents pass through. Edited only by a bespoke
 * studio (the generic field renderer skips it).
 */
interface SlidesField extends BaseField {
  type: "slides";
}

/**
 * A solid colour, a gradient, or an uploaded image — the slider's
 * background contract (`SlideBackground` from lib/sliders/types), normalized
 * on read and write by its own `normalizeBackground`. `{ type: "solid" }`
 * with no colour means "none": the surface keeps its own paint.
 */
interface BackgroundField extends BaseField {
  type: "background";
}

export type Field =
  | TextField
  | TextareaField
  | RichTextField
  | SelectField
  | NumberField
  | ImageField
  | UrlField
  | DatetimeField
  | ToggleField
  | CollectionField
  | ProductField
  | ColorField
  | ProductListField
  | CategoryListField
  | SliderField
  | SlidesField
  | BackgroundField
  | CouponField;

// ============================================
// Stored instances (the shape inside StorePage documents)
// ============================================

/**
 * Storage limits, stated here rather than beside the zod schemas that
 * enforce them: they are a CONTRACT both planes need. The write gate
 * refuses past them and reads truncate to them (`instances.ts`), and the
 * builder has to know them too — a cap the editor cannot see becomes a
 * failed autosave instead of a disabled button.
 */

/** Perf guardrail: streaming keeps TTFB flat but total work is real. */
export const MAX_SECTIONS_PER_PAGE = 25;
/** Shopify parity; individual block definitions may cap tighter. */
export const MAX_BLOCKS_PER_SECTION = 50;

export interface BlockInstance {
  /** Stable id: React key, reorder identity, preview targeting. */
  id: string;
  type: string;
  visible: boolean;
  settings: Record<string, unknown>;
}

export interface SectionInstance {
  id: string;
  /** Registry key. Unknown types render nothing rather than crash. */
  type: string;
  /** Definition version at write time; `migrate()` upgrades on read. */
  version: number;
  visible: boolean;
  settings: Record<string, unknown>;
  blocks?: BlockInstance[];
}

// ============================================
// Definition contract
// ============================================

/** The slice of context availability gates may depend on. */
export interface SectionAvailabilityContext {
  isMultiVendorEnabled: boolean;
}

export interface SectionRenderContext extends SectionAvailabilityContext {
  locale: Locale;
  /** Admin default language — the fallback locale for `lt()`. */
  defaultLanguage: string;
  /** Active theme id — selects per-theme section overrides at render. */
  themeId: string;
  /**
   * The active theme's normalized setting values (containerWidth,
   * sliderWidth, …). Sections whose own width/height is set to "theme"
   * resolve against these. Optional so bespoke render surfaces that predate
   * the field keep compiling — absent means section defaults apply.
   */
  themeSettings?: Record<string, unknown>;
  /**
   * Which template page is rendering. Absent on landing pages — they are
   * free-form content surfaces.
   */
  templateType?: StoreTemplateType;
  /**
   * The template's resolved resource (the product on /products/[slug]),
   * resolved ONCE by the page and shared by every section that declares a
   * `resourceType`. Absent outside resource templates.
   */
  resource?: TemplateResource;
  /**
   * This is an admin PREVIEW (the /draft routes), not the live storefront.
   *
   * Sections with nothing to show render a labelled placeholder here instead
   * of nothing, so a merchant reviewing a freshly applied theme sees the
   * whole design and which blocks still need content. Shoppers must never
   * see those placeholders — an empty box on a live storefront reads as a
   * broken store — so the live pages leave this unset.
   */
  preview?: boolean;
}

export interface SectionRenderProps {
  sectionId: string;
  /** Normalized against `fields`: every key present, values clamped. */
  settings: Record<string, unknown>;
  /** Normalized against `blocks`: unknown block types already dropped. */
  blocks: BlockInstance[];
  ctx: SectionRenderContext;
}

export interface BlockDefinition {
  type: string;
  fields: Field[];
  /** Hard cap; normalize truncates beyond it. Omit for no limit. */
  max?: number;
}

/**
 * A pre-developed design for a section — the "pick a different layout for
 * this block" catalog the builder offers.
 *
 * The chosen key is stored on the INSTANCE (`settings.variant`), not derived
 * from the active theme, because it is a merchant decision: swapping the
 * collection shelf to the promo-row design must survive a theme switch. A
 * theme influences it only by naming variants in its starter preset, which
 * is what makes activating a theme deliver its whole look.
 *
 * The registry turns `variants` into a `variant` select field automatically,
 * so normalization, the write gate, and migration all cover it for free —
 * an unknown or removed key falls back to the first variant on read.
 */
export interface SectionVariant {
  /** Stored value. STABLE — renaming one silently resets live documents. */
  key: string;
  /** English fallback; the editor overlays `…sections.<type>.variants.<key>`. */
  name: string;
  Render: (props: SectionRenderProps) => ReactNode | Promise<ReactNode>;
  /** Suspense fallback for this design; falls back to the section's own. */
  Skeleton?: ComponentType<{ settings: Record<string, unknown> }>;
}

/** The settings key the registry reserves for the variant select. */
export const VARIANT_FIELD_KEY = "variant";

/**
 * The settings key the registry reserves for a section's title size.
 *
 * Derived rather than declared: every section that shows a title gets the
 * same three steps, so a merchant does not meet the control on one block and
 * miss it on the next. Sections that own their heading outright — the
 * standalone Heading block, whose whole job is that one line — declare a
 * `size` field instead and are skipped.
 */
export const TITLE_SIZE_FIELD_KEY = "titleSize";
export const SECTION_TITLE_SIZES = ["small", "medium", "large"] as const;
export type SectionTitleSize = (typeof SECTION_TITLE_SIZES)[number];
/**
 * "default" leads the list and IS the default: it means "the size this
 * heading has always been", so the control appears on every titled section
 * without changing a single one until it is used.
 */
export const SECTION_TITLE_SIZE_OPTIONS = [
  "default",
  ...SECTION_TITLE_SIZES,
] as const;

/**
 * What the "add section" picker inserts: settings merged over field defaults
 * and starter blocks (ids are generated at insert time). Absent means an
 * instance built purely from defaults.
 */
export interface SectionStarter {
  settings?: Record<string, unknown>;
  blocks?: { type: string; settings?: Record<string, unknown> }[];
}

/**
 * JSON-safe projection of a definition for the client-side editor: fields
 * and blocks are pure data, functions (Render, available, migrate) are
 * resolved or dropped. Built by `catalog.ts` on the server, passed to the
 * builder as props.
 */
export interface SectionCatalogEntry {
  type: string;
  version: number;
  category: SectionCategory;
  suggested: boolean;
  /** English fallbacks; the admin UI overlays i18n keys derived from type. */
  name: string;
  description: string;
  /** maxPerPage === 1 — the picker disables the tile once one exists. */
  singleton: boolean;
  /** availability gate, already evaluated against current settings. */
  available: boolean;
  /** Placement contract (see SectionDefinition) — the picker filters on it. */
  templates?: StoreTemplateType[];
  zones?: SectionZone[];
  required?: boolean;
  locked?: boolean;
  /** Pre-developed designs, for the inspector's visual variant picker. */
  variants?: { key: string; name: string }[];
  fields: Field[];
  blocks: { type: string; fields: Field[]; max?: number }[];
  starter?: SectionStarter;
}

export interface SectionDefinition {
  type: string;
  /** Bump together with a `migrate` step on breaking settings changes. */
  version: number;
  category: SectionCategory;
  /** Extra "Suggested" tab placement in the P1 picker. */
  suggested?: boolean;
  /**
   * Render-enforced instance cap. Reserved for placements where a duplicate
   * is a policy violation, not a style choice (the paid sponsored rail).
   */
  maxPerPage?: number;
  /**
   * Template pages this section may be placed on. ABSENT means any content
   * surface (home, landing pages, and the flexible areas of every template)
   * — the shape of all P1 sections. Template-core sections (P6) list exactly
   * their own template; that also keeps them off landing pages, which never
   * carry a template resource.
   */
  templates?: StoreTemplateType[];
  /** Zones this section may live in. Absent means ["template"] (page body). */
  zones?: SectionZone[];
  /**
   * The template is invalid without it: the write gate refuses a template
   * page that lacks it and starters must include it. Registry enforces that
   * required sections declare `templates` and are `locked`.
   */
  required?: boolean;
  /**
   * Non-removable in the editor and not saveable to the section library;
   * settings and blocks stay fully editable. Template cores pair this with
   * `required` and `maxPerPage: 1`.
   */
  locked?: boolean;
  /**
   * Resource this section renders. P6 template renderers resolve it once
   * per request and pass it via `SectionRenderContext`.
   */
  resourceType?: TemplateResourceType;
  /**
   * Pre-developed designs for this section. The registry appends the matching
   * `variant` select to `fields`, so a definition declares them once and the
   * editor, normalizer, and write gate all pick them up. The FIRST entry is
   * the default — keep it the design existing documents already render, or
   * every stored instance silently changes shape.
   */
  variants?: SectionVariant[];
  fields: Field[];
  blocks?: BlockDefinition[];
  starter?: SectionStarter;
  /** Feature gate (e.g. multi-vendor sections). Absent means always on. */
  available?: (ctx: SectionAvailabilityContext) => boolean;
  /** Upgrades settings/blocks written by an older definition version. */
  migrate?: (instance: SectionInstance, fromVersion: number) => SectionInstance;
  /** Async server component; fetches its own data like today's sections. */
  Render: (props: SectionRenderProps) => ReactNode | Promise<ReactNode>;
  /**
   * Suspense fallback for data-fetching sections. Synchronous sections omit
   * it and render inline — exactly the split the home page draws today.
   * `ctx` is passed by the section renderer so a skeleton can mirror
   * theme-dependent framing (e.g. "theme" width/height); older skeletons
   * simply ignore it.
   */
  Skeleton?: ComponentType<{
    settings: Record<string, unknown>;
    ctx?: SectionRenderContext;
  }>;
}
