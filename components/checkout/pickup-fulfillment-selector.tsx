"use client";

/**
 * Delivery-or-collection, and which branch to collect from.
 *
 * There is deliberately no time to choose. Pickup means turning up while the
 * shop is open, so the panel states the opening hours and stops — no slot grid,
 * no capacity, no ten-minute hold counting down while the shopper fills in the
 * rest of the form. The booking system this replaced demanded six settings from
 * the merchant before a single collectable order could exist, and failed
 * silently when it got five.
 */

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import type { CheckoutFulfillmentMethod } from "@/lib/checkout/pickup-fulfillment-shared";

export type CheckoutPickupLocation = {
  id: string;
  name: string;
  pickupArea?: string;
  /** Shown as guidance. Days the branch is closed are simply absent. */
  openingHours?: Array<{ weekday: number; start: string; end: string }>;
  /**
   * Whether this branch holds the whole basket.
   *
   * Absent on a response from before this existed, and read as `true` for that
   * reason — an older server cannot answer the question, and refusing every
   * branch on its silence would take collection away from a working store
   * mid-deploy.
   */
  available?: boolean;
  /**
   * Kilometres from the location the shopper set in the header, when both
   * ends are known. The server ranks the list by it; this only prints it.
   */
  distanceKm?: number;
};

type PickupFulfillmentSelectorProps = {
  method: CheckoutFulfillmentMethod;
  pickupAvailable: boolean;
  multiVendor: boolean;
  locations?: CheckoutPickupLocation[];
  selectedLocationId?: string | null;
  loading?: boolean;
  onMethodChange: (method: CheckoutFulfillmentMethod) => void;
  onLocationChange?: (locationId: string) => void;
  /** "12 km away", in the shopper's language. Omit to print no distance. */
  distanceLabel?: (km: number) => string;
  labels?: Partial<{
    fulfillment: string;
    delivery: string;
    deliveryHint: string;
    pickup: string;
    pickupHint: string;
    multiVendor: string;
    chooseLocation: string;
    collectDuringOpeningHours: string;
    contactStoreForHours: string;
    branchOutOfStock: string;
    noBranchHasEverything: string;
  }>;
};

/** A branch with no explicit answer is treated as able — see `available`. */
function branchIsAvailable(location: CheckoutPickupLocation): boolean {
  return location.available !== false;
}

/**
 * Weekday names, indexed the way the stored opening hours are: 0 = Sunday.
 * Built from a known Sunday so the list follows the reader's own locale rather
 * than shipping English day names.
 */
const WEEKDAY_LABELS: Record<number, string> = Object.fromEntries(
  Array.from({ length: 7 }, (_, weekday) => [
    weekday,
    new Intl.DateTimeFormat(undefined, { weekday: "long", timeZone: "UTC" })
      // 2024-01-07 was a Sunday.
      .format(new Date(Date.UTC(2024, 0, 7 + weekday))),
  ]),
);

export function PickupFulfillmentSelector({
  method,
  pickupAvailable,
  multiVendor,
  locations,
  selectedLocationId,
  loading = false,
  onMethodChange,
  onLocationChange,
  distanceLabel,
  labels,
}: PickupFulfillmentSelectorProps) {
  const fulfillmentLabel = labels?.fulfillment || "Fulfillment";
  const chooseLocationLabel = labels?.chooseLocation || "Choose pickup location";

  const selectedLocation = locations?.find(
    (location) => location.id === selectedLocationId,
  );

  // The panel is only reachable through `pickupAvailable`, which comes from
  // `resolvePickupEligibility` — and that answers `not_configured` for an empty
  // branch list. So inside here there is always at least one branch to choose
  // between, and the picker below is never the only thing naming the store.
  const showPickupPanel = method === "pickup" && pickupAvailable;

  return (
    <section className="space-y-3" aria-labelledby="fulfillment-heading">
      <h2 id="fulfillment-heading" className="text-lg font-semibold">
        {fulfillmentLabel}
      </h2>

      <div
        role="radiogroup"
        aria-label={fulfillmentLabel}
        className="grid gap-2 sm:grid-cols-2"
      >
        {(
          [
            {
              value: "delivery" as const,
              title: labels?.delivery || "Delivery",
              hint: labels?.deliveryHint,
            },
            ...(pickupAvailable
              ? [
                  {
                    value: "pickup" as const,
                    title: labels?.pickup || "Local pickup",
                    hint: labels?.pickupHint,
                  },
                ]
              : []),
          ]
        ).map((option) => {
          const active = method === option.value;
          return (
            <label
              key={option.value}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                "focus-within:ring-2 focus-within:ring-ring/40",
                active
                  ? "border-primary bg-primary/5"
                  : "border-input hover:border-primary/40",
              )}
            >
              <input
                type="radio"
                name="fulfillment-method"
                className="sr-only"
                value={option.value}
                checked={active}
                onChange={() => onMethodChange(option.value)}
              />
              <span
                className={cn(
                  "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors",
                  active
                    ? "border-primary bg-primary"
                    : "border-muted-foreground/40",
                )}
                aria-hidden="true"
              >
                {active ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />
                ) : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium leading-tight">
                  {option.title}
                </span>
                {option.hint ? (
                  <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                    {option.hint}
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>

      {multiVendor ? (
        <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          {labels?.multiVendor ||
            "Pickup is available when your cart contains items from one store."}
        </p>
      ) : null}

      {showPickupPanel ? (
        <div className="space-y-3 rounded-lg border p-3">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              {chooseLocationLabel}
            </legend>
            <div
              role="radiogroup"
              aria-label={chooseLocationLabel}
              className="grid gap-2 sm:grid-cols-2"
            >
              {locations?.map((location) => {
                const selected = selectedLocation?.id === location.id;
                // Shown and disabled rather than hidden. A shopper who came
                // here to collect from one particular shop needs to be told it
                // is that shop that is short — a branch that simply vanishes
                // reads as "this store stopped doing collection".
                const available = branchIsAvailable(location);
                return (
                  <button
                    key={location.id}
                    type="button"
                    aria-pressed={selected}
                    disabled={!available}
                    onClick={() => onLocationChange?.(location.id)}
                    className={cn(
                      "rounded-md border px-3 py-2 text-left text-sm transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                      !available
                        ? "cursor-not-allowed border-input opacity-60"
                        : selected
                          ? "border-primary bg-primary/5"
                          : "border-input hover:border-primary/40",
                    )}
                  >
                    <span className="block font-medium">{location.name}</span>
                    {/* Neighbourhood and distance on one line, the way the
                        product page prints a collection point. A distance
                        under a kilometre reads "1 km": "0 km away" is a
                        rounding artefact, not a place. */}
                    {location.pickupArea ||
                    (distanceLabel && typeof location.distanceKm === "number") ? (
                      <span className="block text-xs text-muted-foreground">
                        {[
                          location.pickupArea,
                          distanceLabel && typeof location.distanceKm === "number"
                            ? distanceLabel(
                                Math.max(1, Math.round(location.distanceKm)),
                              )
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    ) : null}
                    {!available ? (
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {labels?.branchOutOfStock ||
                          "Doesn't have everything in your order"}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {/* Every branch is short. Said once, plainly, rather than leaving
                the shopper to work it out from a grid of greyed-out cards. */}
            {locations?.length && !locations.some(branchIsAvailable) ? (
              <p className="rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
                {labels?.noBranchHasEverything ||
                  "No collection point has every item in your order right now. Choose delivery, or remove an item to collect the rest."}
              </p>
            ) : null}
          </fieldset>

          {loading ? (
            <Skeleton className="h-16 w-full rounded-md" />
          ) : !selectedLocation ? null : (
            <div className="space-y-2 border-t pt-3">
              <p className="text-sm font-medium">
                {labels?.collectDuringOpeningHours ||
                  "Collect during opening hours"}
              </p>
              {selectedLocation?.openingHours?.length ? (
                <ul className="space-y-0.5 text-xs text-muted-foreground">
                  {selectedLocation.openingHours.map((opening) => (
                    <li key={opening.weekday} className="flex gap-2">
                      <span className="w-24 shrink-0">
                        {WEEKDAY_LABELS[opening.weekday] ?? ""}
                      </span>
                      <span className="tabular-nums">
                        {opening.start} – {opening.end}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {labels?.contactStoreForHours ||
                    "Contact the store for collection times."}
                </p>
              )}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
