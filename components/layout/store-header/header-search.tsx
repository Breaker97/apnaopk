"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { ChevronDown, Search } from "lucide-react";
import Link from "@/components/language/link";
import { AppImage } from "@/components/ui/app-image";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useDebounce } from "@/hooks/use-debounce";
import { useClientValue } from "@/hooks/use-client-value";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";
import { usePathname, useRouter } from "@/hooks/use-locale-navigation";
import { toInternalPath } from "@/lib/i18n/locale-prefix";
import type { Locale } from "@/config/i18n.config";
import type {
  HeaderSearchBarItem,
  HeaderSearchIconItem,
} from "@/lib/site-config/header-layout";
import {
  paddingStyle,
  surfaceInkCss,
  textStyleCss,
} from "@/lib/site-config/header-layout-style";
import { searchIconShouldSubmit } from "@/lib/site-config/header-search-icon";
import {
  backgroundAccentColor,
  backgroundCss,
} from "@/lib/sliders/background";
import { cn } from "@/lib/utils";

/**
 * The header's search: one query shared by every search field the header
 * draws (the bar, the compact icon's field, the phone's row, the drawer),
 * one debounced suggestion fetch, one submit.
 *
 * It lives apart from the rest of the header on purpose. The query changes
 * on every keystroke, and while it was the header's own state each one
 * re-rendered the whole header — every nav link, popover and icon, ~800
 * components. Here a keystroke re-renders the provider and the fields that
 * read it; the header itself holds only `useHeaderSearchActions()`, whose
 * value never changes.
 */

const SearchDrawer = dynamic(() =>
  import("@/components/layout/store-header/search-drawer").then(
    (module) => module.SearchDrawer,
  ),
);

type SearchSuggestion = {
  _id: string;
  slug: string;
  name?: string;
  title?: string;
  images?: string[];
};

/** A category the search bar's scope picker offers: a top-level one. */
type ScopeCategory = { name: string; slug: string };

type HeaderSearchState = {
  locale: Locale;
  categories: readonly ScopeCategory[];
  query: string;
  suggestions: SearchSuggestion[];
  /**
   * The words the suggestions are really for, when a misspelling was
   * corrected ("ipone" → "iphone"). Updated with the rows, never apart.
   */
  correctedTo: string | null;
  isSearching: boolean;
  /**
   * The last suggestion request was refused or failed (a rate limit, the
   * network). The rows it would have replaced stay, and with none there is
   * nothing true to show but how to search.
   */
  suggestionsFailed: boolean;
  showSuggestions: boolean;
  /** Category scope for the search bar's dropdown; "" = all categories. */
  searchCategory: string;
  setQuery: (value: string) => void;
  setShowSuggestions: (show: boolean) => void;
  /** The scope picker's choice, which the suggestions follow at once. */
  pickCategory: (category: string) => void;
  changeQuery: (value: string) => void;
  submit: (event: FormEvent, category?: string) => void;
  focusProps: (category?: string) => {
    onFocus: () => void;
    onBlur: () => void;
  };
};

type HeaderSearchActions = {
  /** Search for `query` from outside the header's fields (the side drawer). */
  searchFor: (query: string) => void;
};

const HeaderSearchContext = createContext<HeaderSearchState | null>(null);
const HeaderSearchActionsContext = createContext<HeaderSearchActions | null>(
  null,
);

function useHeaderSearch(): HeaderSearchState {
  const context = useContext(HeaderSearchContext);
  if (!context) {
    throw new Error("useHeaderSearch must be used within HeaderSearchProvider");
  }
  return context;
}

/** The header's search actions; never re-renders its caller. */
export function useHeaderSearchActions(): HeaderSearchActions {
  const context = useContext(HeaderSearchActionsContext);
  if (!context) {
    throw new Error(
      "useHeaderSearchActions must be used within HeaderSearchProvider",
    );
  }
  return context;
}

async function fetchSearchSuggestions(
  query: string,
  category: string,
  signal: AbortSignal,
): Promise<{ products: SearchSuggestion[]; correctedTo: string | null }> {
  const params = new URLSearchParams({
    search: query,
    limit: "6",
    page: "1",
    // Suggestions render only name/slug/image — request card fields, not
    // full variant/media-heavy product documents.
    cardFieldsOnly: "true",
  });
  // The same scope Enter would search, so the panel previews the
  // results page rather than the whole catalogue.
  if (category) params.set("category", category);

  const response = await fetch(`/api/products?${params.toString()}`, {
    signal,
  });
  // A refusal (429 once an address has searched its fill) carries no rows;
  // read as an empty result it told the shopper nothing matched.
  if (!response.ok) throw new Error(`Suggestions answered ${response.status}`);
  const result = await response.json();
  const products = Array.isArray(result?.data?.data) ? result.data.data : [];
  const correctedTo = result?.data?.searchCorrection?.to;
  return {
    products,
    correctedTo: typeof correctedTo === "string" ? correctedTo : null,
  };
}

const NO_CATEGORIES: readonly ScopeCategory[] = [];

export function HeaderSearchProvider({
  locale,
  categories = NO_CATEGORIES,
  children,
}: {
  locale: Locale;
  categories?: readonly ScopeCategory[];
  children: ReactNode;
}) {
  const router = useRouter();
  // Read for the re-render: every navigation re-renders this provider, so
  // the listing's query string below is read again after each one — the
  // header's own push, a category link, back/forward.
  usePathname();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [correctedTo, setCorrectedTo] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [suggestionsFailed, setSuggestionsFailed] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchCategory, setSearchCategory] = useState("");
  // The scope the suggestions are fetched under: the picker's category while
  // the scoped bar has focus, "" for every other field.
  const [suggestionCategory, setSuggestionCategory] = useState("");
  const closeSuggestionsTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const debouncedQuery = useDebounce(query.trim(), 350);
  // The product listing's own query string, or null anywhere else. Read on
  // every render, so a navigation (the header's own push, a category link,
  // back/forward) or a reload hands it the new URL.
  const listingSearch = useClientValue(
    () =>
      // `toInternalPath` because the address bar drops the locale prefix for
      // the store's default language: a bare `/products` is this page too.
      toInternalPath(window.location.pathname, locale) === `/${locale}/products`
        ? window.location.search
        : null,
    null,
  );
  // On the listing the bar shows what the grid under it is filtered by, so a
  // reload or a category link doesn't leave it blank and the next search
  // starts from the scope on screen. A category the picker does not offer (a
  // subcategory, a multi-select from the sidebar) reads as "All".
  useApplyOnChange([listingSearch], () => {
    if (listingSearch === null) return;
    const params = new URLSearchParams(listingSearch);
    const category = params.get("category") ?? "";
    setQuery(params.get("search") ?? "");
    setSearchCategory(
      categories.some((node) => node.slug === category) ? category : "",
    );
  });

  useEffect(() => {
    if (debouncedQuery.length < 2) {
      return;
    }

    const controller = new AbortController();
    const loadSuggestions = async () => {
      setIsSearching(true);
      try {
        const result = await fetchSearchSuggestions(
          debouncedQuery,
          suggestionCategory,
          controller.signal,
        );
        // Only the rows change. Opening is the keystroke's job, so a response
        // that lands after the field lost focus cannot pop the panel back up.
        setSuggestions(result.products);
        setCorrectedTo(result.correctedTo);
        setSuggestionsFailed(false);
      } catch {
        // Asked on the signal, not the error: aborted with a reason, fetch
        // rejects with that reason rather than an AbortError. A real failure
        // keeps the rows it could not replace — they still match what was
        // typed before — and the panel says how to search instead of "No
        // products found", which the store never said.
        if (!controller.signal.aborted) setSuggestionsFailed(true);
      } finally {
        // The superseding request owns the spinner now.
        if (!controller.signal.aborted) setIsSearching(false);
      }
    };

    void loadSuggestions();
    return () => controller.abort("cleanup");
  }, [debouncedQuery, suggestionCategory]);

  useEffect(() => {
    return () => {
      if (closeSuggestionsTimeoutRef.current) {
        clearTimeout(closeSuggestionsTimeoutRef.current);
      }
    };
  }, []);

  // Handlers that only set state keep one identity for the life of the
  // header, so what a field draws from them alone (the scope picker) skips
  // the keystroke.
  const setters = useMemo(
    () => ({
      pickCategory: (category: string) => {
        setSearchCategory(category);
        setSuggestionCategory(category);
      },
      changeQuery: (value: string) => {
        setQuery(value);
        if (value.trim().length < 2) {
          setSuggestions([]);
          setCorrectedTo(null);
          setIsSearching(false);
          setSuggestionsFailed(false);
          setShowSuggestions(false);
          return;
        }
        // Open on the keystroke, not on the response: the panel appears once
        // and stays, and only its rows change as the shopper keeps typing.
        setShowSuggestions(true);
      },
    }),
    [],
  );

  const state = useMemo<HeaderSearchState>(() => {
    /**
     * Submit a search. `category` is passed only by the search bar that shows
     * the category picker ("" = its "All categories"): every other field
     * shares this handler and the typed text, but has no picker, so it must
     * never narrow by a scope it does not display. With nothing typed the
     * picker's choice is still a search — a category opens that category's
     * listing and "All categories" the full one, clearing a category left on
     * the URL.
     */
    const submit = (event: FormEvent, category?: string) => {
      event.preventDefault();
      setShowSuggestions(false);
      const trimmed = query.trim();
      if (!trimmed && category === undefined) return;
      const params = new URLSearchParams();
      if (trimmed) params.set("search", trimmed);
      if (category) params.set("category", category);
      const queryString = params.toString();
      router.push(
        `/${locale}/products${queryString ? `?${queryString}` : ""}`,
      );
    };

    /**
     * Open/close handlers shared by every search field on the header.
     * `category` is the field's own scope, as for `submit`: the field that
     * takes focus decides what the shared suggestions panel is fetched
     * under, so it never previews a scope the field does not show.
     */
    const focusProps = (category = "") => ({
      onFocus: () => {
        if (closeSuggestionsTimeoutRef.current) {
          clearTimeout(closeSuggestionsTimeoutRef.current);
        }
        setSuggestionCategory(category);
        if (query.trim().length >= 2) {
          setShowSuggestions(true);
        }
      },
      onBlur: () => {
        closeSuggestionsTimeoutRef.current = setTimeout(() => {
          setShowSuggestions(false);
        }, 140);
      },
    });

    return {
      locale,
      categories,
      query,
      suggestions,
      correctedTo,
      isSearching,
      suggestionsFailed,
      showSuggestions,
      searchCategory,
      setQuery,
      setShowSuggestions,
      ...setters,
      submit,
      focusProps,
    };
  }, [
    categories,
    correctedTo,
    isSearching,
    locale,
    query,
    router,
    searchCategory,
    setters,
    showSuggestions,
    suggestions,
    suggestionsFailed,
  ]);

  const actions = useMemo<HeaderSearchActions>(
    () => ({
      searchFor: (value) => {
        setQuery(value);
        router.push(`/${locale}/products?search=${encodeURIComponent(value)}`);
      },
    }),
    [locale, router],
  );

  return (
    <HeaderSearchActionsContext.Provider value={actions}>
      <HeaderSearchContext.Provider value={state}>
        {children}
      </HeaderSearchContext.Provider>
    </HeaderSearchActionsContext.Provider>
  );
}

/**
 * Product suggestions dropdown, shared by every search field. Only the
 * field that has focus shows it, since the panel keys off one query.
 *
 * Stale-while-revalidate on purpose: while the next query is in flight the
 * previous rows stay in place, dimmed, and are replaced when the response
 * lands. Swapping them for a loading row collapsed the panel and re-grew it
 * on every keystroke, which read as the whole dialog blinking.
 */
function HeaderSearchSuggestions({ className }: { className: string }) {
  const t = useTranslations();
  const {
    locale,
    query,
    suggestions,
    correctedTo,
    isSearching,
    suggestionsFailed,
    showSuggestions,
    setQuery,
    setShowSuggestions,
  } = useHeaderSearch();
  // The rows change with a response, not with a keystroke or the spinner.
  const rows = useMemo(
    () =>
      suggestions.map((product) => {
        const label = product.name || product.title || "Product";
        return (
          <Link
            key={product._id}
            href={`/${locale}/products/${product.slug}`}
            className="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-muted/60"
            onClick={() => {
              setQuery(label);
              setShowSuggestions(false);
            }}
          >
            <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-muted/40">
              {product.images?.[0] ? (
                <AppImage
                  src={product.images[0]}
                  alt={label}
                  className="h-full w-full object-cover"
                  width={40}
                  height={40}
                />
              ) : (
                <div className="h-full w-full bg-muted/60" />
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{label}</p>
            </div>
          </Link>
        );
      }),
    [locale, setQuery, setShowSuggestions, suggestions],
  );
  return showSuggestions && query.trim().length >= 2 ? (
    <div
      data-search-suggestions
      className={cn(
        // Frosted popover surface, not the bar's: over a floating header
        // --background is transparent and the ink white, which left the
        // rows unreadable against the hero. The panel re-points the text
        // tokens at the popover's own ink for everything inside it.
        "absolute top-full z-50 mt-2 overflow-hidden rounded-2xl border bg-popover/85 text-popover-foreground shadow-lg backdrop-blur-xl backdrop-saturate-150",
        "[--foreground:var(--popover-foreground)] [--muted-foreground:color-mix(in_oklab,var(--popover-foreground)_60%,transparent)]",
        "animate-in fade-in-0 zoom-in-95 duration-150",
        className,
      )}
      aria-busy={isSearching}
    >
      {correctedTo && suggestions.length > 0 && (
        <p className="border-b px-4 py-2 text-xs text-muted-foreground">
          {t.rich("common.showingResultsFor", {
            query: correctedTo,
            q: (chunks) => (
              <strong className="font-semibold text-foreground">{chunks}</strong>
            ),
          })}
        </p>
      )}
      <div className="max-h-80 overflow-y-auto p-2">
        {suggestions.length > 0 ? (
          <div
            className={cn(
              "space-y-1 transition-opacity duration-150",
              isSearching && "opacity-60",
            )}
          >
            {rows}
          </div>
        ) : (
          <div className="px-3 py-2 text-sm text-muted-foreground">
            {isSearching ? (
              t("common.loading")
            ) : suggestionsFailed ? (
              <>
                {t("common.pressEnterToSearch")} &quot;{query}&quot;
              </>
            ) : (
              t("common.noProductsFound")
            )}
          </div>
        )}
      </div>
      {suggestions.length > 0 && (
        <div className="border-t px-3 py-2 text-xs text-muted-foreground">
          {t("common.pressEnterToSearch")} &quot;{query}&quot;
        </div>
      )}
    </div>
  ) : null;
}

/** The search bar: a field, an optional category scope, the AI shortcut. */
export function HeaderSearchBar({
  item,
  placeholder,
}: {
  item: HeaderSearchBarItem;
  placeholder: string;
}) {
  const t = useTranslations();
  const search = useHeaderSearch();
  const { categories, searchCategory, pickCategory } = search;
  const showScope = item.showCategoryFilter && categories.length > 0;
  const scope = showScope ? searchCategory : "";
  const placeholderColor = backgroundAccentColor(item.textStyle.fill);
  // The picker keeps its identity while the shopper types: only a new
  // scope, not a keystroke, re-renders it.
  const scopePicker = useMemo(() => {
    if (!showScope) return null;
    const allCategoriesLabel = t.has("common.allCategories")
      ? t("common.allCategories")
      : "All categories";
    const searchCategoryLabel =
      categories.find((node) => node.slug === searchCategory)?.name ??
      allCategoriesLabel;
    return (
      <div className="flex shrink-0 items-center border-l border-current/20 pl-2 opacity-80">
        <SearchableSelect
          value={searchCategory}
          onValueChange={pickCategory}
          options={[
            { value: "", label: allCategoriesLabel },
            ...categories.map((category) => ({
              value: category.slug,
              label: category.name,
            })),
          ]}
          searchPlaceholder={`${t("common.search")}...`}
          emptyText={t("common.noResults")}
          align="end"
          contentClassName="w-60"
          // The bar's own ink and surface, not the default bordered
          // field: a box inside the bar's frame reads as a second input.
          trigger={
            <button
              type="button"
              aria-label={`${t("common.categories")}: ${searchCategoryLabel}`}
              className="flex max-w-36 cursor-pointer items-center gap-1 rounded-sm px-1 py-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-current/30"
            >
              <span className="truncate">{searchCategoryLabel}</span>
              <ChevronDown className="size-3 shrink-0" />
            </button>
          }
        />
      </div>
    );
  }, [categories, pickCategory, searchCategory, showScope, t]);
  const submitButton = useMemo(
    () => (
      <button
        type="submit"
        aria-label={placeholder}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full transition-opacity hover:opacity-70"
      >
        <Search className="h-4 w-4" />
      </button>
    ),
    [placeholder],
  );
  return (
    <form
      onSubmit={(e) => search.submit(e, showScope ? scope : undefined)}
      className="relative min-w-0 flex-1"
      style={paddingStyle(item.padding)}
    >
      <div
        {...search.focusProps(scope)}
        className="flex items-center gap-2 pl-4 pr-1.5"
        style={{
          height: item.height,
          borderRadius: item.roundness,
          borderWidth: item.borderThickness,
          borderStyle: "solid",
          borderColor: item.border || "transparent",
          ...backgroundCss(item.background),
          ...surfaceInkCss(item.background, item.foreground),
        }}
      >
        <input
          type="search"
          placeholder={item.placeholder || placeholder}
          value={search.query}
          onChange={(e) => search.changeQuery(e.target.value)}
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[color:var(--header-search-placeholder)] placeholder:opacity-80"
          style={
            {
              ...textStyleCss(item.textStyle),
              color: placeholderColor,
              "--header-search-placeholder": placeholderColor,
            } as CSSProperties
          }
        />
        {scopePicker}
        {submitButton}
      </div>
      <HeaderSearchSuggestions className="left-0 right-0" />
    </form>
  );
}

/**
 * The compact search's field: a button that submits, with a field that
 * opens beside it when the button is pressed with nothing typed. In pill
 * style the field is always showing, inside the capsule.
 */
export function HeaderSearchIconField({
  item,
  placeholder,
}: {
  item: HeaderSearchIconItem;
  placeholder: string;
}) {
  const search = useHeaderSearch();
  /**
   * Whether the plain search icon's field was OPEN (focused) when the icon
   * was pressed. Read on pointer-down: pressing the button moves focus to it,
   * so by the click the field has always just lost it.
   */
  const searchFieldWasOpenRef = useRef(false);
  const pill = item.style === "pill";
  const button = (
    <button
      type="submit"
      aria-label={placeholder}
      onPointerDown={(event) => {
        const field =
          event.currentTarget.form?.querySelector<HTMLInputElement>("input");
        searchFieldWasOpenRef.current = Boolean(
          field && document.activeElement === field,
        );
      }}
      onClick={(event) => {
        const field =
          event.currentTarget.form?.querySelector<HTMLInputElement>("input");
        // Enter in the field submits by "clicking" this button with focus
        // still in the field and no pointer-down first — that is a search
        // from an open field too.
        const wasOpen =
          searchFieldWasOpenRef.current ||
          Boolean(field && document.activeElement === field);
        searchFieldWasOpenRef.current = false;
        // See searchIconShouldSubmit: a closed field still holds the last
        // query, and submitting it sent every click back to old results.
        if (
          searchIconShouldSubmit({
            pill,
            fieldWasOpen: wasOpen,
            query: search.query,
          })
        ) {
          return;
        }
        event.preventDefault();
        field?.focus();
        // Selected, so typing replaces the old query instead of adding to it.
        field?.select();
      }}
      className={cn(
        "shrink-0 transition-opacity hover:opacity-80",
        item.showLabel && !pill ? "flex items-center" : "grid place-items-center",
      )}
      style={{
        borderRadius: item.roundness,
        padding: pill ? "8px 14px" : 8,
        ...backgroundCss(item.background),
        ...surfaceInkCss(item.background, item.foreground),
      }}
    >
      <Search style={{ width: item.size, height: item.size }} />
      {/* Plain style only: inside the capsule the label would sit where
          the typed query goes. */}
      {item.showLabel && !pill && item.label ? (
        <span className="ms-2 text-sm font-semibold">{item.label}</span>
      ) : null}
    </button>
  );
  const input = (
    <input
      type="search"
      value={search.query}
      aria-label={placeholder}
      onChange={(e) => search.changeQuery(e.target.value)}
      className={cn(
        "min-w-0 bg-transparent text-sm outline-none transition-[width] duration-200",
        pill ? "w-full flex-1" : "w-0 focus:w-44",
        // The line takes the header's ink, so it inverts with the rest of
        // the bar over a hero. Transparent while closed: the field is
        // zero-wide then, and its border must not linger as a dot.
        !pill &&
          item.fieldLine &&
          "h-8 border-b border-transparent focus:border-current",
      )}
    />
  );
  return (
    <form
      onSubmit={search.submit}
      className="relative shrink-0"
      style={paddingStyle(item.padding)}
      {...search.focusProps()}
    >
      {pill ? (
        <div
          className="flex items-center justify-end gap-1 p-1 pl-3"
          style={{
            width: item.width,
            borderRadius: item.pillRoundness,
            borderWidth: item.borderThickness,
            borderStyle: "solid",
            borderColor: item.border || "transparent",
            ...backgroundCss(item.pillBackground),
            ...surfaceInkCss(item.pillBackground),
          }}
        >
          {input}
          {button}
        </div>
      ) : (
        <div className="flex items-center gap-1">
          {input}
          {button}
        </div>
      )}
      <HeaderSearchSuggestions className="left-auto right-0 w-80 max-w-[85vw]" />
    </form>
  );
}

/**
 * The phone's search row: submits through the same handler, so results and
 * the AI trigger behave identically.
 */
export function HeaderMobileSearch({
  placeholder,
  inputStyle,
  iconStyle,
  showAiSearch,
}: {
  placeholder: string;
  /** The compact bar's search field, below lg — the legacy search settings. */
  inputStyle: CSSProperties;
  iconStyle: CSSProperties | undefined;
  showAiSearch: boolean;
}) {
  const t = useTranslations();
  const search = useHeaderSearch();
  const { setShowSuggestions } = search;
  // Neither changes as the shopper types.
  const glyph = useMemo(
    () => (
      <Search
        className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        style={iconStyle}
      />
    ),
    [iconStyle],
  );
  const aiButton = useMemo(
    () =>
      showAiSearch && (
        <button
          type="button"
          onClick={() => {
            setShowSuggestions(false);
            window.dispatchEvent(new CustomEvent("ai-sales-agent:open"));
          }}
          aria-label={t("common.aiSearch")}
          className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-fuchsia-500 transition-colors before:absolute before:-inset-2 before:content-[''] hover:text-fuchsia-600"
        >
          <Image src="/AI Icon.png" alt="" height={24} width={24} />
        </button>
      ),
    [setShowSuggestions, showAiSearch, t],
  );
  return (
    <form onSubmit={search.submit} className="pb-3">
      <div className="relative" {...search.focusProps()}>
        {/* The field paints its own background (`--header-search-bg`),
            so its icon and placeholder take the FIELD's ink, never the
            bar's: over a transparent header the bar's text is white,
            and a white placeholder on the white pill vanished. */}
        {glyph}
        <Input
          type="search"
          placeholder={placeholder}
          className="h-10 w-full rounded-full border border-[#dddddd] bg-transparent pl-11 pr-12 text-sm shadow-none placeholder:text-[color:var(--header-search-text,var(--muted-foreground))] placeholder:opacity-70 focus-visible:border-[#d3d3d3] focus-visible:bg-transparent focus-visible:ring-0 dark:border-white/15 dark:focus-visible:border-white/25"
          style={inputStyle}
          value={search.query}
          onChange={(e) => search.changeQuery(e.target.value)}
        />
        {aiButton}
        <HeaderSearchSuggestions className="left-0 right-0" />
      </div>
    </form>
  );
}

/**
 * The search drawer, on the header's own search state: one query, one
 * suggestion fetch, one submit — shared with every other search field.
 */
export function HeaderSearchDrawer({
  open,
  onOpenChange,
  placeholder,
  trending,
  collectionIds,
  fieldStyle,
  fieldRadius,
  brand,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  placeholder: string;
  trending: string[];
  collectionIds: string[];
  fieldStyle: "outline" | "underline";
  fieldRadius: number;
  brand: { logoUrl: string; name: string };
}) {
  const search = useHeaderSearch();
  return (
    <SearchDrawer
      open={open}
      onOpenChange={onOpenChange}
      query={search.query}
      onQueryChange={search.changeQuery}
      onSubmit={search.submit}
      suggestions={search.suggestions}
      isSearching={search.isSearching}
      failed={search.suggestionsFailed}
      correctedTo={search.correctedTo}
      placeholder={placeholder}
      trending={trending}
      collectionIds={collectionIds}
      fieldStyle={fieldStyle}
      fieldRadius={fieldRadius}
      brand={brand}
    />
  );
}
