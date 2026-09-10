"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { COUNTRIES } from "@/lib/intl/country-options";
import {
  areCountryValuesEquivalent,
  countryNameForCode,
  getAllowedCountryOptions,
} from "@/lib/intl/country-availability";
import { cn } from "@/lib/utils";
import { useAppSettings } from "@/providers/app-settings-provider";

type CountryValueFormat = "name" | "code";

type CommonProps = {
  id?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  triggerClassName?: string;
  disabled?: boolean;
  /** Keep legacy consumers on names; regional settings itself persists ISO-2. */
  valueFormat?: CountryValueFormat;
  /** The policy editor needs the full catalog so excluded countries can return. */
  restrictToAvailableCountries?: boolean;
};

type ClearableProps = {
  /**
   * Offer a way back to "no country" once one is picked. Off by default: most
   * consumers are address forms where the country is required, and there a
   * clear button would only let people submit an invalid address.
   */
  clearable?: boolean;
  /** Accessible label for the clear control. */
  clearLabel?: string;
};

type CountrySelectSingleProps = CommonProps &
  ClearableProps & {
    multiple?: false;
    value: string;
    onChange: (value: string) => void;
  };

type CountrySelectMultiProps = CommonProps & {
  multiple: true;
  value: string[];
  onChange: (value: string[]) => void;
};

type CountrySelectProps =
  | CountrySelectSingleProps
  | CountrySelectMultiProps;

const normalizeCountry = (value: string) => value.trim().toLowerCase();

/**
 * Up to this many options the list still fits the 18rem cap without scrolling
 * (36px per row plus the 8px list padding), so the search box is pure noise.
 * Past it we fall back to search plus the scroller the full catalog needs.
 */
const SEARCH_VISIBILITY_THRESHOLD = 7;

export function CountrySelect(props: CountrySelectProps) {
  const {
    id,
    placeholder = "Select country",
    searchPlaceholder = "Search countries...",
    emptyText = "No countries found.",
    triggerClassName,
    disabled = false,
    valueFormat = "name",
    restrictToAvailableCountries = true,
  } = props;
  const isMulti = props.multiple === true;
  const clearable = !isMulti && props.clearable === true;
  const clearLabel = (!isMulti && props.clearLabel) || "Clear country";
  const { countryAvailability } = useAppSettings();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selectedCountries = useMemo(() => {
    if (isMulti) {
      const value = props.value;
      return Array.isArray(value) ? value.filter(Boolean) : [];
    }
    const value = props.value;
    return value ? [value] : [];
  }, [isMulti, props.value]);

  const selectedSet = useMemo(
    () => new Set(selectedCountries.map(normalizeCountry)),
    [selectedCountries],
  );

  const availableCountries = useMemo(() => {
    const countries = restrictToAvailableCountries
      ? getAllowedCountryOptions(countryAvailability)
      : COUNTRIES;

    return countries.map((country) => ({
      value: valueFormat === "code" ? country.value : country.label,
      label:
        valueFormat === "code"
          ? `${country.label} (${country.value})`
          : country.label,
    }));
  }, [countryAvailability, restrictToAvailableCountries, valueFormat]);

  const showSearch = availableCountries.length > SEARCH_VISIBILITY_THRESHOLD;

  const soleCountry =
    availableCountries.length === 1 ? availableCountries[0] : null;

  /**
   * A store that only ships to one country has nothing to choose: drop the
   * trigger/search entirely and render the country as a read-only field. Multi
   * pickers keep their popover — the sole country is still a toggle there — and
   * so does the availability editor itself, which opts out of the restriction.
   */
  const isLockedToSoleCountry = Boolean(
    soleCountry && !isMulti && restrictToAvailableCountries,
  );

  const filteredCountries = useMemo(() => {
    const q = showSearch ? normalizeCountry(query) : "";
    if (!q) return availableCountries;
    return availableCountries.filter(
      (country) =>
        normalizeCountry(country.label).includes(q) ||
        normalizeCountry(country.value).includes(q),
    );
  }, [availableCountries, query, showSearch]);

  const onChangeRef = useRef(props.onChange);
  useEffect(() => {
    onChangeRef.current = props.onChange;
  });

  const singleValue = isMulti ? "" : props.value;

  // Keep the form in sync with the policy: an empty or no-longer-allowed value
  // would otherwise contradict the country shown in the locked field.
  useEffect(() => {
    if (!isLockedToSoleCountry || !soleCountry) return;
    if (areCountryValuesEquivalent(singleValue, soleCountry.value)) return;
    (onChangeRef.current as (value: string) => void)(soleCountry.value);
  }, [isLockedToSoleCountry, soleCountry, singleValue]);

  const displayValue = (value: string) => {
    const option = availableCountries.find(
      (country) => normalizeCountry(country.value) === normalizeCountry(value),
    );
    if (option) return option.label;
    if (valueFormat === "code") {
      const name = countryNameForCode(value);
      if (name) return `${name} (${value.toUpperCase()})`;
    }
    return value;
  };

  const handleSelect = (country: string) => {
    if (!isMulti) {
      props.onChange(country);
      setOpen(false);
      setQuery("");
      return;
    }

    const target = normalizeCountry(country);
    const isAlreadySelected = selectedSet.has(target);
    if (isAlreadySelected) {
      props.onChange(
        selectedCountries.filter(
          (item) => normalizeCountry(item) !== target,
        ),
      );
      return;
    }
    props.onChange([...selectedCountries, country]);
  };

  const removeCountry = (country: string) => {
    if (!isMulti) {
      props.onChange("");
      return;
    }
    const target = normalizeCountry(country);
    props.onChange(
      selectedCountries.filter((item) => normalizeCountry(item) !== target),
    );
  };

  const selectedLabel = isMulti
    ? selectedCountries.length === 0
      ? placeholder
      : selectedCountries.length === 1
        ? displayValue(selectedCountries[0])
        : `${selectedCountries.length} countries selected`
    : selectedCountries[0]
      ? displayValue(selectedCountries[0])
      : placeholder;

  const isPlaceholder = isMulti
    ? selectedCountries.length === 0
    : !props.value;

  // Only worth showing once there is something to clear.
  const showClear = clearable && !isPlaceholder && !disabled;

  if (isLockedToSoleCountry && soleCountry) {
    return (
      <button
        id={id}
        type="button"
        disabled
        className={cn(
          "flex h-9 w-full cursor-default items-center rounded-md border bg-muted/50 px-4 py-2 text-left text-sm font-normal shadow-xs dark:bg-input/30",
          disabled && "opacity-50",
          triggerClassName,
        )}
      >
        <span className="min-w-0 truncate text-left">{soleCountry.label}</span>
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) setQuery("");
        }}
      >
        {/* The clear control is a sibling overlay rather than a child of the
            trigger: a button inside a button is invalid and swallows clicks. */}
        <div className="relative">
          <PopoverTrigger asChild>
            <Button
              id={id}
              type="button"
              disabled={disabled}
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className={cn(
                "w-full justify-between font-normal",
                isPlaceholder && "text-muted-foreground",
                showClear && "pr-14",
                triggerClassName,
              )}
            >
              <span className="min-w-0 truncate text-left">
                {selectedLabel}
              </span>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          {showClear ? (
            <button
              type="button"
              aria-label={clearLabel}
              title={clearLabel}
              onClick={(event) => {
                event.stopPropagation();
                props.onChange("");
              }}
              className="absolute right-8 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground opacity-70 transition-opacity hover:bg-accent hover:text-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] p-0"
        >
          {showSearch ? (
            <div className="flex items-center gap-2 border-b px-3 py-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder}
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
          ) : null}

          {/* Capped on the viewport, not the root, so the popover shrinks to a
              handful of countries but still scrolls the full catalog. */}
          <ScrollArea className="max-h-72" viewportClassName="max-h-72">
            <div className="p-1">
              {/* Selecting nothing is a real choice here, so it needs a real
                  row — the trigger's X is unreachable by keyboard search. */}
              {showClear ? (
                <button
                  type="button"
                  onClick={() => {
                    props.onChange("");
                    setOpen(false);
                    setQuery("");
                  }}
                  className="mb-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{clearLabel}</span>
                </button>
              ) : null}
              {filteredCountries.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {emptyText}
                </div>
              ) : (
                filteredCountries.map((country) => {
                  const isSelected = selectedSet.has(
                    normalizeCountry(country.value),
                  );

                  return (
                    <button
                      key={country.value}
                      type="button"
                      onClick={() => handleSelect(country.value)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent",
                        isSelected && "bg-accent",
                      )}
                    >
                      <Check
                        className={cn(
                          "h-4 w-4 shrink-0",
                          isSelected ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {country.label}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>

      {isMulti && selectedCountries.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {selectedCountries.map((country) => (
            <Badge
              key={country}
              variant="secondary"
              className="max-w-full gap-1 pr-1"
            >
              <span className="truncate">{displayValue(country)}</span>
              <button
                type="button"
                onClick={() => removeCountry(country)}
                className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                aria-label={`Remove ${country}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// Backwards-compatible export for existing usages.
export function CountryMultiSelect(
  props: CountrySelectMultiProps | (CommonProps & {
    value: string[];
    onChange: (value: string[]) => void;
  }),
) {
  return <CountrySelect {...props} multiple />;
}
