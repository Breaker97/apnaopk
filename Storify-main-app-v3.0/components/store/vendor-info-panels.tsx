import {
  BadgeCheck,
  CalendarDays,
  Clock,
  MapPin,
  Package,
  Store,
  Truck,
} from "lucide-react";
import {
  VendorStoreInfo,
  type VendorStoreInfoData,
  type VendorStoreInfoLabels,
} from "@/components/store/vendor-store-info";
import type { StorefrontVendor } from "@/lib/storefront/storefront-vendors";

interface VendorAboutLabels {
  aboutHeading: string;
  noDescription: string;
  productsLabel: string;
  /** Bare figure, e.g. "2" — the label supplies the noun. */
  productsValue: string;
  soldLabel: string;
  /** Bare figure, e.g. "1.2k". */
  soldValue: string;
  memberLabel: string;
  /** e.g. "Mar 2024". Empty when the join date is unknown. */
  memberValue: string;
  statusLabel: string;
  /** The Status fact is rendered only when `vendor.verified`. */
  verified: string;
}

interface VendorShippingLabels {
  shippingHeading: string;
  processingHeading: string;
  /** Resolved, e.g. "Ships in 1–2 days". Empty when not configured. */
  processing: string;
  processingHint: string;
  pickupHeading: string;
  /** Resolved, e.g. "Ready in 1–2 days". Empty when not configured. */
  pickupReady: string;
  pickupUnavailable: string;
  locationHeading: string;
  noLocation: string;
}

function Fact({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof MapPin;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border bg-card p-4">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="mt-0.5 text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}

/**
 * About panel: the store's own words, plus the facts a buyer uses to size it up.
 * The full store-info card rides along so the address is reachable from here
 * too — on the Products tab it lives in the sidebar, which this tab has no room
 * for.
 */
export function VendorAboutPanel({
  vendor,
  labels,
  storeInfo,
  storeInfoLabels,
}: {
  vendor: StorefrontVendor;
  labels: VendorAboutLabels;
  storeInfo: VendorStoreInfoData;
  storeInfoLabels: VendorStoreInfoLabels;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-6">
        <section className="rounded-xl border bg-card p-5 sm:p-6">
          <h2 className="mb-2 text-base font-bold">{labels.aboutHeading}</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {vendor.description || labels.noDescription}
          </p>
        </section>

        <div className="grid gap-3 sm:grid-cols-2">
          <Fact
            icon={Package}
            label={labels.productsLabel}
            value={labels.productsValue}
          />
          <Fact
            icon={Truck}
            label={labels.soldLabel}
            value={labels.soldValue}
          />
          {labels.memberValue ? (
            <Fact
              icon={CalendarDays}
              label={labels.memberLabel}
              value={labels.memberValue}
            />
          ) : null}
          {/* Omitted rather than shown as "not verified": the badge is a claim
              the platform makes about sellers it has checked, and its absence
              is not a claim about the rest. */}
          {vendor.verified ? (
            <Fact
              icon={BadgeCheck}
              label={labels.statusLabel}
              value={labels.verified}
            />
          ) : null}
        </div>
      </div>

      <VendorStoreInfo {...storeInfo} labels={storeInfoLabels} />
    </div>
  );
}

/**
 * Shipping & returns panel: dispatch window, pickup, and where the store ships
 * from. Each section states the store's own setting, or says plainly that it has
 * not published one — never a stand-in value.
 */
export function VendorShippingPanel({
  vendor,
  labels,
  location,
}: {
  vendor: StorefrontVendor;
  labels: VendorShippingLabels;
  location?: string;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <section className="rounded-xl border bg-card p-5">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-bold">
          <Clock className="h-4 w-4 text-primary" aria-hidden="true" />
          {labels.processingHeading}
        </h2>
        <p className="text-sm text-muted-foreground">
          {labels.processing || labels.processingHint}
        </p>
      </section>

      <section className="rounded-xl border bg-card p-5">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-bold">
          <Store className="h-4 w-4 text-primary" aria-hidden="true" />
          {labels.pickupHeading}
        </h2>
        {vendor.pickup ? (
          <>
            {vendor.pickup.address ? (
              <address className="text-sm not-italic text-muted-foreground">
                {vendor.pickup.address}
              </address>
            ) : null}
            {labels.pickupReady ? (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {labels.pickupReady}
              </p>
            ) : null}
            {vendor.pickup.instructions ? (
              <p className="mt-1.5 text-xs text-muted-foreground">
                {vendor.pickup.instructions}
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {labels.pickupUnavailable}
          </p>
        )}
      </section>

      <section className="rounded-xl border bg-card p-5 sm:col-span-2">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-bold">
          <MapPin className="h-4 w-4 text-primary" aria-hidden="true" />
          {labels.locationHeading}
        </h2>
        <p className="text-sm text-muted-foreground">
          {location || labels.noLocation}
        </p>
      </section>
    </div>
  );
}
