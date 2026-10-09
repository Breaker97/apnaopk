"use client";

/**
 * Compare tray
 *
 * What a shopper has picked out to compare, while they are still browsing.
 * The COMPARISON ITSELF is not stored anywhere: `/compare` renders from its
 * `?products=` query so a comparison stays shareable, reload-proof and
 * undoable with the back button. This tray is only the collector that gets
 * them there — pick on a listing, then follow the bar to the page.
 *
 * Slugs, not ids, because the URL the tray builds is addressed by slug.
 */

import { useCallback, useEffect } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { MAX_COMPARE_PRODUCTS } from "@/lib/products/compare";
import { useHydrated } from "@/hooks/use-client-value";

interface CompareState {
  slugs: string[];
  toggle: (slug: string) => void;
  remove: (slug: string) => void;
  /** Adopt an exact list — the `/compare` page handing over what it renders. */
  replace: (slugs: string[]) => void;
  clear: () => void;
}

const useCompareStore = create<CompareState>()(
  persist(
    (set, get) => ({
      slugs: [],

      toggle: (slug: string) => {
        const current = get().slugs;
        set({
          slugs: current.includes(slug)
            ? current.filter((entry) => entry !== slug)
            : // Silently dropping the pick past the cap would look broken;
              // the card asks `isFull()` first and says so instead.
              [...current, slug].slice(0, MAX_COMPARE_PRODUCTS),
        });
      },

      remove: (slug: string) => {
        set({ slugs: get().slugs.filter((entry) => entry !== slug) });
      },

      replace: (slugs: string[]) => {
        set({ slugs: slugs.slice(0, MAX_COMPARE_PRODUCTS) });
      },

      clear: () => set({ slugs: [] }),
    }),
    {
      name: "compare-storage",
      // Same reasoning as the wishlist: localStorage is unavailable to the
      // server, so letting persist hydrate while React is hydrating makes
      // the first browser render disagree with the server HTML (an active
      // "compare" pill over a card the server drew inactive). Restore from
      // an effect after hydration instead.
      skipHydration: true,
      partialize: (state) => ({ slugs: state.slugs }),
    },
  ),
);

let compareHydrationStarted = false;

const EMPTY_SLUGS: string[] = [];

export function useCompare() {
  const state = useCompareStore();
  // Per-component gate, not a shared "has the store hydrated" flag: the page
  // hydrates one Suspense boundary at a time, so the store can already be
  // populated by the compare bar while a product card deeper in the tree is
  // still hydrating. Every consumer renders the server's empty tray until it
  // has mounted itself.
  const hydrated = useHydrated();

  useEffect(() => {
    if (!compareHydrationStarted && !useCompareStore.persist.hasHydrated()) {
      compareHydrationStarted = true;
      void useCompareStore.persist.rehydrate();
    }
  }, []);

  const slugs = hydrated ? state.slugs : EMPTY_SLUGS;

  const isComparing = useCallback(
    (slug: string) => slugs.includes(slug),
    [slugs],
  );

  return {
    ...state,
    slugs,
    hydrated,
    isComparing,
    isFull: slugs.length >= MAX_COMPARE_PRODUCTS,
  };
}
