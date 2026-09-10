"use client";

import { Button } from "@/components/ui/button";
import {
  savedAddressSummary,
  type SavedCheckoutAddress,
} from "@/components/checkout/checkout-helpers";
import { cn } from "@/lib/utils";

type SavedAddressSelectorProps = {
  addresses: SavedCheckoutAddress[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  onChangeAddress: () => void;
  onUseOneTimeAddress: () => void;
  title: string;
  defaultLabel: string;
  changeAddressLabel: string;
  oneTimeAddressLabel: string;
};

/**
 * Checkout-only choice of an existing address or a one-time delivery address.
 * Address CRUD stays in Account so checkout has a single lightweight decision
 * instead of a second, inconsistent editor.
 */
export function SavedAddressSelector({
  addresses,
  selectedIndex,
  onSelect,
  onChangeAddress,
  onUseOneTimeAddress,
  title,
  defaultLabel,
  changeAddressLabel,
  oneTimeAddressLabel,
}: SavedAddressSelectorProps) {
  if (addresses.length === 0) return null;

  const selectedAddress =
    selectedIndex === null ? null : addresses[selectedIndex] || null;

  if (selectedAddress) {
    return (
      <section className="space-y-3" aria-labelledby="saved-addresses-heading">
        <h3 id="saved-addresses-heading" className="text-sm font-semibold">
          {title}
        </h3>
        <div className="rounded-lg border border-primary bg-primary/5 p-3 text-sm">
          <span className="block font-medium">
            {selectedAddress.label || "Address"}
            {selectedAddress.isDefault ? (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {defaultLabel}
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 block text-muted-foreground">
            {savedAddressSummary(selectedAddress)}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={onChangeAddress}>
            {changeAddressLabel}
          </Button>
          <Button type="button" variant="ghost" onClick={onUseOneTimeAddress}>
            {oneTimeAddressLabel}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3" aria-labelledby="saved-addresses-heading">
      <h3 id="saved-addresses-heading" className="text-sm font-semibold">
        {title}
      </h3>
      <div role="radiogroup" aria-label={title} className="space-y-2">
        {addresses.map((address, index) => {
          const selected = selectedIndex === index;

          return (
            <label
              key={`${address.label || "address"}-${index}`}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors hover:bg-muted/40",
                selected
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border",
              )}
            >
              <input
                type="radio"
                name="saved-checkout-address"
                className="mt-0.5 accent-primary"
                checked={selected}
                onChange={() => onSelect(index)}
              />
              <span className="min-w-0">
                <span className="block font-medium">
                  {address.label || "Address"}
                  {address.isDefault ? (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {defaultLabel}
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-muted-foreground">
                  {savedAddressSummary(address)}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={onUseOneTimeAddress}
      >
        {oneTimeAddressLabel}
      </Button>
    </section>
  );
}
