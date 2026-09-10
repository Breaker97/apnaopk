"use client";

import { useTranslations } from "next-intl";

interface ProductFiltersPickupFacetProps {
  /** Whether "Pickup near me" is on. Off is the absence of the param. */
  pickupNearby: boolean;
  onChange: (pickupNearby: boolean) => void;
}

/**
 * The "All sellers | Pickup near me" switch, shared by every filter rail that
 * offers collection. One control rather than one per theme, so the two
 * listings cannot drift into different wording or a different notion of "on".
 *
 * "All" writes no param at all — the caller deletes the key on `false`. A
 * `pickup=all` would be a dead parameter in every shared link and a second
 * cache dimension.
 */
export function ProductFiltersPickupFacet({
  pickupNearby,
  onChange,
}: ProductFiltersPickupFacetProps) {
  const t = useTranslations();
  const label = t.has("location.fulfillment")
    ? t("location.fulfillment")
    : "Availability";

  return (
    <>
      <div
        role="radiogroup"
        aria-label={label}
        className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
      >
        <button
          type="button"
          role="radio"
          aria-checked={!pickupNearby}
          onClick={() => onChange(false)}
          className={`cursor-pointer rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
            pickupNearby
              ? "text-muted-foreground hover:text-foreground"
              : "bg-background shadow-sm"
          }`}
        >
          {t.has("location.allSellers") ? t("location.allSellers") : "All sellers"}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={pickupNearby}
          onClick={() => onChange(true)}
          className={`cursor-pointer rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
            pickupNearby
              ? "bg-background shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t.has("location.pickupNearMe")
            ? t("location.pickupNearMe")
            : "Pickup near me"}
        </button>
      </div>
      {pickupNearby ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {t.has("location.pickupNearMeHint")
            ? t("location.pickupNearMeHint")
            : "Only sellers with a shop you can collect from inside your radius."}
        </p>
      ) : null}
    </>
  );
}
