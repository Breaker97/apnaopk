import Link from "@/components/language/link";
import { cn } from "@/lib/utils";

/**
 * "home" is the vendor's own landing page (Vendor CMS). It exists only once
 * the vendor has published one; until then the strip is the four tabs it
 * always was, and Products opens first.
 */
const VENDOR_TABS = ["home", "products", "about", "shipping", "reviews"] as const;

export type VendorTab = (typeof VENDOR_TABS)[number];

/** The vendor may hide these from their store; never Products or Reviews. */
export const HIDEABLE_VENDOR_TABS = ["about", "shipping"] as const;
export type HideableVendorTab = (typeof HIDEABLE_VENDOR_TABS)[number];

/**
 * The tab the bare store URL opens on: Home when there is one and the
 * vendor has not chosen Products, else Products.
 */
export function vendorLandingTab(
  hasHome: boolean,
  defaultTab: "home" | "products" = "home",
): VendorTab {
  return hasHome && defaultTab === "home" ? "home" : "products";
}

export function normalizeVendorTab(
  value: unknown,
  options: {
    /** The vendor has a published landing page. */
    hasHome?: boolean;
    /**
     * The URL carries product-grid params (filters, sort, page). An old link
     * like `?category=gaming` predates the Home tab and must still land on the
     * products it filters.
     */
    hasProductQuery?: boolean;
    /** The vendor's choice of opening tab (page settings); Home by default. */
    defaultTab?: "home" | "products";
    /** Tabs the vendor hid; a link to one opens the landing tab instead. */
    hidden?: readonly HideableVendorTab[];
  } = {},
): VendorTab {
  const hasHome = Boolean(options.hasHome);
  const hidden = options.hidden ?? [];
  if (
    VENDOR_TABS.includes(value as VendorTab) &&
    (value !== "home" || hasHome) &&
    !hidden.includes(value as HideableVendorTab)
  ) {
    return value as VendorTab;
  }
  return options.hasProductQuery
    ? "products"
    : vendorLandingTab(hasHome, options.defaultTab);
}

interface VendorStorefrontTabsProps {
  active: VendorTab;
  /** Base path for the store, e.g. `/en/vendors/haier-angie`. */
  basePath: string;
  labels: Record<Exclude<VendorTab, "home">, string> & { home?: string };
  counts?: Partial<Record<VendorTab, number>>;
  locale: string;
  /** Show the vendor's landing page as the first tab, at the bare store URL. */
  showHome?: boolean;
  /**
   * The tab that owns the bare store URL; by default Home when shown, else
   * Products, as before the vendor could choose.
   */
  landingTab?: VendorTab;
  /** Tabs the vendor hid from their store. */
  hidden?: readonly HideableVendorTab[];
}

/**
 * Section navigation for the vendor storefront.
 *
 * Driven by a `tab` search param rather than client state, so every section is
 * linkable, server-rendered and crawlable — a buyer can send someone straight to
 * a store's reviews.
 *
 * Filter and pagination params are deliberately dropped when switching tabs: a
 * `page=3` carried onto the About panel means nothing, and carrying it back to
 * Products after a detour is more surprising than starting clean.
 */
export function VendorStorefrontTabs({
  active,
  basePath,
  labels,
  counts,
  locale,
  showHome = false,
  landingTab: landingTabProp,
  hidden = [],
}: VendorStorefrontTabsProps) {
  const tabs = VENDOR_TABS.filter(
    (tab) =>
      (tab !== "home" || showHome) &&
      !hidden.includes(tab as HideableVendorTab),
  );
  // One tab owns the bare store URL: Home when there is one, else Products,
  // exactly as before the Vendor CMS — unless the vendor chose Products.
  const landingTab: VendorTab = landingTabProp ?? (showHome ? "home" : "products");

  return (
    <nav
      aria-label={labels.products}
      className="-mb-px flex gap-1 overflow-x-auto border-b [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab) => {
        const isActive = tab === active;
        const count = counts?.[tab];
        const href = tab === landingTab ? basePath : `${basePath}?tab=${tab}`;
        const label = tab === "home" ? (labels.home ?? "Home") : labels[tab];

        return (
          <Link
            key={tab}
            href={href}
            scroll={false}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3.5 py-3 text-sm font-medium transition-colors sm:px-4",
              isActive
                ? "border-primary font-semibold text-primary"
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
            )}
          >
            {label}
            {typeof count === "number" && count > 0 ? (
              <span
                className={cn(
                  "rounded-full px-1.5 py-px text-[11px] font-semibold tabular-nums",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {count.toLocaleString(locale)}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
