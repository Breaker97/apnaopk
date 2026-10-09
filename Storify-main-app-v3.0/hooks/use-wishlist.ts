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
  /** When the list last came from the server (ms); 0 until it has. */
  syncedAt: number;

  // Actions
  /**
   * Joins the read already in flight, if any. Pass `fresh` after a write: a
   * read that started before it cannot contain it, so a new one starts and
   * the older one's answer is dropped.
   */
  fetchWishlist: (options?: { fresh?: boolean }) => Promise<void>;
  addToWishlist: (productId: string) => Promise<boolean>;
  removeFromWishlist: (productId: string) => Promise<boolean>;
  isInWishlist: (productId: string) => boolean;
  clearWishlist: () => void;
}

/**
 * The read in flight, shared: the bottom bar syncs the list on load while the
 * wishlist page may be asking for it too, and two callers used to mean two
 * identical requests. Only the latest read may write the list.
 */
let wishlistRequest: Promise<void> | null = null;
/** Numbers each read; a read whose number is no longer the latest is superseded. */
let wishlistReadCount = 0;

const useWishlistStore = create<WishlistState>()(
  persist(
    (set, get) => ({
      items: [],
      isLoading: false,
      isSynced: false,
      syncedAt: 0,

      fetchWishlist: (options) => {
        if (wishlistRequest && !options?.fresh) return wishlistRequest;
        const read = ++wishlistReadCount;
        wishlistRequest = (async () => {
          set({ isLoading: true });
          try {
            const res = await fetch("/api/wishlist");
            if (res.ok) {
              const data = await res.json();
              // Superseded by a read started after a write: that one's
              // answer is the newer list.
              if (data.success && read === wishlistReadCount) {
                set({
                  items: data.data.items,
                  isSynced: true,
                  syncedAt: Date.now(),
                });
              }
            }
          } catch (error) {
            console.error("Failed to fetch wishlist:", error);
          } finally {
            if (read === wishlistReadCount) {
              wishlistRequest = null;
              set({ isLoading: false });
            }
          }
        })();
        return wishlistRequest;
      },

      addToWishlist: async (productId: string) => {
        try {
          const res = await fetch("/api/wishlist", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ productId }),
          });

          if (res.ok) {
            // Refetch to get populated product data — a new read, since one
            // already out began before this item was added.
            await get().fetchWishlist({ fresh: true });
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
        set({ items: [], isSynced: false, syncedAt: 0 });
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

type Thenable<T> = Promise<T> & { status?: "pending" | "fulfilled"; value?: T };

let firstSync: Thenable<void> | null = null;

/**
 * Settles once this tab's first read of the wishlist has come back, whether
 * it found the list or failed. For the wishlist page to suspend on with
 * `use()` until the server's list is known; it joins the bottom bar's read if
 * that one is already out. Settled for good afterwards, so a failed read shows
 * what the tab holds instead of suspending again and again.
 */
export function wishlistFirstSync(): Promise<void> {
  if (!firstSync) {
    // Started a microtask later, not here: this runs while the wishlist page
    // renders, and `fetchWishlist` writes the store straight away
    // (`isLoading`), which would re-render the header in the middle of it.
    const thenable: Thenable<void> = Promise.resolve().then(() =>
      useWishlistStore.getState().fetchWishlist(),
    );
    thenable.status = "pending";
    void thenable.then(() => {
      thenable.status = "fulfilled";
    });
    firstSync = thenable;
  }
  return firstSync;
}

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
