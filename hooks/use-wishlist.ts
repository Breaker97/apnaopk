"use client";

/**
 * Wishlist Store
 * Zustand store for managing wishlist state
 */

import { useCallback, useEffect } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useHydrated } from "@/hooks/use-client-value";

interface WishlistItem {
  productId: string;
  product: {
    _id: string;
    name: string;
    slug: string;
    price: number;
    images?: string[];
    stock: number;
    status: string;
  };
  addedAt: string;
}

interface WishlistState {
  items: WishlistItem[];
  isLoading: boolean;
  isSynced: boolean;

  // Actions
  fetchWishlist: () => Promise<void>;
  addToWishlist: (productId: string) => Promise<boolean>;
  removeFromWishlist: (productId: string) => Promise<boolean>;
  isInWishlist: (productId: string) => boolean;
  clearWishlist: () => void;
}

const useWishlistStore = create<WishlistState>()(
  persist(
    (set, get) => ({
      items: [],
      isLoading: false,
      isSynced: false,

      fetchWishlist: async () => {
        set({ isLoading: true });
        try {
          const res = await fetch("/api/wishlist");
          if (res.ok) {
            const data = await res.json();
            if (data.success) {
              set({ items: data.data.items, isSynced: true });
            }
          }
        } catch (error) {
          console.error("Failed to fetch wishlist:", error);
        } finally {
          set({ isLoading: false });
        }
      },

      addToWishlist: async (productId: string) => {
        try {
          const res = await fetch("/api/wishlist", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ productId }),
          });

          if (res.ok) {
            // Refetch to get populated product data
            await get().fetchWishlist();
            return true;
          }
          return false;
        } catch (error) {
          console.error("Failed to add to wishlist:", error);
          return false;
        }
      },

      removeFromWishlist: async (productId: string) => {
        try {
          const res = await fetch(`/api/wishlist?productId=${productId}`, {
            method: "DELETE",
          });

          if (res.ok) {
            set((state) => ({
              items: state.items.filter((item) => item.productId !== productId),
            }));
            return true;
          }
          return false;
        } catch (error) {
          console.error("Failed to remove from wishlist:", error);
          return false;
        }
      },

      isInWishlist: (productId: string) => {
        return get().items.some((item) => item.productId === productId);
      },

      clearWishlist: () => {
        set({ items: [], isSynced: false });
      },
    }),
    {
      name: "wishlist-storage",
      // localStorage is unavailable to the server. Letting persist hydrate
      // while React is hydrating can make the first browser render disagree
      // with the server (for example, a filled "remove" heart versus an empty
      // "add" heart). Restore the cache from an effect after hydration instead.
      skipHydration: true,
      partialize: (state) => ({ items: state.items }),
    }
  )
);

let wishlistHydrationStarted = false;

const EMPTY_ITEMS: WishlistItem[] = [];

export function useWishlist() {
  const state = useWishlistStore();
  // Per-component gate, not a shared "has the store hydrated" flag. The page
  // hydrates one Suspense boundary at a time, so the store can already be
  // populated (by the header's rehydrate/fetch) while a product card deeper in
  // the tree is still hydrating — that card would then render a filled
  // "remove" heart against server HTML that said "add". Every consumer must
  // therefore render the server's empty wishlist until it has mounted itself.
  const hydrated = useHydrated();

  useEffect(() => {
    if (
      !wishlistHydrationStarted &&
      !useWishlistStore.persist.hasHydrated()
    ) {
      wishlistHydrationStarted = true;
      void useWishlistStore.persist.rehydrate();
    }
  }, []);

  const items = hydrated ? state.items : EMPTY_ITEMS;

  const isInWishlist = useCallback(
    (productId: string) => items.some((item) => item.productId === productId),
    [items]
  );

  return { ...state, items, isInWishlist, hydrated };
}
