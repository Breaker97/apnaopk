"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { createTSafe } from "@/components/admin/online-store/t-safe";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { apiClient } from "@/lib/api/client";
import { useStoreBuilderScope } from "./builder-scope";

interface CouponOption {
  _id: string;
  code: string;
  label?: string;
  type?: "percentage" | "fixed" | "free_shipping";
  value?: number;
}

/**
 * Picks a discount code from the ones the store actually has (Online Store →
 * Discounts) instead of taking a typed string.
 *
 * A typed code is the whole bug this replaces: a banner advertising "AWDWAD"
 * looks fine in the builder and is rejected at checkout, and nothing in the
 * admin ever says so. Only active discounts are offered, because an expired
 * or paused one on the home page is the same failure a day later.
 *
 * The CODE is stored, not the id — see the field's own note. So a stored
 * code stays selectable even once its discount is gone, and the merchant can
 * see what the banner is still advertising.
 *
 * It is the app's one select-with-search, like the brand, category and
 * collection pickers beside it: a native `<select>` drew the browser's own
 * list, which matched nothing else on the screen.
 */
export function CouponSelect({
  value,
  onChange,
  placeholder,
  emptyLabel,
  endpoint,
  ariaLabel,
}: {
  value: string;
  onChange: (code: string) => void;
  placeholder: string;
  /** Shown in place of the list when the store has no active discounts. */
  emptyLabel: string;
  /**
   * Read the options from here instead of the builder scope's discounts list,
   * for a screen with its own rule about which codes it may offer (Campaign
   * Banners). Taken as written: it already says "active".
   */
  endpoint?: string;
  /** The trigger's name, for a field whose label is drawn outside it. */
  ariaLabel?: string;
}) {
  const tSafe = createTSafe(useTranslations());
  // The store's discounts by default; a vendor's builder lists their own.
  const { couponsEndpoint } = useStoreBuilderScope();
  const [options, setOptions] = useState<CouponOption[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      // paginatedResponse nests the rows: { data, pagination }, NOT an array.
      .get<{ data?: CouponOption[] } | CouponOption[]>(
        endpoint ?? `${couponsEndpoint}?page=1&limit=100&status=active`,
      )
      .then((payload) => {
        if (cancelled) return;
        const items = Array.isArray(payload) ? payload : (payload?.data ?? []);
        setOptions(items.filter((item) => typeof item?.code === "string"));
      })
      .catch(() => {
        if (!cancelled) setOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [couponsEndpoint, endpoint]);

  /** "SUMMER20 — 20% off" : enough to tell two discounts apart at a glance. */
  const describe = (option: CouponOption) => {
    if (option.type === "percentage" && typeof option.value === "number") {
      return `${option.code} — ${option.value}% off`;
    }
    if (option.type === "fixed" && typeof option.value === "number") {
      return `${option.code} — ${option.value} off`;
    }
    if (option.type === "free_shipping") return `${option.code} — free shipping`;
    return option.code;
  };

  const missing =
    value && options && !options.some((option) => option.code === value);

  const noneAvailable = options !== null && options.length === 0;
  const choices = [
    // Only while something is picked: the way back to "no coupon".
    ...(value ? [{ value: "", label: placeholder }] : []),
    ...(options ?? []).map((option) => ({
      value: option.code,
      label: describe(option),
    })),
    // A code whose discount was renamed, paused or deleted: keep it
    // visible so the merchant can see what is being advertised.
    ...(missing ? [{ value, label: value }] : []),
  ];

  return (
    <SearchableSelect
      options={choices}
      value={value}
      onValueChange={onChange}
      disabled={options === null}
      ariaLabel={ariaLabel}
      placeholder={noneAvailable ? emptyLabel : placeholder}
      searchPlaceholder={tSafe("admin.storeBuilder.searchCoupons", "Search discounts…")}
      emptyText={emptyLabel}
    />
  );
}
