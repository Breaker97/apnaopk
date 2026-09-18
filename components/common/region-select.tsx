"use client";

import { useId, useMemo } from "react";
import { ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
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
  disabled?: boolean;
  className?: string;
  /** Rendered as `autocomplete` on whichever control we end up showing. */
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
  disabled = false,
  className,
  autoComplete,
}: RegionSelectProps) {
  const regions = useMemo(() => regionsForCountry(country), [country]);
  // The text fallback's floating label needs a target to associate with, or the
  // field reaches screen readers unlabelled whenever a caller omits `id`.
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  // Compared on the label, since that is what we store.
  const isKnownValue = useMemo(
    () =>
      regions.some(
        (region) =>
          region.label.trim().toLowerCase() === value.trim().toLowerCase(),
      ),
    [regions, value],
  );

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
      {/* A native select rather than a popover: it is the control mobile
          browsers render as a system wheel, and the only one their address
          autofill can actually write into. */}
      <select
        id={fieldId}
        // Bound to the raw value, not a validated one: an unrecognised value
        // gets its own <option> below, so selecting it here keeps the shopper's
        // saved region intact instead of silently resetting the field to blank.
        value={value}
        disabled={disabled}
        autoComplete={autoComplete}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "flex h-14 w-full appearance-none rounded-input border border-input bg-transparent px-3 pt-6 pb-1.5 text-base shadow-xs transition-[color,box-shadow] outline-none",
          "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
          "disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
          !isKnownValue && !value && "text-muted-foreground",
        )}
      >
        <option value="">{placeholder ?? ""}</option>
        {/* An unrecognised saved value gets its own option so it survives a
            render untouched instead of being silently cleared. */}
        {!isKnownValue && value ? (
          <option value={value}>{value}</option>
        ) : null}
        {regions.map((region) => (
          <option key={region.value} value={region.label}>
            {region.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute left-3 top-2 z-10 text-xs text-muted-foreground">
        {label}
      </span>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
    </div>
  );
}
