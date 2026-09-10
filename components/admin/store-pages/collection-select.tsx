"use client";

import { useEffect, useState } from "react";
import { NativeSelect } from "@/components/ui/native-select";
import { apiClient } from "@/lib/api/client";

interface CollectionOption {
  _id: string;
  title: string;
}

/** Single-collection picker fed by the admin collections list. */
export function CollectionSelect({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
}) {
  const [options, setOptions] = useState<CollectionOption[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      // paginatedResponse nests the rows: the unwrapped payload is
      // { data: CollectionOption[], pagination } — NOT a bare array.
      .get<{ data?: CollectionOption[] } | CollectionOption[]>(
        "/api/admin/collections?page=1&limit=100&status=active",
      )
      .then((payload) => {
        if (cancelled) return;
        const items = Array.isArray(payload) ? payload : (payload?.data ?? []);
        setOptions(items);
      })
      .catch(() => {
        if (!cancelled) setOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <NativeSelect
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={options === null}
      className="w-full"
    >
      <option value="">{placeholder}</option>
      {(options ?? []).map((option) => (
        <option key={option._id} value={option._id}>
          {option.title}
        </option>
      ))}
      {/* Keep a stored id selectable even if it fell out of the first page. */}
      {value && options && !options.some((option) => option._id === value) ? (
        <option value={value}>{value}</option>
      ) : null}
    </NativeSelect>
  );
}
