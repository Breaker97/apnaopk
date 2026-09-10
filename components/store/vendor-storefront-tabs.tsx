import Link from "next/link";
import { cn } from "@/lib/utils";

const VENDOR_TABS = ["products", "about", "shipping", "reviews"] as const;

type VendorTab = (typeof VENDOR_TABS)[number];

export function normalizeVendorTab(value: unknown): VendorTab {
  return VENDOR_TABS.includes(value as VendorTab)
    ? (value as VendorTab)
    : "products";
}

interface VendorStorefrontTabsProps {
  active: VendorTab;
  /** Base path for the store, e.g. `/en/vendors/haier-angie`. */
  basePath: string;
  labels: Record<VendorTab, string>;
  counts?: Partial<Record<VendorTab, number>>;
  locale: string;
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
}: VendorStorefrontTabsProps) {
  return (
    <nav
      aria-label={labels.products}
      className="-mb-px flex gap-1 overflow-x-auto border-b [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {VENDOR_TABS.map((tab) => {
        const isActive = tab === active;
        const count = counts?.[tab];
        const href =
          tab === "products" ? basePath : `${basePath}?tab=${tab}`;

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
            {labels[tab]}
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
