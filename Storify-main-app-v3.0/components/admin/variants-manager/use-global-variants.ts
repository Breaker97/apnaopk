"use client";

import { useEffect, useState } from "react";

/**
 * A saved global variant (Products → Global Variants) in the lightweight shape
 * the product/category option editors need to offer it as an option suggestion.
 */
export interface GlobalVariantOption {
  _id: string;
  name: string;
  type: string;
  visual: string;
  values: { _id: string; value: string; colorCode?: string; image?: string }[];
}

// Module-level cache so every option editor on the page shares one fetch
// instead of each re-requesting the (rarely-changing) global variant list.
let cache: GlobalVariantOption[] | null = null;
let inflight: Promise<GlobalVariantOption[]> | null = null;

function normalize(raw: GlobalVariantOption): GlobalVariantOption {
  return {
    _id: String(raw._id),
    name: raw.name,
    type: raw.type,
    visual: raw.visual,
    values: (raw.values ?? []).map((v) => ({
      _id: String(v._id),
      value: v.value,
      colorCode: v.colorCode,
      image: v.image,
    })),
  };
}

async function fetchGlobalVariants(): Promise<GlobalVariantOption[]> {
  const res = await fetch("/api/global-variants");
  const json = await res.json();
  if (json?.success && Array.isArray(json.data)) {
    return (json.data as GlobalVariantOption[]).map(normalize);
  }
  return [];
}

/**
 * Loads the store's saved global variants for the option editors, using a
 * stale-while-revalidate strategy: the last-known list (module cache) paints
 * instantly to avoid a flash, but we always refetch on mount and on window
 * focus. That keeps the product form's suggestions live — edits made on the
 * Global Variants page show up as soon as you return here or refocus the tab,
 * without waiting on a full page reload.
 */
export function useGlobalVariants(): {
  variants: GlobalVariantOption[];
  loading: boolean;
} {
  const [variants, setVariants] = useState<GlobalVariantOption[]>(cache ?? []);
  // Only block with a skeleton on the very first load; revalidations paint
  // over the cached list silently.
  const [loading, setLoading] = useState(cache === null);

  useEffect(() => {
    let cancelled = false;

    const revalidate = () => {
      (inflight ??= fetchGlobalVariants())
        .then((data) => {
          cache = data;
          if (!cancelled) setVariants(data);
        })
        .catch((error) => {
          console.error("Failed to load global variants:", error);
        })
        .finally(() => {
          inflight = null;
          if (!cancelled) setLoading(false);
        });
    };

    revalidate();
    // Refetch when the tab regains focus, so a variant edited in another tab
    // (or on the Global Variants page) is reflected without a manual reload.
    window.addEventListener("focus", revalidate);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", revalidate);
    };
  }, []);

  return { variants, loading };
}
