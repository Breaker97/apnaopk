import type { ProductCardTemplateId } from "@/lib/products/product-card-config";
import type {
  StoreGroupType,
  StoreTemplateType,
} from "@/lib/storefront/pages/handles";
import type { SectionInstance } from "@/lib/storefront/sections/types";
import type { ThemeTokenOverrides } from "./tokens";

/**
 * A theme, as data: identity, token defaults, component overrides (by id,
 * in `overrides.tsx`) and per-theme presets.
 *
 * Deliberately pure (no components, no server imports): the admin theme
 * gallery renders these on the client, and the theme editor generates its
 * controls from the token schema in `tokens.ts`.
 */
export interface ThemeManifest {
  id: string;
  version: string;
  status: "stable" | "coming-soon";
  /** English fallbacks; admin UI overlays i18n keys derived from id. */
  name: string;
  description: string;
  /** Gallery card gradient (the existing Themes page visual language). */
  accent: string;
  /**
   * Real storefront screenshots bundled under /public/templates/<id>/ —
   * the gallery card and install-wizard picker render `card`; `mobile`
   * feeds the public template gallery. Absent (an in-development theme)
   * the UIs fall back to the accent gradient.
   */
  preview?: { card: string; mobile: string };
  /**
   * Component fallback chain: a section type without an override here
   * resolves through the parent, ending at the base library. Overrides
   * themselves live in the server-only `overrides.tsx`, keyed by theme id —
   * this field documents the chain, resolution walks it.
   */
  extends?: string;
  /**
   * What makes this theme look like itself: a partial over the engine's
   * `BASE_THEME_TOKENS` (`themes/tokens.ts`). Every token the manifest
   * leaves out comes from the base. Merchant edits are stored per theme as
   * a partial over THIS. Content NEVER lives here — tokens restyle the
   * store, they don't populate it — and neither does CSS: a template is a
   * token set, so `globals.css` carries no per-theme block.
   */
  tokens?: ThemeTokenOverrides;
  /**
   * The design each section type wears under this theme. Keys are section
   * types, values variant keys; entries that resolve to no design are
   * ignored. Two readers:
   *
   * - Sections that follow the template (`designFollowsTheme`) render this
   *   design live whenever their stored value is "theme" — the listing,
   *   category and cart pages restyle on a template switch through this map
   *   and nothing else.
   * - Every other section is only affected when the admin INSERTS one from
   *   the picker, so a new block arrives in the template's look instead of
   *   the first (legacy) variant. Starter presets name their variants
   *   explicitly; this covers what gets added afterwards, and stored
   *   documents are never rewritten by it.
   */
  preferredVariants?: Record<string, string>;
  /**
   * How titles are drawn on the store pages no section owns — the compare
   * and all-categories pages — and on the shelves that take the template's
   * treatment rather than a setting of their own (blog posts, sponsored).
   * "two-tone" is the gradient heading; absent means plain.
   */
  headingStyle?: "two-tone" | "plain";
  /**
   * The all-categories page's tiles: bordered cards with the category's
   * description (absent), or square picture tiles. Both pages search and
   * paginate the same way — only the tiles differ.
   */
  categoriesPage?: "cards" | "tiles";
  /**
   * The product card template this theme's listings are designed around,
   * seeded into `settings.productCard` on activation (see
   * `applyThemeStarter`) so every grid, shelf and search result wears the
   * theme's card. Absent = the shipped default card. The merchant tweaks
   * from there in Online store → Product card; a customized card survives
   * a "keep" switch.
   */
  productCard?: ProductCardTemplateId;
  /**
   * Starter section lists, seeded as a DRAFT on activation and only for
   * pages that don't exist yet (a fresh install). Existing pages are never
   * touched — content survives every switch, publish stays an explicit act.
   * Keyed by template type (and, from P8, by section group).
   */
  presets?: {
    templates?: Partial<Record<StoreTemplateType, SectionInstance[]>>;
    groups?: Partial<Record<StoreGroupType, SectionInstance[]>>;
  };
}
