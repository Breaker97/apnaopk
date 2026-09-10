"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import type { CartItem } from "@/types";
import { apiClient, ApiClientError } from "@/lib/api/client";

interface CartContextType {
  items: CartItem[];
  isLoading: boolean;
  totalItems: number;
  subtotal: number;
  /**
   * False only when every cart line is digital (no physical shipping needed).
   * Defaults to true so checkout never flashes its digital-only mode while
   * the cart is still loading.
   */
  hasShippableItems: boolean;
  /**
   * True when at least one cart line is digital, even in a mixed cart.
   * Checkout uses it to withhold COD: digital files release off the order
   * itself, so they would be handed over before any cash was collected.
   * Defaults to false so COD doesn't flicker away while the cart loads.
   */
  hasDigitalItems: boolean;
  /**
   * Subtotal of the physical lines only, and their combined weight — the two
   * figures the shipping rate engine prices against.
   *
   * Both come from the server because only it knows each line's format and
   * weight. Checkout uses them for the estimate it shows before its own server
   * quote arrives; without them that estimate priced weight-based rates against
   * a zero weight and applied free-shipping thresholds to digital goods.
   */
  shippableSubtotal: number;
  totalWeight: number;
  /**
   * Distinct sellers across the physical lines, as the server counted them.
   *
   * The cart's own answer to "why is collection not on offer" — checkout
   * refuses pickup for anything above 1. Counted server-side over the same
   * visible lines the shopper sees, so the number can never contradict the
   * groups on screen. 0 while loading and for an empty or digital-only cart.
   */
  sellerCount: number;
  /**
   * True when at least one seller in the bag actually runs a collection point.
   *
   * Without it the cart would tell a shopper the seller mix cost them in-store
   * collection in stores where nobody offers collection at all — the default
   * state of a fresh install.
   */
  anySellerOffersPickup: boolean;
  addItem: (item: Omit<CartItem, "_id">) => Promise<void>;
  updateItem: (
    productId: string,
    quantity: number,
    variantId?: string
  ) => Promise<void>;
  /**
   * `silent` keeps the provider's isLoading flag down while the cart
   * reconciles. Checkout needs it: a non-silent refresh there swaps the whole
   * page for the loading skeleton and wipes the half-filled form.
   */
  removeItem: (
    productId: string,
    variantId?: string,
    options?: { silent?: boolean }
  ) => Promise<void>;
  clearCart: () => Promise<void>;
  refreshCart: (silent?: boolean) => Promise<void>;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export function CartProvider({
  children,
  inert = false,
}: {
  children: ReactNode;
  /**
   * Provide the context without ever loading the cart. For the builder's
   * section preview frames: cards call `useCart()` at render, but the frame
   * is pointer-events-none and shows a draft, so a cart fetch per frame
   * reload would be pure cost.
   */
  inert?: boolean;
}) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [hasShippableItems, setHasShippableItems] = useState(true);
  const [hasDigitalItems, setHasDigitalItems] = useState(false);
  const [shippableSubtotal, setShippableSubtotal] = useState(0);
  const [totalWeight, setTotalWeight] = useState(0);
  // 0, not 1, until the server answers: a cart that has not loaded must not
  // render "one seller" and then re-render into a mixed-cart warning.
  const [sellerCount, setSellerCount] = useState(0);
  const [anySellerOffersPickup, setAnySellerOffersPickup] = useState(false);
  // An inert provider never loads, so it is never "loading".
  const [isLoading, setIsLoading] = useState(!inert);

  // Calculate totals
  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  // Fetch cart from API
  const loadCart = useCallback(
    () =>
      apiClient
        .get<{
          items?: CartItem[];
          hasShippableItems?: boolean;
          hasDigitalItems?: boolean;
          shippableSubtotal?: number;
          totalWeight?: number;
          sellerCount?: number;
          anySellerOffersPickup?: boolean;
        }>("/api/cart")
        .then((data) => {
          setItems(data?.items || []);
          setHasShippableItems(data?.hasShippableItems !== false);
          setHasDigitalItems(data?.hasDigitalItems === true);
          setShippableSubtotal(data?.shippableSubtotal ?? 0);
          setTotalWeight(data?.totalWeight ?? 0);
          setSellerCount(data?.sellerCount ?? 0);
          setAnySellerOffersPickup(Boolean(data?.anySellerOffersPickup));
        })
        .catch((error) => {
          console.error("Failed to fetch cart:", error);
        })
        .finally(() => setIsLoading(false)),
    [],
  );
  // The initial load starts with `isLoading` already true; later refreshes
  // choose whether to show it.
  const refreshCart = useCallback(
    (silent = false) => {
      if (!silent) setIsLoading(true);
      return loadCart();
    },
    [loadCart],
  );

  useEffect(() => {
    if (inert) return;
    void loadCart();
  }, [loadCart, inert]);

  const addItem = useCallback(
    async (item: Omit<CartItem, "_id">) => {
      try {
        const data = await apiClient.post<{ items?: CartItem[] }>(
          "/api/cart/items",
          {
            productId: item.productId.toString(),
            variantId: item.variantId?.toString(),
            quantity: item.quantity,
          },
        );
        const nextItems = data?.items;
        if (Array.isArray(nextItems)) {
          // Taken verbatim: `/api/cart/items` resolves seller identity for
          // every line, so the optimistic render already has the headers it
          // needs. Reconstructing them client-side from the lines already on
          // screen could not work — the product just added is by definition
          // not among them, so it arrived vendorless and flipped the cart into
          // grouped mode under a bogus "unknown seller".
          setItems(nextItems);
          // The items endpoint doesn't report shippability or the seller
          // count — refresh quietly so a digital item, or a line from a new
          // seller, is reflected.
          void refreshCart(true);
        } else {
          await refreshCart();
        }
        return;
      } catch (error) {
        console.error("Failed to add item:", error);
        throw error;
      }
    },
    [refreshCart]
  );

  const updateItem = useCallback(
    async (productId: string, quantity: number, variantId?: string) => {
      const safeQuantity = Math.max(0, quantity);
      const previousItems = items;

      setItems((currentItems) =>
        currentItems
          .map((item) => {
            const isTargetItem =
              item.productId.toString() === productId &&
              (variantId
                ? item.variantId?.toString() === variantId
                : !item.variantId);

            if (!isTargetItem) {
              return item;
            }

            return {
              ...item,
              quantity: safeQuantity,
            };
          })
          .filter((item) => item.quantity > 0)
      );

      try {
        const itemId = variantId ? `${productId}-${variantId}` : productId;
        await apiClient.put(`/api/cart/items/${itemId}`, {
          quantity: safeQuantity,
        });

        await refreshCart(true);
      } catch (error) {
        setItems(previousItems);
        console.error("Failed to update item:", error);
        throw error;
      }
    },
    [items, refreshCart]
  );

  const removeItem = useCallback(
    async (
      productId: string,
      variantId?: string,
      options?: { silent?: boolean }
    ) => {
      try {
        const itemId = variantId ? `${productId}-${variantId}` : productId;
        await apiClient.delete(`/api/cart/items/${itemId}`);
        await refreshCart(options?.silent === true);
      } catch (error) {
        console.error("Failed to remove item:", error);
        // HTTP failures were previously ignored here; keep that contract.
        if (!(error instanceof ApiClientError)) throw error;
      }
    },
    [refreshCart]
  );

  const clearCart = useCallback(async () => {
    try {
      await apiClient.delete("/api/cart");
      setItems([]);
      // Cleared alongside the lines it was counted from, so an emptied cart
      // cannot keep showing a mixed-cart warning.
      setSellerCount(0);
      setAnySellerOffersPickup(false);
    } catch (error) {
      console.error("Failed to clear cart:", error);
      // HTTP failures were previously ignored here; keep that contract.
      if (!(error instanceof ApiClientError)) throw error;
    }
  }, []);

  return (
    <CartContext.Provider
      value={{
        items,
        isLoading,
        totalItems,
        subtotal,
        hasShippableItems,
        hasDigitalItems,
        shippableSubtotal,
        totalWeight,
        sellerCount,
        anySellerOffersPickup,
        addItem,
        updateItem,
        removeItem,
        clearCart,
        refreshCart,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return context;
}
