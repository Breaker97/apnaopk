"use client";

import { useId, useState, type FormEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Gift,
  Globe,
  Heart,
  MapPin,
  MessageCircle,
  Newspaper,
  Package,
  RotateCcw,
  Search,
  Truck,
  User,
  X,
  type LucideIcon,
} from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import type { HeaderMenuItem } from "@/lib/site-config/header-config";
import {
  drawerEntries,
  drawerEntryDrillsIn,
  drawerLinkGlyph,
  drawerPanel,
  drawerViewAllHref,
  type DrawerLinkGlyph,
} from "@/lib/site-config/header-menu-panels";
import { cn } from "@/lib/utils";

const GLYPHS: Record<DrawerLinkGlyph, LucideIcon> = {
  contact: MessageCircle,
  location: MapPin,
  account: User,
  wishlist: Heart,
  orders: Package,
  shipping: Truck,
  returns: RotateCcw,
  help: CircleHelp,
  blog: Newspaper,
  gift: Gift,
  link: ArrowRight,
};

export interface SideDrawerLanguage {
  code: string;
  name: string;
}

/**
 * The editorial side drawer behind a header menu button, drawn after
 * Prada's: Close and Search across the top, the store's primary links down
 * a narrow column, a quieter list of service links with glyphs pinned to
 * its foot — and, when an entry has children, a second panel sliding out
 * BESIDE the column with those children grouped under small headings.
 *
 * Both lists are navigation menus the merchant picked on the button, so the
 * drawer is authored in the Menus editor like every other menu, and the
 * panel reads a menu's shape the way the nav-link dropdown does
 * (`drawerPanel`). Beside, not drilled into: the column stays in view, so
 * moving from Women to Men is one click rather than Back-then-Men.
 *
 * Desktop only — phones keep the app drawer. On a screen too narrow for two
 * panels the second one covers the first, with a Back row to return.
 */
export function SideDrawer({
  open,
  onOpenChange,
  side,
  primary,
  secondary,
  label,
  onSearch,
  onSearchSubmit,
  languages = [],
  currentLanguage = "",
  onLanguageChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side: "left" | "right";
  primary: HeaderMenuItem[];
  secondary: HeaderMenuItem[];
  /** The accessible name — the menu button's own label. */
  label: string;
  /**
   * Search hands over to the header's search drawer when the header has
   * one; without it, the drawer searches from a field of its own
   * (`onSearchSubmit`). Neither = the store has search switched off.
   */
  onSearch?: () => void;
  onSearchSubmit?: (query: string) => void;
  /** Two or more, and the foot of the drawer offers the switch. */
  languages?: SideDrawerLanguage[];
  currentLanguage?: string;
  onLanguageChange?: (code: string) => void;
}) {
  const t = useTranslations();
  const panelId = useId();
  // Index of the entry whose panel is open. Emptied on close, like the
  // search field and the language list, so a reopened drawer starts clean.
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [languagesOpen, setLanguagesOpen] = useState(false);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setActiveIndex(null);
      setSearching(false);
      setQuery("");
      setLanguagesOpen(false);
    }
    onOpenChange(next);
  };
  const close = () => handleOpenChange(false);

  const entries = drawerEntries(primary);
  const secondaryEntries = drawerEntries(secondary);
  const candidate = activeIndex === null ? undefined : entries[activeIndex];
  const active = candidate && drawerEntryDrillsIn(candidate) ? candidate : null;
  const panel = active ? drawerPanel(active) : null;
  const viewAllHref = active ? drawerViewAllHref(active) : "";
  const currentLanguageName =
    languages.find((entry) => entry.code === currentLanguage)?.name ?? "";
  const showLanguages = languages.length > 1 && Boolean(onLanguageChange);
  const canSearch = Boolean(onSearch || onSearchSubmit);

  const text = (key: string, fallback: string) =>
    t.has(key) ? t(key) : fallback;
  const closeLabel = text("common.close", "Close");
  const searchLabel = text("common.search", "Search");
  const backLabel = text("common.back", "Back");
  const viewAllLabel = text("common.viewAll", "View all");

  const startSearch = () => {
    if (onSearch) {
      handleOpenChange(false);
      onSearch();
      return;
    }
    setSearching(true);
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = query.trim();
    if (!value || !onSearchSubmit) return;
    handleOpenChange(false);
    onSearchSubmit(value);
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side={side}
        showCloseButton={false}
        // Escape steps back one layer — out of the search field, then the
        // panel — before it closes the drawer.
        onEscapeKeyDown={(event) => {
          if (searching) {
            event.preventDefault();
            setSearching(false);
            setQuery("");
          } else if (active) {
            event.preventDefault();
            setActiveIndex(null);
          }
        }}
        className={cn(
          "w-full gap-0 overflow-hidden border-0 p-0",
          // The page stays readable behind it, dimmed — the drawer is a
          // detour from the page, not a new one.
          "shadow-[0_0_60px_rgba(0,0,0,0.18)]",
          // Widens to make room for the panel rather than covering the
          // column: the drawer's outer edge never moves.
          "transition-[max-width] duration-300 ease-out",
          active ? "sm:max-w-[min(54rem,100vw)]" : "sm:max-w-[26rem]",
        )}
      >
        <SheetTitle className="sr-only">{label}</SheetTitle>

        <div
          className={cn(
            "relative flex h-full min-h-0",
            // Physical, not logical: the column hugs the screen edge the
            // drawer slides from, and the panel opens away from it, in a
            // right-to-left store too.
            side === "right"
              ? "flex-row-reverse rtl:flex-row"
              : "flex-row rtl:flex-row-reverse",
          )}
        >
          {/* The column */}
          <div className="flex h-full w-full min-w-0 flex-col sm:w-[26rem] sm:shrink-0">
            <div
              className={cn(
                "flex h-20 shrink-0 items-center gap-7 px-8",
                side === "right" && !searching && "justify-end",
              )}
            >
              <SheetClose className="inline-flex shrink-0 items-center gap-2.5 text-sm transition-opacity hover:opacity-60">
                <X className="h-5 w-5" strokeWidth={1.5} />
                <span>{closeLabel}</span>
              </SheetClose>
              {canSearch && !searching ? (
                <button
                  type="button"
                  onClick={startSearch}
                  className="inline-flex shrink-0 items-center gap-2.5 text-sm transition-opacity hover:opacity-60"
                >
                  <Search className="h-[1.125rem] w-[1.125rem]" strokeWidth={1.5} />
                  <span>{searchLabel}</span>
                </button>
              ) : null}
              {searching ? (
                <form
                  role="search"
                  onSubmit={submitSearch}
                  className="flex min-w-0 flex-1 items-center gap-2.5 border-b border-foreground/80"
                >
                  <Search
                    className="h-[1.125rem] w-[1.125rem] shrink-0"
                    strokeWidth={1.5}
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    // The shopper just asked to type; the field is the point.
                    autoFocus
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    aria-label={searchLabel}
                    placeholder={searchLabel}
                    className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
                  />
                </form>
              ) : null}
            </div>

            <nav
              aria-label={label}
              className="flex min-h-0 flex-1 flex-col overflow-y-auto px-8 pb-8 pt-4"
            >
              <ul className="flex flex-col">
                {entries.map((item, index) => {
                  const key = `${item.href}-${item.label}-${index}`;
                  if (drawerEntryDrillsIn(item)) {
                    const isActive = activeIndex === index;
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          aria-expanded={isActive}
                          aria-controls={isActive ? panelId : undefined}
                          onClick={() => setActiveIndex(isActive ? null : index)}
                          className={cn(
                            "flex w-full items-center justify-between gap-4 py-2.5 text-start text-base transition-colors",
                            isActive
                              ? "font-medium text-foreground"
                              : active
                                ? "text-muted-foreground hover:text-foreground"
                                : "text-foreground hover:opacity-60",
                          )}
                        >
                          <span>{item.label}</span>
                          <ChevronRight
                            // Points the way the panel opens.
                            className={cn(
                              "h-4 w-4 shrink-0",
                              side === "right" && "rotate-180",
                            )}
                            strokeWidth={1.5}
                            aria-hidden="true"
                          />
                        </button>
                      </li>
                    );
                  }
                  return (
                    <li key={key}>
                      <Link
                        href={item.href}
                        target={item.target}
                        onClick={close}
                        className="block py-2.5 text-base text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>

              {secondaryEntries.length > 0 || showLanguages ? (
                <ul className="mt-auto flex flex-col gap-0.5 pt-10">
                  {secondaryEntries.map((item, index) => {
                    const Glyph = GLYPHS[drawerLinkGlyph(item)];
                    return (
                      <li key={`${item.href}-${item.label}-${index}`}>
                        <Link
                          href={item.href}
                          target={item.target}
                          onClick={close}
                          className="flex items-center gap-3 py-1.5 text-[13px] transition-opacity hover:opacity-60"
                        >
                          {item.icon ? (
                            <AppImage
                              src={item.icon}
                              alt=""
                              width={16}
                              height={16}
                              className="h-4 w-4 shrink-0 object-contain"
                            />
                          ) : (
                            <Glyph
                              className="h-4 w-4 shrink-0"
                              strokeWidth={1.5}
                              aria-hidden="true"
                            />
                          )}
                          <span>{item.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                  {showLanguages ? (
                    <li>
                      <button
                        type="button"
                        aria-expanded={languagesOpen}
                        onClick={() => setLanguagesOpen((value) => !value)}
                        className="flex w-full items-center gap-3 py-1.5 text-start text-[13px] transition-opacity hover:opacity-60"
                      >
                        <Globe
                          className="h-4 w-4 shrink-0"
                          strokeWidth={1.5}
                          aria-hidden="true"
                        />
                        <span>{currentLanguageName || text("common.language", "Language")}</span>
                        <ChevronDown
                          className={cn(
                            "h-3.5 w-3.5 shrink-0 transition-transform",
                            languagesOpen && "rotate-180",
                          )}
                          strokeWidth={1.5}
                          aria-hidden="true"
                        />
                      </button>
                      {languagesOpen ? (
                        <ul className="flex flex-col ps-7">
                          {languages.map((entry) => {
                            const current = entry.code === currentLanguage;
                            return (
                              <li key={entry.code}>
                                <button
                                  type="button"
                                  aria-current={current || undefined}
                                  onClick={() => {
                                    handleOpenChange(false);
                                    onLanguageChange?.(entry.code);
                                  }}
                                  className={cn(
                                    "flex w-full items-center justify-between gap-3 py-1.5 text-start text-[13px] transition-opacity hover:opacity-60",
                                    current ? "font-medium" : "text-muted-foreground",
                                  )}
                                >
                                  {entry.name}
                                  {current ? (
                                    <Check className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                                  ) : null}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </nav>
          </div>

          {/* The panel beside it */}
          {active && panel ? (
            <section
              id={panelId}
              aria-label={active.label}
              className={cn(
                "absolute inset-0 z-10 flex min-w-0 flex-col bg-background",
                "sm:static sm:z-auto sm:flex-1 sm:animate-in sm:fade-in sm:duration-300",
                side === "right" ? "sm:border-r" : "sm:border-l",
                "border-border/60",
              )}
            >
              <div className="flex h-20 shrink-0 items-center px-8 sm:px-10">
                {/* Only where the panel covers the column. */}
                <button
                  type="button"
                  onClick={() => setActiveIndex(null)}
                  className="inline-flex items-center gap-1.5 text-sm transition-opacity hover:opacity-60 sm:hidden"
                >
                  <ChevronLeft className="h-4 w-4 rtl:rotate-180" strokeWidth={1.5} />
                  {backLabel}
                </button>
              </div>

              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-8 pb-10 pt-4 sm:px-10">
                {/* On the narrow overlay the shopper can no longer see which
                    entry they opened, so it heads the panel there. */}
                <p className="mb-6 text-base font-medium sm:hidden">
                  {active.label}
                </p>

                {viewAllHref ? (
                  <Link
                    href={viewAllHref}
                    target={active.target}
                    onClick={close}
                    className="mb-8 block w-fit text-sm underline underline-offset-4 transition-opacity hover:opacity-60"
                  >
                    {viewAllLabel}
                  </Link>
                ) : null}

                <div className="flex flex-col gap-8">
                  {panel.sections.map((section, index) => (
                    <div key={`${section.title}-${index}`}>
                      {section.title ? (
                        section.href ? (
                          <Link
                            href={section.href}
                            target={section.target}
                            onClick={close}
                            className="mb-2.5 block w-fit text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
                          >
                            {section.title}
                          </Link>
                        ) : (
                          <p className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                            {section.title}
                          </p>
                        )
                      ) : null}
                      <ul className="flex flex-col">
                        {section.links.map((link, linkIndex) => (
                          <li key={`${link.href}-${link.label}-${linkIndex}`}>
                            <Link
                              href={link.href}
                              target={link.target}
                              onClick={close}
                              className="block py-1.5 text-sm transition-opacity hover:opacity-60"
                            >
                              {link.label}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>

                {panel.promos.length > 0 ? (
                  <div className="mt-10 grid grid-cols-2 gap-3">
                    {panel.promos.map((promo, index) => (
                      <Link
                        key={`${promo.image}-${index}`}
                        href={promo.href}
                        target={promo.target}
                        onClick={close}
                        className="group block"
                      >
                        <span className="relative block aspect-[3/4] overflow-hidden bg-muted">
                          <AppImage
                            src={promo.image}
                            alt={promo.label}
                            fill
                            sizes="(min-width: 640px) 14rem, 50vw"
                            className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                          />
                        </span>
                        {promo.label ? (
                          <span className="mt-2 block text-xs">{promo.label}</span>
                        ) : null}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
