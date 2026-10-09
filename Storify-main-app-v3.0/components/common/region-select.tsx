"use client";

import { useId, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { STATES, type RegionOption } from "@/lib/intl/country-options";
import { countryCodeForValue } from "@/lib/intl/country-availability";
import { cn } from "@/lib/utils";

type RegionSelectProps = {
  id?: string;
  /**
   * The country the address is in, as either an ISO-2 code or a country name —
   * checkout stores names, the onboarding wizard stores codes.
   */
  country: string;
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  /** Placeholder for the picker's search box. */
  searchPlaceholder?: string;
  /** Shown when the search matches no region. */
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  /**
   * Rendered as `autocomplete` on the free-text fallback. The picker is a
   * button, which autofill has nothing to write into.
   */
  autoComplete?: string;
};

/**
 * Resolve the subdivision list for a country given either representation of it.
 * Returns an empty list for the countries we have no list for, which is the
 * signal to fall back to free text.
 */
export function regionsForCountry(country: string): RegionOption[] {
  const code = countryCodeForValue(country);
  if (!code) return [];
  return STATES[code] ?? [];
}

/**
 * State/province/district picker for address forms.
 *
 * Two things about the stored value matter and are easy to get wrong:
 *
 * 1. It stores the region's *label* ("Dhaka"), not its code ("DHK"). Shipping
 *    zones match `zone.regions` — which an admin types by hand as free text —
 *    against this value case-insensitively (`lib/shipping.ts`). Storing the
 *    code would silently stop matching every zone already configured, and the
 *    shopper would be quoted the fallback rate instead of their real one.
 *
 * 2. A value that is not in the list is preserved rather than discarded. Saved
 *    addresses and orders predate this control and may hold anything the
 *    shopper once typed; dropping it on render would rewrite their address
 *    behind their back and change the rate they were quoted.
 */
export function RegionSelect({
  id,
  country,
  value,
  onChange,
  label,
  placeholder,
  searchPlaceholder = "Search...",
  emptyText = "No results found",
  disabled = false,
  className,
  autoComplete,
}: RegionSelectProps) {
  const regions = useMemo(() => regionsForCountry(country), [country]);
  // The text fallback's floating label needs a target to associate with, or the
  // field reaches screen readers unlabelled whenever a caller omits `id`.
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  // Matched on the label, since that is what we store — and case-insensitively,
  // because a value saved before this control existed may be cased any which
  // way. The match is what the picker displays, so "dhaka" still reads back as
  // the "Dhaka" option instead of an empty field.
  const matchedRegion = useMemo(
    () =>
      regions.find(
        (region) =>
          region.label.trim().toLowerCase() === value.trim().toLowerCase(),
      ),
    [regions, value],
  );

  // An unrecognised saved value gets an option of its own so it survives a
  // render untouched instead of being silently cleared.
  const options = useMemo(() => {
    const list = regions.map((region) => ({
      value: region.label,
      label: region.label,
      // The ISO subdivision code is not shown, but people do type it.
      keywords: region.value,
    }));
    if (value && !matchedRegion) {
      return [{ value, label: value }, ...list];
    }
    return list;
  }, [regions, value, matchedRegion]);

  // No list for this country: a disabled select would be a dead end, so the
  // field stays usable as free text. Same fallback the onboarding wizard uses.
  if (regions.length === 0) {
    return (
      <div className={cn("relative", className)}>
        <Input
          id={fieldId}
          value={value}
          disabled={disabled}
          autoComplete={autoComplete}
          placeholder=" "
          className="peer h-14 rounded-lg pt-6 pb-1.5 text-base placeholder-transparent"
          onChange={(event) => onChange(event.target.value)}
        />
        <label
          htmlFor={fieldId}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground transition-all duration-150 peer-focus:top-2 peer-focus:translate-y-0 peer-focus:text-xs peer-[:not(:placeholder-shown)]:top-2 peer-[:not(:placeholder-shown)]:translate-y-0 peer-[:not(:placeholder-shown)]:text-xs"
        >
          {label}
        </label>
      </div>
    );
  }

  return (
    <div className={cn("relative", className)}>
      {/* The same searchable picker the country field uses: a region list runs
          to dozens of entries, and scrolling a plain select past them is the
          slowest way to find one. The trade-off is that a button, unlike a
          native select, is not something the browser's address autofill can
          write into — the shopper picks the region themselves. */}
      <SearchableSelect
        id={fieldId}
        options={options}
        // The label floats above the button rather than inside it, so without
        // this the trigger reaches screen readers named only by the region
        // that happens to be selected.
        ariaLabel={label}
        // Bound to the matched option's label so a differently-cased saved
        // value still shows up as selected; the stored value is left alone.
        value={matchedRegion?.label ?? value}
        onValueChange={onChange}
        disabled={disabled}
        placeholder={placeholder ?? ""}
        searchPlaceholder={searchPlaceholder}
        emptyText={emptyText}
        className="h-14 items-end rounded-input pt-6 pb-1.5 [&>span]:text-base"
      />
      <span className="pointer-events-none absolute left-3 top-2 z-10 text-xs text-muted-foreground">
        {label}
      </span>
    </div>
  );
}
