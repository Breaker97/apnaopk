import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Package } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { getStorefrontCategories } from "@/lib/storefront/storefront-categories";
import {
  RAIL_CATEGORY_LIMIT,
  RAIL_ICON_CLASS,
  RAIL_LINK_CLASS,
  RAIL_LIST_CLASS,
  RAIL_PANEL_CLASS,
  RAIL_ROW_CLASS,
} from "@/lib/storefront/sections/category-rail";
import { cn } from "@/lib/utils";
import type { Locale } from "@/config/i18n.config";

/**
 * The Hero Slider's static category cell: a light, headerless department
 * list (the list IS the header — there is no "All Categories" bar above
 * it). It fills whatever grid area the chosen slider grid assigns it and is
 * not editable from the builder — its content is always the store's root
 * categories.
 *
 * The metrics and the limit live in `lib/storefront/sections/category-rail`
 * because the builder's preview renders the same rail and must not drift
 * from it.
 *
 * The design's literal values in LIGHT mode (#f2f2f2 panel, #e7e2ff
 * hairline, #474747 labels) with a token fallback under `dark:`: the mockup
 * only specifies the light appearance, and this is a navigation list, not
 * artwork, so a fixed light panel would be a glaring white block on a dark
 * page.
 */
export async function CategoryRailCard({
  locale,
  className,
}: {
  locale: Locale;
  className?: string;
}) {
  const t = await getTranslations({ locale });

  const roots =
    (await getStorefrontCategories().catch(() => null))?.categories?.slice(
      0,
      RAIL_CATEGORY_LIMIT,
    ) ?? [];

  // An empty catalog keeps the panel (the grid reserves its area either
  // way) but renders it as a quiet plate instead of a dead list.
  return (
    <nav
      aria-label={t("common.allCategories")}
      // `[border-width:0.5px]`, not `border-[0.5px]` — the latter generates
      // no rule at all (Tailwind reads it as a colour slot). Chrome floors
      // sub-pixel borders to one device pixel; Safari draws true hairlines.
      className={cn(RAIL_PANEL_CLASS, "rounded-xl", className)}
    >
      {roots.length > 0 ? (
        <ul className={RAIL_LIST_CLASS}>
          {roots.map((category) => (
            <li key={category._id} className={RAIL_ROW_CLASS}>
              <Link
                href={`/${locale}/categories/${encodeURIComponent(category.slug)}`}
                className={cn(
                  RAIL_LINK_CLASS,
                  "transition-opacity hover:opacity-70",
                )}
              >
                <span className={RAIL_ICON_CLASS}>
                  {category.icon || category.image ? (
                    <AppImage
                      src={(category.icon || category.image) as string}
                      alt=""
                      className="h-[22px] w-[22px] rounded-sm object-contain"
                      width={22}
                      height={22}
                    />
                  ) : (
                    <Package className="h-[21px] w-[21px]" aria-hidden />
                  )}
                </span>
                <span className="truncate">{category.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </nav>
  );
}

/**
 * The same departments as a scrollable chip row, for the widths where the
 * rail's grid column does not exist (below lg). The panel is a tall list
 * pinned beside the hero; on a phone that shape has nowhere to live, so it
 * would simply vanish — and with it the store's whole category entry point
 * above the fold. A chip row keeps the links, costs one line, and reads as
 * scrollable through the trailing fade.
 *
 * Same source and same limit as the panel, so the two never list different
 * departments; `getStorefrontCategories` is cached, so rendering both on one
 * page is a single query.
 */
export async function CategoryRailChips({
  locale,
  className,
}: {
  locale: Locale;
  className?: string;
}) {
  const t = await getTranslations({ locale });

  const roots =
    (await getStorefrontCategories().catch(() => null))?.categories?.slice(
      0,
      RAIL_CATEGORY_LIMIT,
    ) ?? [];

  // Unlike the panel, this row reserves no space of its own: with no
  // categories there is nothing to scroll and the hero simply starts higher.
  if (roots.length === 0) return null;

  return (
    <nav
      // The header's own tag row is seeded from these same departments on a
      // themed store, so a globals.css rule stands this row down whenever the
      // header renders one — two identical rows a few pixels apart is worse
      // than either alone. Stores whose header carries no tags keep it.
      data-hero-category-chips
      aria-label={t("common.allCategories")}
      className={cn(
        "flex snap-x gap-2 overflow-x-auto pb-1 scrollbar-none [&::-webkit-scrollbar]:hidden",
        // The fade states "there is more this way" — without it a chip sliced
        // by the viewport edge reads as a rendering bug. It follows the
        // writing direction, so the cue sits on the edge the row scrolls to.
        "[mask-image:linear-gradient(to_right,#000_86%,transparent)] rtl:[mask-image:linear-gradient(to_left,#000_86%,transparent)]",
        "[scroll-padding-inline:0.5rem]",
        className,
      )}
    >
      {roots.map((category) => (
        <Link
          key={category._id}
          href={`/${locale}/categories/${encodeURIComponent(category.slug)}`}
          className="flex h-10 shrink-0 snap-start items-center gap-2 rounded-button border border-border bg-background pe-3.5 ps-2.5 text-[13px] font-semibold text-foreground/80 transition-colors hover:border-foreground/30 hover:text-foreground"
        >
          <span className="grid h-6 w-6 shrink-0 place-items-center">
            {category.icon || category.image ? (
              <AppImage
                src={(category.icon || category.image) as string}
                alt=""
                className="h-5 w-5 rounded-sm object-contain"
                width={20}
                height={20}
              />
            ) : (
              <Package className="h-4 w-4" aria-hidden />
            )}
          </span>
          <span className="whitespace-nowrap">{category.name}</span>
        </Link>
      ))}
    </nav>
  );
}
