"use client";

import { useEffect, useState } from "react";
import { NativeSelect } from "@/components/ui/native-select";
import { apiClient } from "@/lib/api/client";

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
 */
export function CouponSelect({
  value,
  onChange,
  placeholder,
  emptyLabel,
}: {
  value: string;
  onChange: (code: string) => void;
  placeholder: string;
  /** Shown in place of the list when the store has no active discounts. */
  emptyLabel: string;
}) {
  const [options, setOptions] = useState<CouponOption[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      // paginatedResponse nests the rows: { data, pagination }, NOT an array.
      .get<{ data?: CouponOption[] } | CouponOption[]>(
        "/api/admin/coupons?page=1&limit=100&status=active",
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
  }, []);

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

  return (
    <NativeSelect
      value={value}
      disabled={options === null}
      onChange={(event) => onChange(event.target.value)}
      className="w-full"
    >
      <option value="">
        {options && options.length === 0 ? emptyLabel : placeholder}
      </option>
      {(options ?? []).map((option) => (
        <option key={option._id ?? option.code} value={option.code}>
          {describe(option)}
        </option>
      ))}
      {/* A code whose discount was renamed, paused or deleted: keep it
          visible so the merchant can see what is being advertised. */}
      {missing ? <option value={value}>{value}</option> : null}
    </NativeSelect>
  );
}
