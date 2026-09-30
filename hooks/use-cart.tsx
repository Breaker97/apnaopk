"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import type { CartItem } from "@/types";
import { apiClient, ApiClientError, refusalMessage } from "@/lib/api/client";
import { toast } from "@/components/ui/toast-notification";
import {
  EMPTY_CART_ORDER_CONFIG,
  type CartOrderConfig,
} from "@/lib/orders/order-settings";

interface CartState {
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
  /**
   * The store's tax, free-shipping and delivery-estimate settings, rendered
   * in by the layout — the cart page and the drawer price the bag with them
   * on first render.
   */
  orderConfig: CartOrderConfig;
}

interface CartActions {
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

/**
 * State and actions are two contexts. The actions are created once per
 * provider and never change identity, so a component that only acts on the
 * cart — a product card, quick view, "add all" — reads `useCartActions()`
 * and does not re-render when the cart changes. On one shared context, each
 * add to cart re-rendered every card on the page, twice.
 *
 * Keep each action's identity stable: one recreated on a cart change hands
 * `useCartActions()` a new value and re-renders all of those components
 * again (pinned by tests/cart-context-split.test.tsx).
 */
const CartStateContext = createContext<CartState | undefined>(undefined);
const CartActionsContext = createContext<CartActions | undefined>(undefined);

export function CartProvider({
  children,
  inert = false,
  orderConfig = EMPTY_CART_ORDER_CONFIG,
}: {
  children: ReactNode;
  /** From `getStorefrontSettings()`; see `CartState.orderConfig`. */
  orderConfig?: CartOrderConfig;
  /**
   * Provide the context without ever loading the cart. For the builder's
   * section preview frames: cards call `useCartActions()` at render, but
   * the frame is pointer-events-none and shows a draft, so a cart fetch per
   * frame reload would be pure cost.
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

  // The committed lines, for updateItem's rollback. Read through a ref, not
  // a dependency, so updateItem keeps one identity across cart changes; set
  // in a layout effect so it is current before any later handler runs.
  const committedItems = useRef(items);
  useLayoutEffect(() => {
    committedItems.current = items;
  }, [items]);

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
          // A refused load leaves the cart looking empty, which it is not.
          const refused = refusalMessage(error);
          if (refused) toast.error(refused);
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
      const previousItems = committedItems.current;

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
    [refreshCart]
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
        // HTTP failures were previously ignored here; keep that contract —
        // except a refusal (429): the line is still in the cart, and the
        // caller used to announce "Item removed" over it.
        if (!(error instanceof ApiClientError) || refusalMessage(error)) {
          throw error;
        }
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

  const state = useMemo<CartState>(
    () => ({
      items,
      isLoading,
      totalItems: items.reduce((sum, item) => sum + item.quantity, 0),
      subtotal: items.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0,
      ),
      hasShippableItems,
      hasDigitalItems,
      shippableSubtotal,
      totalWeight,
      sellerCount,
      anySellerOffersPickup,
      orderConfig,
    }),
    [
      items,
      isLoading,
      hasShippableItems,
      hasDigitalItems,
      shippableSubtotal,
      totalWeight,
      sellerCount,
      anySellerOffersPickup,
      orderConfig,
    ],
  );
  const actions = useMemo<CartActions>(
    () => ({ addItem, updateItem, removeItem, clearCart, refreshCart }),
    [addItem, updateItem, removeItem, clearCart, refreshCart],
  );

  return (
    <CartActionsContext.Provider value={actions}>
      <CartStateContext.Provider value={state}>
        {children}
      </CartStateContext.Provider>
    </CartActionsContext.Provider>
  );
}

/**
 * The cart's state and actions; re-renders on every cart change. A
 * component that only acts on the cart reads `useCartActions()` instead.
 */
export function useCart(): CartState & CartActions {
  const state = useContext(CartStateContext);
  const actions = useContext(CartActionsContext);
  if (!state || !actions) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return { ...state, ...actions };
}

/** The cart's actions alone, which never re-render their caller. */
export function useCartActions(): CartActions {
  const actions = useContext(CartActionsContext);
  if (!actions) {
    throw new Error("useCartActions must be used within a CartProvider");
  }
  return actions;
}
