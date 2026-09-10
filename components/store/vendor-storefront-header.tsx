import { BadgeCheck, MapPin, Star, Store, Truck } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { ProductShareButtons } from "@/components/products/product-share-buttons";
import { cn } from "@/lib/utils";
import type { StorefrontVendor } from "@/lib/storefront/storefront-vendors";

/**
 * Fully resolved strings — interpolation happens on the page, where `t()` can
 * be called with ICU values. Passing templates down and running `.replace()`
 * here would mean fetching an ICU message without its arguments, which
 * next-intl rejects outright.
 */
interface VendorStorefrontHeaderLabels {
  /** e.g. "(312 reviews)". Empty when the store has no approved reviews. */
  reviews: string;
  /** e.g. "1.2k sold". Rendered only when units have been delivered. */
  sold: string;
  /** e.g. "Ships in 1–2 days". Empty when the vendor set no processing window. */
  ships: string;
  pickupAvailable: string;
  /** Shown only when `vendor.verified` — the admin-awarded badge. */
  verified: string;
  /** Accessible name for the collapsed share control. */
  share: string;
}

interface VendorStorefrontHeaderProps {
  vendor: StorefrontVendor;
  /** City + country. Absent when the vendor keeps their location private. */
  location?: string;
  labels: VendorStorefrontHeaderLabels;
  /** Follow control; rendered before Share as the higher-value action. */
  followAction?: React.ReactNode;
  /** Direct store contact control, such as live chat. */
  contactAction?: React.ReactNode;
}

/**
 * Deterministic hue from the store name, so a vendor with no banner still gets
 * a stable, filled header box. Without this the banner element disappeared
 * entirely and the page height jumped from vendor to vendor.
 */
function bannerHue(storeName: string): number {
  let hash = 0;
  for (let i = 0; i < storeName.length; i += 1) {
    hash = (hash * 31 + storeName.charCodeAt(i)) % 360;
  }
  return hash;
}

/** Compact count for the trust row — "1.2k sold" beats "1,204 sold" at 13px. */
export function formatVendorCount(value: number, locale: string): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString(locale);
}

/**
 * One storefront fact, as a soft pill.
 *
 * These used to be a full-bleed bordered strip with vertical dividers, which
 * spent a rule, a background and ~56px of height on four short facts. A pill
 * row carries the same information with no frame at all, and lets the single
 * accent-coloured pill (Verified) actually stand out.
 */
function FactPill({
  icon: Icon,
  children,
  tone = "muted",
}: {
  icon: typeof MapPin;
  children: React.ReactNode;
  tone?: "muted" | "success";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        tone === "success"
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : "bg-muted text-muted-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </span>
  );
}

/**
 * Store identity block for the vendor storefront.
 *
 * No card frame: the banner is the only visual mass here, so a border around
 * the whole block just competed with the tab rule directly beneath it. The logo
 * is 96px and overlaps the banner so the two read as one unit, and the facts a
 * buyer checks before browsing — rating, sales, location, dispatch window —
 * sit as pills rather than in a bordered strip.
 *
 * Share and chat are quiet ghost controls: Follow is the only filled button in
 * the header, and sharing is a low-frequency action that was occupying the most
 * valuable slot on the page.
 */
export function VendorStorefrontHeader({
  vendor,
  location,
  labels,
  followAction,
  contactAction,
}: VendorStorefrontHeaderProps) {
  const hue = bannerHue(vendor.storeName);
  const initial = vendor.storeName.trim().slice(0, 1).toUpperCase() || "?";

  return (
    <section>
      {/* Banner. aspect-ratio, not a fixed height, so narrow screens keep the
          upload uncropped; the max-height caps it on wide ones, where the full
          1360/314 box pushed the store name and every product below the fold. */}
      <div className="relative aspect-[1360/314] max-h-40 w-full overflow-hidden rounded-xl bg-muted lg:max-h-48">
        {vendor.banner ? (
          <AppImage
            src={vendor.banner}
            alt=""
            fill
            priority
            className="object-cover"
            sizes="100vw"
          />
        ) : (
          <div
            aria-hidden="true"
            className="h-full w-full"
            style={{
              backgroundImage: `linear-gradient(120deg, hsl(${hue} 42% 88%), hsl(${
                (hue + 40) % 360
              } 38% 76%))`,
            }}
          />
        )}

        {/* Bottom fade. Dims only the band the logo overlaps, so the overlap
            reads as one composed unit against any upload — a busy product shot
            included — without washing out the banner itself. */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-1/2 bg-linear-to-t from-background/70 to-transparent"
        />
      </div>

      {/* No horizontal padding: with the card frame gone, the name, the trust
          row and the action cluster line up with the tabs and product grid
          below instead of sitting on their own inset. Only the logo is inset,
          by just enough to clear the banner's rounded corner. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
        {/* relative + z-10: the banner's <AppImage fill> is absolutely
            positioned, so without its own stacking context this logo — a later
            in-flow sibling — was painted underneath it and its overlapping top
            was invisible. */}
        <div className="relative z-10 -mt-10 ms-4 h-20 w-20 shrink-0 overflow-hidden rounded-2xl border-[3px] border-background bg-muted shadow-sm sm:-mt-11 sm:ms-5 sm:h-24 sm:w-24">
          {vendor.logo ? (
            <AppImage
              src={vendor.logo}
              alt={vendor.storeName}
              width={96}
              height={96}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="grid h-full w-full place-items-center bg-foreground text-2xl font-bold text-background">
              {initial}
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:pt-3">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold tracking-tight sm:text-3xl">
              {vendor.storeName}
            </h1>
            {vendor.description ? (
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground sm:text-base">
                {vendor.description}
              </p>
            ) : null}

            {/* Trust row, deliberately down to two facts: rating and sales are
                buying signals, while the product count is already a tab badge
                and the join date lives in About. Four equally grey facts gave
                the eye nowhere to land. Each is omitted rather than shown as a
                zero — an unrated new store should read as new, not as badly
                rated. */}
            <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-muted-foreground">
              {vendor.rating > 0 ? (
                <span className="inline-flex items-center gap-1.5">
                  <Star
                    className="h-3.5 w-3.5 fill-amber-400 text-amber-400"
                    aria-hidden="true"
                  />
                  <strong className="font-semibold text-foreground">
                    {vendor.rating.toFixed(1)}
                  </strong>
                  {labels.reviews ? <span>{labels.reviews}</span> : null}
                </span>
              ) : null}

              {vendor.rating > 0 && vendor.unitsSold > 0 ? (
                <span aria-hidden="true">·</span>
              ) : null}

              {vendor.unitsSold > 0 ? <span>{labels.sold}</span> : null}
            </div>

            {/* Fact pills. The coarsest appearance of the address — the full
                one, with directions, stays in the store-info panel. */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {location ? <FactPill icon={MapPin}>{location}</FactPill> : null}

              {labels.ships ? (
                <FactPill icon={Truck}>{labels.ships}</FactPill>
              ) : null}

              {vendor.pickup ? (
                <FactPill icon={Store}>{labels.pickupAvailable}</FactPill>
              ) : null}

              {/* Only for a store an admin has actually vetted. Every vendor
                  reaching this page is approved, so an unconditional badge said
                  nothing — and said it about sellers nobody had checked. */}
              {vendor.verified ? (
                <FactPill icon={BadgeCheck} tone="success">
                  {labels.verified}
                </FactPill>
              ) : null}
            </div>
          </div>

          {/* Follow first, then the quiet controls: following is the action a
              returning shopper wants, chatting and sharing are occasional. */}
          <div className="flex shrink-0 items-center gap-1 self-start">
            {followAction}
            {contactAction}
            <ProductShareButtons
              productName={vendor.storeName}
              image={vendor.logo || vendor.banner}
              shareSettings={vendor.shareSettings}
              shareText={vendor.storeName}
              compact
              ghost
              compactLabel={labels.share}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
