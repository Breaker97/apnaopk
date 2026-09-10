"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { NativeSelect } from "@/components/ui/native-select";
import { apiClient } from "@/lib/api/client";

interface SliderOption {
  _id: string;
  name: string;
  handle: string;
  slides?: unknown[];
}

/**
 * Picker for the `slider` field type: binds a section to a saved Slider
 * (Online Store → Sliders) by HANDLE, the same stable-reference shape the
 * footer's `menuHandle` uses. Slides are authored on the Sliders page, not
 * inline — the deep link keeps that one hop away.
 */
export function SliderSelect({
  value,
  onChange,
  locale,
  noneLabel,
  manageLabel,
}: {
  value: string;
  onChange: (handle: string) => void;
  locale: string;
  noneLabel: string;
  manageLabel: string;
}) {
  const [options, setOptions] = useState<SliderOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<SliderOption[]>("/api/admin/sliders")
      .then((sliders) => {
        if (!cancelled && Array.isArray(sliders)) setOptions(sliders);
      })
      .catch(() => {
        if (!cancelled) setOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const known = options.some((option) => option.handle === value);

  return (
    <div className="space-y-1.5">
      <NativeSelect
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full"
      >
        <option value="">{noneLabel}</option>
        {/* A stored handle whose slider was deleted stays listed so the
            selection is visible (and clearable) instead of silently blank. */}
        {value && !known ? <option value={value}>{value}</option> : null}
        {options.map((option) => (
          <option key={option._id} value={option.handle}>
            {option.name}
            {Array.isArray(option.slides)
              ? ` (${option.slides.length})`
              : ""}
          </option>
        ))}
      </NativeSelect>
      <Link
        href={`/${locale}/admin/online-store/sliders`}
        className="inline-block text-xs font-medium text-primary hover:underline"
      >
        {manageLabel}
      </Link>
    </div>
  );
}
