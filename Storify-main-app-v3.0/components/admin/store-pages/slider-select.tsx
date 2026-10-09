"use client";

import { useEffect, useState } from "react";
import Link from "@/components/language/link";
import { NativeSelect } from "@/components/ui/native-select";
import { apiClient } from "@/lib/api/client";
import { useStoreBuilderScope } from "./builder-scope";

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
  noneLabel,
  manageLabel,
}: {
  value: string;
  onChange: (handle: string) => void;
  noneLabel: string;
  manageLabel: string;
}) {
  // The store's sliders by default; a vendor's builder lists their own.
  const { slidersEndpoint, manageSlidersHref } = useStoreBuilderScope();
  const [options, setOptions] = useState<SliderOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<SliderOption[]>(slidersEndpoint)
      .then((sliders) => {
        if (!cancelled && Array.isArray(sliders)) setOptions(sliders);
      })
      .catch(() => {
        if (!cancelled) setOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [slidersEndpoint]);

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
        href={manageSlidersHref}
        className="inline-block text-xs font-medium text-primary hover:underline"
      >
        {manageLabel}
      </Link>
    </div>
  );
}
