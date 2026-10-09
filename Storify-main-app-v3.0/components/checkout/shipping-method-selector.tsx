"use client";

/**
 * Delivery for a cart that ships from several sellers.
 *
 * Every seller is rated separately, so the old screen asked the shopper one
 * question per seller and stacked every rate list in full: a six-seller cart
 * ran to fifteen option cards and about 1,480px of scrolling before the payment
 * step, with no shipping total anywhere and nothing to compare. This asks the
 * one question Shopify's split shipping asks — lowest price or fastest — and
 * keeps the per-shipment choice underneath for the shopper who wants it.
 *
 * Nothing here decides a price. The picks are sent with the order and the
 * payment routes re-resolve them through the same rate engine; an id this
 * screen does not know about is priced by the server's own default.
 */

import { useMemo, useState } from "react";
import { AlertCircle, ChevronDown, Info } from "lucide-react";

import { AppImage } from "@/components/ui/app-image";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  canOfferPresets,
  detectPreset,
  fastestUpgradeSummary,
  optionDays,
  presetPicks,
  presetTotals,
  selectedOptionFor,
  upgradedShipmentCount,
  type ShipmentRateGroup,
  type ShipmentRateOption,
  type VendorSelections,
} from "@/lib/checkout/shipping-presets";

/** One cart line as this screen needs it — thumbnail, name, pre-order flag. */
export type ShipmentItemSummary = {
  name: string;
  image?: string;
  quantity: number;
  isPreorder?: boolean;
};

type Translate = (
  key: string,
  fallback: string,
  values?: Record<string, string | number>,
) => string;

type ShippingMethodSelectorProps = {
  groups: ShipmentRateGroup[];
  selections: VendorSelections;
  onSelectionsChange: (next: VendorSelections) => void;
  /** vendorId -> the cart lines in that shipment, in cart order. */
  itemsByVendor: Record<string, ShipmentItemSummary[]>;
  /** The store's "show estimated delivery" setting. */
  showEstimates: boolean;
  formatPrice: (value: number) => string;
  tr: Translate;
  /**
   * What the page is charging for delivery, and what a free-shipping coupon
   * takes off it. Passed in rather than re-summed here: two totals derived
   * twice on one screen are two totals that can disagree.
   */
  shippingCost: number;
  shippingDiscount: number;
  discountedShippingCost: number;
};

/** Beyond this many shipments the list starts collapsed. */
const COLLAPSE_AFTER = 5;
/** How many rows stay open while collapsed. */
const COLLAPSED_ROWS = 3;
/** Thumbnails shown before the rest become a "+n" chip. */
const MAX_THUMBS = 2;

function daysLabel(
  option: ShipmentRateOption | undefined,
  showEstimates: boolean,
  tr: Translate,
) {
  if (!showEstimates) return "";
  const days = optionDays(option);
  if (!days) return "";
  return days.min === days.max
    ? tr("checkout.deliveryDaysExact", "{max} days", { max: days.max })
    : tr("checkout.deliveryDaysRange", "{min}-{max} days", {
        min: days.min,
        max: days.max,
      });
}

export function ShippingMethodSelector({
  groups,
  selections,
  onSelectionsChange,
  itemsByVendor,
  showEstimates,
  formatPrice,
  tr,
  shippingCost,
  shippingDiscount,
  discountedShippingCost,
}: ShippingMethodSelectorProps) {
  const [openVendorId, setOpenVendorId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const freeLabel = tr("checkout.free", "Free");
  const priceLabel = (cost: number) => (cost > 0 ? formatPrice(cost) : freeLabel);

  const presetsOffered = useMemo(
    () => canOfferPresets(groups, { showEstimates }),
    [groups, showEstimates],
  );
  const activePreset = useMemo(
    () => detectPreset(groups, selections),
    [groups, selections],
  );
  const totals = useMemo(
    () => presetTotals(groups, selections),
    [groups, selections],
  );
  const cheapestPicks = useMemo(() => presetPicks(groups, "lowest"), [groups]);

  const selectOption = (vendorId: string, optionId: string) => {
    onSelectionsChange({ ...selections, [vendorId]: optionId });
  };

  // A cart from one seller is one shipment: the presets, the shipment heading
  // and the seller's name would each say the same thing a second time. What is
  // left is the plain rate list a single-vendor store shows.
  if (groups.length === 1) {
    const group = groups[0]!;
    const selected = selectedOptionFor(group, selections);
    if (group.options.length === 0) {
      return <UnavailableShipment tr={tr} />;
    }
    return (
      <div className="space-y-2">
        {group.options.map((option) => (
          <OptionRow
            key={option.id}
            option={option}
            group={group}
            checked={selected?.id === option.id}
            cheapest={group.options.find(
              (candidate) => candidate.id === cheapestPicks[group.vendorId],
            )}
            showEstimates={showEstimates}
            priceLabel={priceLabel}
            formatPrice={formatPrice}
            tr={tr}
            onSelect={() => selectOption(group.vendorId, option.id)}
            variant="standalone"
          />
        ))}
      </div>
    );
  }

  const unavailable = groups.filter((group) => group.options.length === 0);
  const rated = groups.filter((group) => group.options.length > 0);
  const shipmentNumber = new Map(groups.map((group, index) => [group.vendorId, index + 1]));

  // Pre-orders and shipments with no rate are the two things a shopper must not
  // discover after paying, so they stay out of the collapsed part of the list.
  const isPinned = (group: ShipmentRateGroup) =>
    (itemsByVendor[group.vendorId] || []).some((item) => item.isPreorder);

  const collapsible = rated.length > COLLAPSE_AFTER;
  const visibleRated =
    collapsible && !showAll
      ? rated.filter((group, index) => index < COLLAPSED_ROWS || isPinned(group))
      : rated;
  const sellerCount = groups.length;
  const itemCount = groups.reduce(
    (sum, group) =>
      sum +
      (itemsByVendor[group.vendorId] || []).reduce(
        (lines, item) => lines + Math.max(1, item.quantity || 1),
        0,
      ),
    0,
  );

  const upgrade = fastestUpgradeSummary(rated);
  const lowestTotals = presetTotals(rated, presetPicks(rated, "lowest"));
  const fastestTotals = presetTotals(rated, presetPicks(rated, "fastest"));

  // The honest caveat under the presets: paying for speed moves the shipments
  // that can move, and the order is still only complete when the slowest one
  // lands. Printed only when the slowest shipment cannot be upgraded at all.
  const slowest = presetsOffered && !upgrade.movesCompletion ? rated.find((group) => {
    const option = selectedOptionFor(group, presetPicks(rated, "fastest"));
    return optionDays(option)?.max === fastestTotals.maxDays;
  }) : undefined;

  const stateLine = () => {
    const window =
      showEstimates && totals.hasDays
        ? tr("checkout.orderCompleteIn", "order complete in {min}-{max} days", {
            min: totals.minDays,
            max: totals.maxDays,
          })
        : "";
    if (activePreset === "lowest") {
      const label = tr("checkout.lowestPriceSelected", "Lowest price selected");
      return window ? `${label} · ${window}` : label;
    }
    if (activePreset === "fastest") {
      const label = tr("checkout.fastestSelected", "Fastest available selected");
      return window ? `${label} · ${window}` : label;
    }
    const upgraded = upgradedShipmentCount(rated, selections);
    const label = tr(
      upgraded === 1
        ? "checkout.customDeliveryOne"
        : "checkout.customDeliveryMany",
      upgraded === 1
        ? "Custom delivery · {count} shipment upgraded"
        : "Custom delivery · {count} shipments upgraded",
      { count: upgraded },
    );
    return window ? `${label} · ${window}` : label;
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {tr(
          "checkout.shipmentsSummary",
          "{items} items from {sellers} sellers, arriving in {shipments} separate shipments.",
          { items: itemCount, sellers: sellerCount, shipments: sellerCount },
        )}
      </p>

      {unavailable.map((group) => (
        <UnavailableShipment
          key={group.vendorId}
          sellerName={group.vendorName}
          tr={tr}
        />
      ))}

      {presetsOffered ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {tr("checkout.deliveryForOrder", "Delivery for the whole order")}
            </span>
            {activePreset === "custom" ? (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                {tr("checkout.customLabel", "Custom")}
              </span>
            ) : null}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <PresetCard
              checked={activePreset === "lowest"}
              label={tr("checkout.presetLowest", "Lowest price")}
              price={priceLabel(lowestTotals.cost)}
              caption={
                showEstimates && lowestTotals.hasDays
                  ? tr(
                      "checkout.presetLowestCaption",
                      "Everything arrives in {min}-{max} days",
                      { min: lowestTotals.minDays, max: lowestTotals.maxDays },
                    )
                  : ""
              }
              onSelect={() => {
                onSelectionsChange(presetPicks(groups, "lowest"));
                setOpenVendorId(null);
              }}
            />
            <PresetCard
              checked={activePreset === "fastest"}
              label={tr("checkout.presetFastest", "Fastest available")}
              price={priceLabel(fastestTotals.cost)}
              caption={tr(
                "checkout.presetFastestCaption",
                "+{amount} · {changed} of {shipments} shipments {gain} days earlier",
                {
                  amount: formatPrice(upgrade.extraCost),
                  changed: upgrade.changed,
                  shipments: upgrade.shipments,
                  gain:
                    upgrade.gainMin === upgrade.gainMax
                      ? upgrade.gainMax
                      : `${upgrade.gainMin}-${upgrade.gainMax}`,
                },
              )}
              onSelect={() => {
                onSelectionsChange(presetPicks(groups, "fastest"));
                setOpenVendorId(null);
              }}
            />
          </div>
          {slowest ? (
            <p className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                {tr(
                  "checkout.slowestShipmentNote",
                  "{seller} has one delivery option, so the order is complete in {min}-{max} days whichever you choose.",
                  {
                    seller:
                      slowest.vendorName ||
                      tr("checkout.thisSeller", "This seller"),
                    min: fastestTotals.minDays,
                    max: fastestTotals.maxDays,
                  },
                )}
              </span>
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-2">
        {visibleRated.map((group) => {
          const selected = selectedOptionFor(group, selections);
          const items = itemsByVendor[group.vendorId] || [];
          const isOpen = openVendorId === group.vendorId;
          const cheapest = group.options.find(
            (option) => option.id === cheapestPicks[group.vendorId],
          );
          const overridden =
            group.options.length > 1 && selected?.id !== cheapest?.id;
          const thumbs = items.slice(0, MAX_THUMBS);
          const extra = items.length - thumbs.length;
          const methodLine = [
            selected?.name,
            daysLabel(selected, showEstimates, tr),
          ]
            .filter(Boolean)
            .join(" · ");

          return (
            <div
              key={group.vendorId}
              className={cn(
                "overflow-hidden rounded-lg border",
                isOpen ? "border-primary ring-1 ring-primary" : "border-border",
              )}
            >
              <div className="flex items-center gap-3 p-3">
                <div className="flex shrink-0 items-center gap-1">
                  {thumbs.map((item, index) => (
                    <div
                      key={`${group.vendorId}-thumb-${index}`}
                      className="relative h-9 w-9 overflow-hidden rounded-md border bg-muted"
                    >
                      {item.image ? (
                        <AppImage
                          src={item.image}
                          alt={item.name}
                          fill
                          className="object-cover"
                        />
                      ) : null}
                    </div>
                  ))}
                  {extra > 0 ? (
                    <span className="flex h-9 w-9 items-center justify-center rounded-md border border-dashed text-xs font-medium text-muted-foreground">
                      +{extra}
                    </span>
                  ) : null}
                </div>

                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                    <span>
                      {tr("checkout.shipmentLabel", "Shipment {index} · {seller}", {
                        index: shipmentNumber.get(group.vendorId) ?? 1,
                        seller:
                          group.vendorName ||
                          tr("checkout.thisSeller", "This seller"),
                      })}
                    </span>
                    {overridden && activePreset === "custom" ? (
                      // Not "Custom": a row can be off the cheapest rate
                      // without being faster, so what is true of it is only
                      // that the shopper chose it themselves.
                      <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary">
                        {tr("checkout.shipmentChanged", "Changed")}
                      </span>
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {items.length > 0
                      ? tr(
                          items.length === 1
                            ? "checkout.shipmentItemsOne"
                            : "checkout.shipmentItemsMany",
                          items.length === 1
                            ? "{count} item · {names}"
                            : "{count} items · {names}",
                          {
                            count: items.length,
                            names: items.map((item) => item.name).join(", "),
                          },
                        )
                      : ""}
                  </p>
                  {methodLine ? (
                    <p className="truncate text-xs">{methodLine}</p>
                  ) : null}
                  {items.some((item) => item.isPreorder) ? (
                    <p className="text-xs font-medium text-blue-600 dark:text-blue-300">
                      {tr("checkout.shipmentPreorder", "Pre-order · ships later")}
                    </p>
                  ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-sm font-semibold">
                    {priceLabel(selected?.cost ?? group.cost)}
                  </span>
                  {group.options.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-auto px-1 py-1 text-primary hover:text-primary"
                      aria-expanded={isOpen}
                      onClick={() =>
                        setOpenVendorId(isOpen ? null : group.vendorId)
                      }
                    >
                      {isOpen
                        ? tr("checkout.done", "Done")
                        : tr("checkout.changeMethod", "Change")}
                      <ChevronDown
                        className={cn(
                          "ml-0.5 h-3.5 w-3.5 transition-transform",
                          isOpen && "rotate-180",
                        )}
                        aria-hidden="true"
                      />
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {tr("checkout.onlyOption", "Only option")}
                    </span>
                  )}
                </div>
              </div>

              {isOpen ? (
                <div className="border-t">
                  {group.options.map((option) => (
                    <OptionRow
                      key={option.id}
                      option={option}
                      group={group}
                      checked={selected?.id === option.id}
                      cheapest={cheapest}
                      showEstimates={showEstimates}
                      priceLabel={priceLabel}
                      formatPrice={formatPrice}
                      tr={tr}
                      onSelect={() => selectOption(group.vendorId, option.id)}
                      variant="nested"
                    />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}

        {collapsible ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-primary hover:text-primary"
            onClick={() => setShowAll((value) => !value)}
          >
            {showAll
              ? tr("checkout.showFewerShipments", "Show fewer shipments")
              : tr("checkout.viewAllShipments", "View all {count} shipments", {
                  count: rated.length,
                })}
          </Button>
        ) : null}
      </div>

      {/* No total while a shipment has no rate: the order cannot be placed at
          all, and a figure that leaves out the seller who cannot deliver reads
          as a price the shopper could pay. */}
      {unavailable.length === 0 ? (
      <div className="space-y-1 border-t pt-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-medium">
            {tr("checkout.totalShipping", "Total shipping")}
          </span>
          <span className="text-sm font-semibold">
            {shippingDiscount > 0 ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="line-through text-muted-foreground">
                  {formatPrice(shippingCost)}
                </span>
                <span>{priceLabel(discountedShippingCost)}</span>
              </span>
            ) : (
              priceLabel(shippingCost)
            )}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{stateLine()}</p>
      </div>
      ) : null}
    </div>
  );
}

function PresetCard({
  checked,
  label,
  price,
  caption,
  onSelect,
}: {
  checked: boolean;
  label: string;
  price: string;
  caption: string;
  onSelect: () => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer flex-col gap-1 rounded-lg border p-3 transition-colors hover:bg-muted/40",
        checked ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border",
      )}
    >
      <span className="flex items-center gap-2">
        <input
          type="radio"
          name="shippingPreset"
          className="accent-primary"
          checked={checked}
          onChange={onSelect}
        />
        <span className="text-sm font-medium">{label}</span>
      </span>
      <span className="pl-6 text-base font-semibold">{price}</span>
      {caption ? (
        <span className="pl-6 text-xs leading-snug text-muted-foreground">
          {caption}
        </span>
      ) : null}
    </label>
  );
}

function OptionRow({
  option,
  group,
  checked,
  cheapest,
  showEstimates,
  priceLabel,
  formatPrice,
  tr,
  onSelect,
  variant,
}: {
  option: ShipmentRateOption;
  group: ShipmentRateGroup;
  checked: boolean;
  cheapest?: ShipmentRateOption;
  showEstimates: boolean;
  priceLabel: (cost: number) => string;
  formatPrice: (value: number) => string;
  tr: Translate;
  onSelect: () => void;
  variant: "standalone" | "nested";
}) {
  const days = daysLabel(option, showEstimates, tr);
  // What the extra money buys, next to the money itself — an upgrade priced
  // without its gain is a number the shopper has to go and work out.
  const cheapestDays = optionDays(cheapest);
  const thisDays = optionDays(option);
  const extra = cheapest ? option.cost - cheapest.cost : 0;
  const gain =
    cheapestDays && thisDays ? cheapestDays.max - thisDays.max : 0;
  const upgradeHint =
    showEstimates && extra > 0 && gain > 0
      ? tr("checkout.upgradeHint", "+{amount} for {days} days earlier", {
          amount: formatPrice(extra),
          days: gain,
        })
      : "";

  return (
    <label
      className={cn(
        "flex cursor-pointer items-center justify-between gap-3 text-sm transition-colors hover:bg-muted/40",
        variant === "standalone"
          ? cn(
              "rounded-lg border p-4",
              checked ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border",
            )
          : cn("border-b p-3 last:border-b-0", checked && "bg-primary/5"),
      )}
    >
      <span className="flex items-center gap-3">
        <input
          type="radio"
          name={`shippingOption-${group.vendorId}`}
          className="accent-primary"
          checked={checked}
          onChange={onSelect}
        />
        <span>
          <span className="font-medium">{option.name}</span>
          {days || upgradeHint ? (
            <span className="block text-xs text-muted-foreground">
              {[days, upgradeHint].filter(Boolean).join(" · ")}
            </span>
          ) : null}
        </span>
      </span>
      <span className="font-semibold">{priceLabel(option.cost)}</span>
    </label>
  );
}

/**
 * Which seller is the reason the whole quote failed.
 *
 * No buttons here: the section's own alert already offers the address change
 * and the switch to collection, and two stacked "Change address" buttons read
 * as two different fixes. This one carries the detail that alert cannot — the
 * name of the seller who cannot reach the address.
 */
function UnavailableShipment({
  sellerName,
  tr,
}: {
  sellerName?: string;
  tr: Translate;
}) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
    >
      <p className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          {sellerName
            ? tr(
                "checkout.sellerNoShippingRates",
                "{seller} does not deliver to this address. Change the address or remove their items to continue.",
                { seller: sellerName },
              )
            : tr(
                "checkout.noShippingRates",
                "No shipping rates available for this address",
              )}
        </span>
      </p>
    </div>
  );
}
