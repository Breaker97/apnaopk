"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  Search,
  Plus,
  Minus,
  Trash2,
  X,
  CreditCard,
  ShoppingCart,
  Package,
  Receipt,
  Loader2,
  Hash,
  UserPlus,
  UserCheck,
  Mail,
  Phone,
  Footprints,
  Tag,
  Bookmark,
  MessageSquare,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn, truncateByWords } from "@/lib/utils";
import { AppImage } from "@/components/ui/app-image";
import { POSProductGridSkeleton } from "@/components/pos/pos-skeleton";
import { toast } from "@/components/ui/toast-notification";
import { configurePOSSounds, playPOSSound } from "@/lib/pos/pos-sounds";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useCurrency } from "@/providers/currency-provider";
import { buildCode39SVG } from "@/lib/pos/code39";
import {
  POSDiscountDialog,
  type POSDiscount,
} from "@/components/pos/discount-dialog";
import { POSLineDiscountDialog } from "@/components/pos/line-discount-dialog";
import { POSLineNoteDialog } from "@/components/pos/line-note-dialog";
import { POSHoldOrderDialog } from "@/components/pos/hold-order-dialog";
import { POSHeldOrdersDialog } from "@/components/pos/held-orders-dialog";
import {
  getHeldOrders,
  heldOrdersScope,
  loadHeldOrders,
  removeHeldOrder,
  saveHeldOrder,
  type HeldOrder,
} from "@/lib/pos/held-orders";
import {
  describeHeldOrderAdjustments,
  revalidateHeldCart,
} from "@/lib/pos/revalidate-held-order";
import { getPOSPurchasableQuantity } from "@/lib/pos/product-stock";
import { filterOfflineProducts } from "@/lib/pos/offline-catalog";
import { nextLocalReceiptNumber } from "@/lib/pos/offline-receipt";
import { offlineScope } from "@/lib/pos/offline-db";
import type { POSOfflineState } from "@/hooks/use-pos-offline";
import { productAllowsOversell } from "@/lib/products/stock-policy";
import { POSSaleCompleteModal } from "@/components/pos/sale-complete-modal";
import { POSTakePaymentDialog } from "@/components/pos/take-payment-dialog";
import type {
  CustomerMode,
  POSCartItem,
  POSCategory,
  POSCompletedOrder,
  POSCustomer,
  POSLineDiscount,
  POSProduct,
  POSVariant,
  ReceiptPrintPayload,
} from "@/components/pos/pos-types";
import type { POSSettings } from "@/lib/pos/build-pos-settings";
import QRCode from "qrcode";
import { useFullscreen } from "@/hooks/use-fullscreen";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";
import { useHydrated } from "@/hooks/use-client-value";

type POSStockStatusFilter = "all" | "in_stock" | "out_of_stock";
export type POSMobileTab = "products" | "cart";

interface POSTerminalControlledState {
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  stockStatus: POSStockStatusFilter;
  setStockStatus: (value: POSStockStatusFilter) => void;
  cart: POSCartItem[];
  setCart: React.Dispatch<React.SetStateAction<POSCartItem[]>>;
  products: POSProduct[];
  setProducts: React.Dispatch<React.SetStateAction<POSProduct[]>>;
  categories: POSCategory[];
  setCategories: React.Dispatch<React.SetStateAction<POSCategory[]>>;
  mobileTab: POSMobileTab;
  setMobileTab: (value: POSMobileTab) => void;
  addToCart: (product: POSProduct, variant?: POSVariant) => void;
  /**
   * Publishes this terminal's "park the sale" action to the workspace.
   *
   * The counter switcher lives up there because the workspace owns the
   * location, but a hold has to carry the customer, note and discount — state
   * that only lives down here. Lifting all of it would mean threading four more
   * pairs through every render; handing up one function does not.
   */
  registerHoldSale?: (hold: ((label: string) => boolean) | null) => void;
  /**
   * True while a payment is being taken. The counter badge disables itself on
   * it: an order stamps one `posLocationId` while `decrementInventory` is given
   * another, and the two must not be able to disagree mid-sale.
   */
  onSaleBusyChange?: (busy: boolean) => void;
  /**
   * Non-null when this register must not take another payment — today, that is
   * a counter deactivated under the cashier mid-shift. The sale already on the
   * counter stays theirs to finish or void; it is the next payment that stops,
   * because the order would stamp a branch the merchant has closed and
   * `decrementInventory` would draw stock down from it.
   */
  saleBlockedReason?: string | null;
}

type POSTerminalProps = {
  settings: POSSettings;
  controlledState: POSTerminalControlledState;
  /** Offline queue + snapshot, owned by POSWorkspace. */
  offline: POSOfflineState;
};

export function POSTerminal({
  settings,
  controlledState,
  offline,
}: POSTerminalProps) {
  const t = useTranslations();

  // Search, filter and cart state live in POSWorkspace so the search/scan bar
  // can render outside this card. Scanning is handled entirely by the parent.
  const {
    products,
    setProducts,
    categories,
    setCategories,
    cart,
    setCart,
    searchQuery,
    stockStatus,
    mobileTab,
    setMobileTab,
    addToCart,
    registerHoldSale,
    onSaleBusyChange,
    saleBlockedReason,
  } = controlledState;

  // Idempotency key for the in-progress sale; cleared on success/cart reset.
  const saleRequestIdRef = React.useRef<string | null>(null);

  // State that stays in POSTerminal
  const [customer, setCustomer] = React.useState<POSCustomer | null>(null);
  const [customerSearch, setCustomerSearch] = React.useState("");
  const [customerResults, setCustomerResults] = React.useState<POSCustomer[]>(
    [],
  );
  const [selectedCategory, setSelectedCategory] = React.useState<string>("");
  const [orderNote, setOrderNote] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [completedOrder, setCompletedOrder] =
    React.useState<POSCompletedOrder | null>(null);
  const [showCustomerDialog, setShowCustomerDialog] = React.useState(false);
  const [customerMode, setCustomerMode] =
    React.useState<CustomerMode>("search");
  const [isWalkIn, setIsWalkIn] = React.useState(false);
  const [newCustomerName, setNewCustomerName] = React.useState("");
  const [newCustomerEmail, setNewCustomerEmail] = React.useState("");
  const [newCustomerPhone, setNewCustomerPhone] = React.useState("");
  const [isCreatingCustomer, setIsCreatingCustomer] = React.useState(false);
  const [selectedProduct, setSelectedProduct] =
    React.useState<POSProduct | null>(null);
  const [cashTendered, setCashTendered] = React.useState("");
  const [paymentReference, setPaymentReference] = React.useState("");
  const [paymentNote, setPaymentNote] = React.useState("");
  const [showTakePaymentDialog, setShowTakePaymentDialog] =
    React.useState(false);
  const [showDiscountDialog, setShowDiscountDialog] = React.useState(false);
  const [showHoldDialog, setShowHoldDialog] = React.useState(false);
  const [showHeldOrdersDialog, setShowHeldOrdersDialog] = React.useState(false);
  const [heldOrders, setHeldOrders] = React.useState<HeldOrder[]>([]);
  const [resumingHeldId, setResumingHeldId] = React.useState<string | null>(
    null,
  );
  const [showSaleCompleteModal, setShowSaleCompleteModal] =
    React.useState(false);
  const [lastPaymentMethod, setLastPaymentMethod] = React.useState<
    string | null
  >(null);
  const [discount, setDiscount] = React.useState<POSDiscount | null>(null);
  const [lineDiscountItemId, setLineDiscountItemId] = React.useState<
    string | null
  >(null);
  const [lineNoteItemId, setLineNoteItemId] = React.useState<string | null>(
    null,
  );
  const [lastReceipt, setLastReceipt] =
    React.useState<ReceiptPrintPayload | null>(null);
  const printReceiptRef = React.useRef<
    ((receipt: ReceiptPrintPayload | null) => Promise<void>) | null
  >(null);
  const customerSearchTimerRef = React.useRef<NodeJS.Timeout | null>(null);
  const { formatPrice } = useCurrency();

  // Configure POS sounds
  React.useEffect(() => {
    if (settings.sound) {
      configurePOSSounds(settings.sound);
    }
  }, [settings.sound]);

  // Holds belong to one register, not to the browser: keyed by location so a
  // cashier never resumes a sale parked at another counter.
  const holdScope = React.useMemo(
    () => heldOrdersScope(settings.posLocationId),
    [settings.posLocationId],
  );

  // Load any orders parked on this register from a previous session. Storage
  // is only readable in the browser, so this waits for hydration.
  const hydrated = useHydrated();
  useApplyOnChange([holdScope, hydrated], () => {
    if (hydrated) setHeldOrders(loadHeldOrders(holdScope));
  });

  const { toggleFullscreen } = useFullscreen({
    onError: () => toast.error("Fullscreen is not available in this browser"),
  });

  // Format price helper - uses dynamic currency from store
  const fp = React.useCallback(
    (amount: number) => formatPrice(amount),
    [formatPrice],
  );

  // Cart calculations
  // Compute the discounted price for a single line item (price * qty minus line discount)
  const getLineDiscountAmount = React.useCallback(
    (item: POSCartItem): number => {
      if (!item.lineDiscount) return 0;
      const lineSubtotal = item.price * item.quantity;
      const value = Math.max(0, item.lineDiscount.value);
      if (item.lineDiscount.type === "percent") {
        return (lineSubtotal * Math.min(value, 100)) / 100;
      }
      return Math.min(value, lineSubtotal);
    },
    [],
  );

  // Subtotal: sum of line totals after line discounts
  const lineDiscountTotal = React.useMemo(
    () => cart.reduce((sum, item) => sum + getLineDiscountAmount(item), 0),
    [cart, getLineDiscountAmount],
  );
  const subtotal = cart.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );
  const discountedSubtotal = Math.max(0, subtotal - lineDiscountTotal);
  const tax = discountedSubtotal * settings.taxRate;
  const discountAmount = React.useMemo(() => {
    if (!discount) return 0;
    const value = Math.max(0, discount.value);
    if (discount.type === "percent") {
      return (discountedSubtotal * Math.min(value, 100)) / 100;
    }
    return Math.min(value, discountedSubtotal);
  }, [discount, discountedSubtotal]);
  const total = Math.max(0, discountedSubtotal - discountAmount + tax);
  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);

  // ============================================
  // Data Fetching
  // ============================================

  // The category list is global and arrives with the first response; keeping it
  // in a ref (rather than a dependency) stops a second full product fetch from
  // firing the moment it lands.
  const hasCategoriesRef = React.useRef(categories.length > 0);
  React.useEffect(() => {
    hasCategoriesRef.current = categories.length > 0;
  }, [categories.length]);

  // The exact request the current filter state describes. Comparing query
  // strings (instead of tracking "did we already mount?") keeps the effect
  // idempotent, so StrictMode's double-invoke cannot fire a stray request.
  const productQuery = React.useMemo(() => {
    const params = new URLSearchParams();
    if (searchQuery) params.set("search", searchQuery);
    if (selectedCategory) params.set("category", selectedCategory);
    if (stockStatus !== "all") params.set("stockStatus", stockStatus);
    if (settings.posLocationId) {
      params.set("locationId", settings.posLocationId);
    }
    return params.toString();
  }, [
    searchQuery,
    selectedCategory,
    stockStatus,
    settings.posLocationId,
  ]);

  const fetchProducts = React.useCallback(
    async (query: string, signal: AbortSignal) => {
      try {
        const res = await fetch(`/api/pos/products?${query}`, { signal });
        const json = await res.json();
        if (signal.aborted) return false;
        if (!json.success) return false;

        setProducts(json.data.products);
        if (!hasCategoriesRef.current) {
          setCategories(json.data.categories);
        }
        return true;
      } catch (error) {
        // A superseded request is expected, not a failure worth reporting.
        if ((error as Error)?.name === "AbortError") return false;

        // The server is unreachable, so answer the same question from the
        // snapshot instead of emptying the grid under the cashier's hands.
        // `filterOfflineProducts` mirrors the server's query, so the results
        // do not change shape when the connection does.
        const params = new URLSearchParams(query);
        setProducts(
          filterOfflineProducts(offline.offlineProducts, {
            search: params.get("search") || "",
            categoryId: params.get("category") || "",
            stockStatus:
              (params.get("stockStatus") as POSStockStatusFilter) || "all",
          }),
        );
        return true;
      } finally {
        if (!signal.aborted) setIsLoading(false);
      }
    },
    [setProducts, setCategories, offline.offlineProducts],
  );

  // What the grid currently reflects. Seeded with the query the server render
  // already answered, so mounting fetches nothing.
  const appliedQueryRef = React.useRef(productQuery);

  React.useEffect(() => {
    if (productQuery === appliedQueryRef.current) return;

    const appliedSearch =
      new URLSearchParams(appliedQueryRef.current).get("search") ?? "";
    const searchChanged = appliedSearch !== searchQuery;

    setIsLoading(true);
    const controller = new AbortController();
    // Typing needs debouncing; picking a category or filter should feel instant.
    const timer = setTimeout(
      () => {
        void fetchProducts(productQuery, controller.signal).then((applied) => {
          if (applied) appliedQueryRef.current = productQuery;
        });
      },
      searchChanged ? 300 : 0,
    );

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [fetchProducts, productQuery, searchQuery]);

  // Customer search
  useApplyOnChange([customerSearch], () => {
    if (customerSearch.length < 2) setCustomerResults([]);
  });
  React.useEffect(() => {
    if (customerSearchTimerRef.current) {
      clearTimeout(customerSearchTimerRef.current);
    }
    if (customerSearch.length < 2) return;
    customerSearchTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/pos/customers?search=${encodeURIComponent(customerSearch)}`,
        );
        const json = await res.json();
        if (json.success) {
          setCustomerResults(json.data);
        }
      } catch {
        // silent fail
      }
    }, 300);
  }, [customerSearch]);

  // ============================================
  // Cart Operations
  // ============================================

  const updateQuantity = React.useCallback(
    (itemId: string, delta: number) => {
      setCart((prev) =>
        prev.map((item) => {
          if (item.id !== itemId) return item;
          const newQty = item.quantity + delta;
          if (newQty <= 0) return item;
          if (newQty > item.maxStock) {
            toast.error(t("pos.outOfStock"));
            return item;
          }
          return { ...item, quantity: newQty };
        }),
      );
    },
    [setCart, t],
  );

  const removeFromCart = React.useCallback(
    (itemId: string) => {
      setCart((prev) => prev.filter((item) => item.id !== itemId));
    },
    [setCart],
  );

  const applyLineDiscount = React.useCallback(
    (itemId: string, lineDiscount: POSLineDiscount | null) => {
      setCart((prev) =>
        prev.map((item) => {
          if (item.id !== itemId) return item;
          if (!lineDiscount) {
            const { lineDiscount: _omit, ...rest } = item;
            return rest;
          }
          return { ...item, lineDiscount };
        }),
      );
    },
    [setCart],
  );

  const applyLineNote = React.useCallback(
    (itemId: string, note: string | null) => {
      setCart((prev) =>
        prev.map((item) => {
          if (item.id !== itemId) return item;
          if (!note) {
            const { lineNote: _omit, ...rest } = item;
            return rest;
          }
          return { ...item, lineNote: note };
        }),
      );
    },
    [setCart],
  );

  const openLineDiscountDialog = React.useCallback((itemId: string) => {
    setLineDiscountItemId(itemId);
  }, []);

  const openLineNoteDialog = React.useCallback((itemId: string) => {
    setLineNoteItemId(itemId);
  }, []);

  const closeLineDiscountDialog = React.useCallback(() => {
    setLineDiscountItemId(null);
  }, []);

  const closeLineNoteDialog = React.useCallback(() => {
    setLineNoteItemId(null);
  }, []);

  // Currently active item for line dialogs
  const lineDiscountItem = React.useMemo(
    () =>
      lineDiscountItemId
        ? cart.find((item) => item.id === lineDiscountItemId)
        : null,
    [lineDiscountItemId, cart],
  );
  const lineNoteItem = React.useMemo(
    () =>
      lineNoteItemId ? cart.find((item) => item.id === lineNoteItemId) : null,
    [lineNoteItemId, cart],
  );

  const clearCart = React.useCallback(() => {
    saleRequestIdRef.current = null;
    setCart([]);
    setCustomer(null);
    setIsWalkIn(false);
    setOrderNote("");
    setCompletedOrder(null);
    setCashTendered("");
    setPaymentReference("");
    setPaymentNote("");
    setDiscount(null);
    setLineDiscountItemId(null);
    setLineNoteItemId(null);
  }, [setCart]);

  // ============================================
  // Customer Dialog Helpers
  // ============================================

  const openCustomerDialog = React.useCallback(() => {
    setCustomerMode("search");
    setCustomerSearch("");
    setCustomerResults([]);
    setNewCustomerName("");
    setNewCustomerEmail("");
    setNewCustomerPhone("");
    setShowCustomerDialog(true);
  }, []);

  const closeCustomerDialog = React.useCallback(() => {
    setShowCustomerDialog(false);
    setCustomerSearch("");
    setCustomerResults([]);
    setNewCustomerName("");
    setNewCustomerEmail("");
    setNewCustomerPhone("");
    setIsCreatingCustomer(false);
  }, []);

  const selectCustomer = React.useCallback(
    (c: POSCustomer) => {
      setCustomer(c);
      setIsWalkIn(false);
      closeCustomerDialog();
    },
    [closeCustomerDialog],
  );

  const setWalkInCustomer = React.useCallback(() => {
    setCustomer(null);
    setIsWalkIn(true);
    closeCustomerDialog();
  }, [closeCustomerDialog]);

  const createNewCustomer = React.useCallback(async () => {
    if (!newCustomerName.trim() || !newCustomerEmail.trim()) {
      toast.error(t("pos.customer.nameEmailRequired"));
      return;
    }
    setIsCreatingCustomer(true);
    try {
      const res = await fetch("/api/pos/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newCustomerName.trim(),
          email: newCustomerEmail.trim(),
          phone: newCustomerPhone.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (json.success) {
        selectCustomer(json.data);
        toast.success(t("pos.customer.created"));
      } else {
        toast.error(json.message || t("pos.customer.createError"));
      }
    } catch {
      toast.error(t("pos.customer.createError"));
    } finally {
      setIsCreatingCustomer(false);
    }
  }, [newCustomerName, newCustomerEmail, newCustomerPhone, selectCustomer, t]);

  // ============================================
  // Handle product click (variants)
  // ============================================

  const handleProductClick = React.useCallback(
    (product: POSProduct) => {
      if (product.variants && product.variants.length > 0) {
        setSelectedProduct(product);
      } else {
        addToCart(product);
      }
    },
    [addToCart],
  );

  // ============================================
  // Checkout
  // ============================================

  const processPayment = React.useCallback(
    async (
      paymentMethod: string,
      cashTenderedOverride?: number,
      referenceOverride?: string,
      stripePaymentIntentIdOverride?: string,
    ) => {
      if (cart.length === 0) return false;
      const cashReceived =
        paymentMethod === "cash"
          ? (cashTenderedOverride ?? Number.parseFloat(cashTendered))
          : Number.NaN;
      if (
        paymentMethod === "cash" &&
        (!Number.isFinite(cashReceived) || cashReceived < total)
      ) {
        playPOSSound("error");
        toast.error("Cash tendered must cover the order total");
        return false;
      }

      setIsProcessing(true);

      const finalReference = referenceOverride ?? paymentReference;

      // Stable idempotency key for THIS sale: generated once per sale and kept
      // across retries, so a re-click after a network blip returns the order
      // the server already committed instead of ringing it up twice.
      if (!saleRequestIdRef.current) {
        saleRequestIdRef.current =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `pos_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      }

      // Built once, so the queued copy and the posted copy can never diverge:
      // an offline sale is replayed verbatim, and a difference between the two
      // would be a difference between the receipt and the books.
      const salePayload = {
            clientRequestId: saleRequestIdRef.current,
            items: cart.map((item) => {
              const lineDiscountAmount = getLineDiscountAmount(item);
              const lineTotal = item.price * item.quantity - lineDiscountAmount;
              return {
                productId: item.productId,
                variantId: item.variantId,
                name:
                  item.name +
                  (item.variantName ? ` - ${item.variantName}` : ""),
                sku: item.sku,
                price: item.price,
                quantity: item.quantity,
                image: item.image,
                vendorId: item.vendorId,
                lineTotal: Math.max(0, lineTotal),
                lineDiscount: item.lineDiscount
                  ? {
                      type: item.lineDiscount.type,
                      value: item.lineDiscount.value,
                      amount: lineDiscountAmount,
                    }
                  : undefined,
                lineNote: item.lineNote || undefined,
              };
            }),
            paymentMethod,
            cashTendered:
              paymentMethod === "cash" && Number.isFinite(cashReceived)
                ? cashReceived
                : undefined,
            paymentReference: finalReference || undefined,
            stripePaymentIntentId: stripePaymentIntentIdOverride || undefined,
            paymentNote: paymentNote || undefined,
            notes: orderNote,
            posLocationId: settings.posLocationId,
            customerId: customer?._id,
            discount: discount
              ? {
                  type: discount.type,
                  value: discount.value,
                  amount: discountAmount,
                  reason: discount.reason,
                  note: discount.note,
                }
              : undefined,
      };

      try {
        const res = await fetch("/api/pos/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(salePayload),
        });

        // Parsed defensively: only a fetch that never reached the server means
        // "offline". A proxy answering 502 with an HTML error page would throw
        // here, land in the offline branch, and print a receipt for a sale the
        // server may well have committed — the one outcome this whole feature
        // must not produce. A reached-but-unreadable response is a failure at
        // the till, not a queued sale.
        const json = await res.json().catch(() => null);
        if (!json) {
          playPOSSound("error");
          toast.error(t("pos.orderFailed"));
          return false;
        }
        if (json.success) {
          saleRequestIdRef.current = null;
          playPOSSound("payment");
          const balanceReturned =
            paymentMethod === "cash" &&
            Number.isFinite(cashReceived) &&
            cashReceived > total
              ? cashReceived - total
              : 0;
          const receiptPayload: ReceiptPrintPayload = {
            orderNumber: json.data.orderNumber,
            createdAt: json.data.createdAt || new Date(),
            locationName: settings.posLocationName,
            paymentMethod,
            cashTendered:
              paymentMethod === "cash" && Number.isFinite(cashReceived)
                ? cashReceived
                : undefined,
            paymentReference: finalReference || undefined,
            paymentNote: paymentNote || undefined,
            items: cart.map((item) => {
              const lineDiscountAmount = getLineDiscountAmount(item);
              return {
                name: item.variantName
                  ? `${item.name} ${item.variantName}`
                  : item.name,
                quantity: item.quantity,
                price: item.price,
                amount: Math.max(
                  0,
                  item.price * item.quantity - lineDiscountAmount,
                ),
              };
            }),
            subtotal: discountedSubtotal,
            tax,
            discount: discountAmount + lineDiscountTotal,
            total,
            balanceReturned,
          };
          setLastReceipt(receiptPayload);
          if (settings.printedReceiptsEnabled) {
            window.setTimeout(() => {
              void printReceiptRef.current?.(receiptPayload);
            }, 0);
          }
          const orderSummary = {
            _id: json.data._id,
            orderNumber: json.data.orderNumber,
            total: json.data.total,
            itemCount: cart.reduce((sum, item) => sum + item.quantity, 0),
            cashTendered:
              paymentMethod === "cash" && Number.isFinite(cashReceived)
                ? cashReceived
                : undefined,
            changeDue: balanceReturned,
            paymentReference: finalReference || undefined,
            paymentNote: paymentNote || undefined,
          };
          setCompletedOrder(orderSummary);
          setCart([]);
          setCustomer(null);
          setIsWalkIn(false);
          setOrderNote("");
          setCashTendered("");
          setPaymentReference("");
          setPaymentNote("");
          setDiscount(null);
          setLineDiscountItemId(null);
          setLineNoteItemId(null);
          setLastPaymentMethod(paymentMethod);
          setShowSaleCompleteModal(true);
          toast.success(
            `${t("pos.orderComplete")} #${orderSummary.orderNumber}`,
          );
          // Play order complete chime after a short delay
          setTimeout(() => playPOSSound("orderComplete"), 400);
          return true;
        } else {
          playPOSSound("error");
          toast.error(json.message || t("pos.orderFailed"));
          return false;
        }
      } catch {
        // The request never reached the server. The customer is at the counter
        // and the money is being handed over now, so the sale is taken and
        // queued rather than refused — `clientRequestId` makes the later replay
        // idempotent, and the provisional number is what goes on their receipt.
        const localReceiptNumber = nextLocalReceiptNumber(
          offlineScope(settings.posLocationId),
        );

        try {
          await offline.queueSale({
            clientRequestId: saleRequestIdRef.current as string,
            scope: offlineScope(settings.posLocationId),
            payload: { ...salePayload, localReceiptNumber },
            localReceiptNumber,
            items: cart.map((item) => ({
              name: item.variantName
                ? `${item.name} ${item.variantName}`
                : item.name,
              quantity: item.quantity,
              price: item.price,
            })),
            total,
            status: "pending",
            queuedAt: new Date().toISOString(),
            attempts: 0,
          });
        } catch (queueError) {
          // Reached when the browser has no usable storage (private mode,
          // blocked site data) or the queue is full. Refusing is the honest
          // outcome either way: taking money for a sale that exists nowhere
          // would be worse. The cashier is told *why*, because "failed" and
          // "you have 500 sales waiting to sync" call for different actions.
          playPOSSound("error");
          toast.error(
            queueError instanceof Error && queueError.message
              ? queueError.message
              : t("pos.orderFailed"),
          );
          return false;
        }

        saleRequestIdRef.current = null;
        playPOSSound("payment");

        const balanceReturned =
          paymentMethod === "cash" &&
          Number.isFinite(cashReceived) &&
          cashReceived > total
            ? cashReceived - total
            : 0;
        const receiptPayload: ReceiptPrintPayload = {
          orderNumber: localReceiptNumber,
          createdAt: new Date(),
          paymentMethod,
          cashTendered:
            paymentMethod === "cash" && Number.isFinite(cashReceived)
              ? cashReceived
              : undefined,
          paymentReference: finalReference || undefined,
          paymentNote: paymentNote || undefined,
          items: cart.map((item) => {
            const lineDiscountAmount = getLineDiscountAmount(item);
            return {
              name: item.variantName
                ? `${item.name} ${item.variantName}`
                : item.name,
              quantity: item.quantity,
              price: item.price,
              amount: Math.max(
                0,
                item.price * item.quantity - lineDiscountAmount,
              ),
            };
          }),
          subtotal: discountedSubtotal,
          tax,
          discount: discountAmount + lineDiscountTotal,
          total,
          balanceReturned,
        };
        setLastReceipt(receiptPayload);
        if (settings.printedReceiptsEnabled) {
          window.setTimeout(() => {
            void printReceiptRef.current?.(receiptPayload);
          }, 0);
        }

        setCompletedOrder({
          // No server id yet; the receipt number is the only handle that exists.
          _id: localReceiptNumber,
          orderNumber: localReceiptNumber,
          total,
          itemCount: cart.reduce((sum, item) => sum + item.quantity, 0),
          cashTendered:
            paymentMethod === "cash" && Number.isFinite(cashReceived)
              ? cashReceived
              : undefined,
          changeDue: balanceReturned,
          paymentReference: finalReference || undefined,
          paymentNote: paymentNote || undefined,
        });
        setCart([]);
        setCustomer(null);
        setIsWalkIn(false);
        setOrderNote("");
        setCashTendered("");
        setPaymentReference("");
        setPaymentNote("");
        setDiscount(null);
        setLineDiscountItemId(null);
        setLineNoteItemId(null);
        setLastPaymentMethod(paymentMethod);
        setShowSaleCompleteModal(true);
        toast.success(`Saved offline — receipt ${localReceiptNumber}`, {
          description: "It will sync automatically when the connection returns.",
        });
        setTimeout(() => playPOSSound("orderComplete"), 400);
        return true;
      } finally {
        setIsProcessing(false);
      }
    },
    [
      cart,
      cashTendered,
      paymentNote,
      paymentReference,
      orderNote,
      customer,
      discount,
      discountAmount,
      getLineDiscountAmount,
      lineDiscountTotal,
      discountedSubtotal,
      settings.posLocationId,
      settings.posLocationName,
      settings.printedReceiptsEnabled,
      offline,
      setCart,
      tax,
      total,
      t,
    ],
  );

  const createStripeIntent = React.useCallback(async () => {
    const res = await fetch("/api/pos/payments/stripe/intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: cart.map((item) => {
          const lineDiscountAmount = getLineDiscountAmount(item);
          const lineTotal = item.price * item.quantity - lineDiscountAmount;
          return {
            productId: item.productId,
            variantId: item.variantId,
            name:
              item.name + (item.variantName ? ` - ${item.variantName}` : ""),
            sku: item.sku,
            price: item.price,
            quantity: item.quantity,
            image: item.image,
            vendorId: item.vendorId,
            lineTotal: Math.max(0, lineTotal),
            lineDiscount: item.lineDiscount
              ? {
                  type: item.lineDiscount.type,
                  value: item.lineDiscount.value,
                  amount: lineDiscountAmount,
                }
              : undefined,
            lineNote: item.lineNote || undefined,
          };
        }),
        posLocationId: settings.posLocationId,
        customerId: customer?._id,
        discount: discount
          ? {
              type: discount.type,
              value: discount.value,
              amount: discountAmount,
              reason: discount.reason,
              note: discount.note,
            }
          : undefined,
      }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) {
      throw new Error(json?.message || "Failed to initialize Stripe payment");
    }
    const paymentIntentId = String(json.data?.paymentIntentId || "");
    const clientSecret = String(json.data?.clientSecret || "");
    if (!paymentIntentId || !clientSecret) {
      throw new Error("Failed to initialize Stripe payment");
    }
    return { paymentIntentId, clientSecret };
  }, [
    cart,
    customer,
    discount,
    discountAmount,
    getLineDiscountAmount,
    settings.posLocationId,
  ]);

  const printReceipt = React.useCallback(
    async (receipt: ReceiptPrintPayload | null) => {
      if (!receipt) {
        toast.error("No receipt data available");
        return;
      }

      const escapeHtml = (value: string) =>
        value
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\"/g, "&quot;")
          .replace(/'/g, "&#39;");

      const dateText = new Intl.DateTimeFormat(settings.locale || "en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }).format(new Date(receipt.createdAt));

      // Build the URL the QR code should resolve to. Use a stable order
      // lookup URL so a customer can scan and view their receipt.
      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      const orderUrl = `${origin}/${encodeURIComponent(
        settings.locale || "en",
      )}/track-order?orderNumber=${encodeURIComponent(receipt.orderNumber)}`;

      // Use a compact Code 128 symbol for the order lookup value. The
      // backwards-compatible helper name is retained for older callers.
      const barcodeValue = receipt.orderNumber.replace(/[^A-Za-z0-9]/g, "");
      const barcodeSVG = buildCode39SVG(barcodeValue, {
        height: 40,
        narrow: 1,
        wideRatio: 2.5,
        showText: true,
      });

      // Build a proper URL for the QR code. A small margin keeps the code
      // scannable on most thermal printers.
      const qrSrc = await QRCode.toDataURL(orderUrl, {
        width: 96,
        margin: 0,
        errorCorrectionLevel: "M",
        color: { dark: "#000000", light: "#ffffff" },
      });

      const paymentLabelMap: Record<string, string> = {
        cash: "Cash",
        card: "Card",
        bank: "Bank",
        manual: "Manual",
      };
      const paymentLabel =
        paymentLabelMap[receipt.paymentMethod.toLowerCase()] ||
        receipt.paymentMethod.charAt(0).toUpperCase() +
          receipt.paymentMethod.slice(1);

      const sgst = receipt.tax / 2;
      const cgst = receipt.tax / 2;
      const itemRows = receipt.items
        .map(
          (item) => `
          <tr>
            <td class="qty">${item.quantity}</td>
            <td class="name">${escapeHtml(item.name)}</td>
            <td class="money">${fp(item.price)}</td>
            <td class="money">${fp(item.amount)}</td>
          </tr>
        `,
        )
        .join("");

      // Render the receipt in a hidden iframe so the user only sees the
      // system print dialog (not a second visible window behind it). The
      // iframe is sized to a typical 80mm thermal receipt, and removed
      // automatically once the print dialog closes.
      const iframe = document.createElement("iframe");
      iframe.title = `Receipt #${receipt.orderNumber}`;
      iframe.setAttribute("aria-hidden", "true");
      iframe.tabIndex = -1;
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "0";
      iframe.style.opacity = "0";
      iframe.style.pointerEvents = "none";
      document.body.appendChild(iframe);

      const cleanup = () => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      };

      const handle = iframe.contentWindow;
      if (!handle) {
        cleanup();
        toast.error("Unable to open print preview");
        return;
      }

      handle.document.open();
      handle.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Receipt #${escapeHtml(receipt.orderNumber)}</title>
  <style>
    html, body { background: #fff; color: #000; width: 80mm; min-width: 80mm; max-width: 80mm; }
    body { font-family: 'Courier New', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; margin: 0 auto; padding: 0; }
    .receipt { width: 80mm; max-width: 80mm; margin: 0; padding: 4mm 2.5mm; box-sizing: border-box; font-size: 10px; line-height: 1.25; color: #000; }
    .center { text-align: center; }
    .row { display: flex; justify-content: space-between; gap: 6px; }
    .store { font-size: 13px; font-weight: 800; line-height: 1.1; margin: 0; letter-spacing: 0.3px; text-transform: uppercase; }
    .meta { font-size: 9px; line-height: 1.25; margin: 2px 0 0; }
    .meta div { word-break: break-word; }
    .dash { border-top: 1px dashed #000; margin: 5px 0; }
    .info { font-size: 9px; }
    .info .line { display: flex; justify-content: space-between; margin: 0; gap: 6px; }
    .info .line .lbl { color: #000; }
    .info .line .val { font-weight: 700; }
    .items { width: 100%; border-collapse: collapse; font-size: 9px; }
    .items th { border-bottom: 1px solid #000; padding: 3px 1px; text-align: left; font-weight: 800; text-transform: uppercase; font-size: 8px; letter-spacing: 0.2px; }
    .items td { padding: 3px 1px; vertical-align: top; }
    .items .qty { width: 24px; text-align: center; }
    .items .name { word-break: break-word; line-height: 1.2; }
    .items .money { text-align: right; white-space: nowrap; padding-left: 4px; }
    .totals { margin-top: 4px; font-size: 9px; }
    .totals .r { display: flex; justify-content: space-between; margin: 2px 0; gap: 8px; }
    .totals .r span:last-child { white-space: nowrap; }
    .totals .grand { font-size: 12px; font-weight: 800; border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 4px 0; margin-top: 4px; letter-spacing: 0.3px; }
    .totals .grand span:last-child { font-size: 13px; }
    .thanks { font-size: 10px; text-align: center; margin: 6px 0 2px; font-weight: 700; }
    .footer-note { font-size: 8px; text-align: center; margin: 0; color: #000; }
    .barcode-wrap { width: 100%; max-width: 58mm; margin: 6px auto 2px; }
    .barcode-wrap svg { display: block; width: 100%; height: auto; }
    .qr-wrap { display: flex; flex-direction: column; align-items: center; margin: 5px 0 0; }
    .qr-wrap img { width: 64px; height: 64px; display: block; }
    .scan-text { font-size: 8px; text-align: center; margin-top: 3px; color: #000; }
    @media screen {
      html, body { margin: 0 auto; }
    }
    @media print {
      @page { size: 80mm auto; margin: 0 !important; }
      html, body {
        width: 80mm !important;
        min-width: 80mm !important;
        max-width: 80mm !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: visible !important;
        background: #fff !important;
      }
      body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .receipt {
        width: 80mm !important;
        max-width: 80mm !important;
        margin: 0 !important;
        padding: 3mm 2.5mm !important;
      }
    }
  </style>
</head>
<body>
  <div class="receipt">
    <!-- Store header -->
    <div class="center">
      <p class="store">${escapeHtml(settings.storeName || "Store")}</p>
      <div class="meta">
        ${
          settings.storeAddress
            ? `<div>${escapeHtml(settings.storeAddress)}</div>`
            : ""
        }
        ${
          settings.storePhone
            ? `<div>Phone: ${escapeHtml(settings.storePhone)}</div>`
            : ""
        }
        ${
          settings.storeEmail
            ? `<div>${escapeHtml(settings.storeEmail)}</div>`
            : ""
        }
        ${
          // Which counter sold this. The receipt is the only record the customer
          // leaves with, and a return has to be traced back to the branch whose
          // stock the units actually came off. Omitted on a register selling
          // from shared stock, where naming one would be a guess.
          receipt.locationName
            ? `<div>Counter: ${escapeHtml(receipt.locationName)}</div>`
            : ""
        }
      </div>
    </div>
    <div class="dash"></div>

    <!-- Order info -->
    <div class="info">
      <div class="line"><span class="lbl">Order #</span><span class="val">${escapeHtml(receipt.orderNumber)}</span></div>
      <div class="line"><span class="lbl">Date</span><span class="val">${escapeHtml(dateText)}</span></div>
      <div class="line"><span class="lbl">Payment</span><span class="val">${escapeHtml(paymentLabel)}</span></div>
    </div>
    <div class="dash"></div>

    <!-- Items -->
    <table class="items">
      <thead>
        <tr>
          <th class="qty">Qty</th>
          <th>Item</th>
          <th class="money">Price</th>
          <th class="money">Amount</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>

    <!-- Totals -->
    <div class="totals">
      <div class="r"><span>Sub Total</span><span>${fp(receipt.subtotal)}</span></div>
      ${
        receipt.discount > 0
          ? `<div class="r"><span>Discount</span><span>-${fp(receipt.discount)}</span></div>`
          : ""
      }
      ${
        receipt.tax > 0
          ? `<div class="r"><span>SGST (${(settings.taxRate * 50).toFixed(1)}%)</span><span>${fp(sgst)}</span></div>
      <div class="r"><span>CGST (${(settings.taxRate * 50).toFixed(1)}%)</span><span>${fp(cgst)}</span></div>`
          : ""
      }
      ${
        receipt.cashTendered !== undefined
          ? `<div class="r"><span>Cash Tendered</span><span>${fp(receipt.cashTendered)}</span></div>`
          : ""
      }
      ${
        receipt.balanceReturned > 0
          ? `<div class="r"><span>Balance Returned</span><span>${fp(receipt.balanceReturned)}</span></div>`
          : ""
      }
      <div class="r grand"><span>TOTAL</span><span>${fp(receipt.total)}</span></div>
    </div>

    <div class="dash"></div>

    <!-- Barcode -->
    <div class="barcode-wrap center">${barcodeSVG}</div>

    <!-- Thank you message -->
    <p class="thanks">Thank you for your visit!</p>
    <p class="footer-note">Please come again</p>

    <!-- QR code -->
    <div class="qr-wrap">
      <img src="${qrSrc}" alt="QR code for order ${escapeHtml(receipt.orderNumber)}" />
      <p class="scan-text">Scan to view digital receipt</p>
    </div>
  </div>
</body>
</html>`);
      handle.document.close();

      // Wait for the iframe to finish loading styles, then trigger the
      // system print dialog. The afterprint event (or a 2s safety
      // timeout) cleans the iframe up so it doesn't pile up in the DOM.
      const triggerPrint = () => {
        try {
          handle.focus();
          handle.print();
        } catch (err) {
          // Some browsers throw if print isn't permitted in the context.
          console.error("Print failed", err);
        }
        const safety = window.setTimeout(cleanup, 2000);
        const onAfterPrint = () => {
          window.clearTimeout(safety);
          handle.removeEventListener("afterprint", onAfterPrint);
          cleanup();
        };
        handle.addEventListener("afterprint", onAfterPrint);
      };

      // document.write blocks until the document is parsed, so the
      // content is ready immediately. Use a microtask + a fallback
      // timeout in case the browser is slow.
      if (iframe.contentDocument?.readyState === "complete") {
        triggerPrint();
      } else {
        const ready = () => {
          iframe.removeEventListener("load", ready);
          triggerPrint();
        };
        iframe.addEventListener("load", ready);
        window.setTimeout(triggerPrint, 350);
      }
    },
    [
      fp,
      settings.locale,
      settings.storeName,
      settings.storePhone,
      settings.storeEmail,
      settings.storeAddress,
      settings.taxRate,
    ],
  );

  React.useEffect(() => {
    printReceiptRef.current = printReceipt;
    return () => {
      printReceiptRef.current = null;
    };
  }, [printReceipt]);

  const openInvoice = React.useCallback(
    (disposition: "attachment" | "inline") => {
      if (!completedOrder?._id) {
        toast.error("No invoice is available for this order");
        return;
      }

      const params = disposition === "inline" ? "?disposition=inline" : "";
      const popup = window.open(
        `/api/pos/orders/${encodeURIComponent(completedOrder._id)}/invoice${params}`,
        "_blank",
        "noopener,noreferrer",
      );
      if (!popup) {
        toast.error("Unable to open invoice. Please allow popups.");
      }
    },
    [completedOrder],
  );

  /**
   * A held sale carries the prices and stock counts it had when it was parked.
   * Restoring it verbatim would ring up stale prices and oversell stock another
   * register has since sold, so every line is re-read against the live
   * catalogue first and the cashier is told what moved.
   */
  const resumeHeldOrder = React.useCallback(
    async (heldOrder: HeldOrder) => {
      // Resuming replaces the current cart. Guard against silently
      // discarding a non-empty active cart.
      if (cart.length > 0) {
        toast.error("Finish or hold the current sale before resuming another.");
        return;
      }
      if (resumingHeldId) return;

      setResumingHeldId(heldOrder.id);
      try {
        const ids = Array.from(
          new Set(heldOrder.cart.map((item) => item.productId)),
        );
        const params = new URLSearchParams({ ids: ids.join(",") });
        if (settings.posLocationId) {
          params.set("locationId", settings.posLocationId);
        }

        const res = await fetch(`/api/pos/products?${params.toString()}`);
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.message || "Lookup failed");
        }

        const { cart: freshCart, adjustments, isEmpty } = revalidateHeldCart(
          heldOrder.cart,
          json.data.products ?? [],
        );

        if (isEmpty) {
          // Nothing left to sell. The hold is kept rather than consumed, so the
          // cashier decides whether to delete it instead of watching it vanish.
          toast.error(
            "None of the items on this held order are still available. It has been left on the register.",
          );
          return;
        }

        saleRequestIdRef.current = null;
        setCart(freshCart);
        setCustomer(heldOrder.customer);
        setIsWalkIn(heldOrder.isWalkIn);
        setOrderNote(heldOrder.orderNote);
        setDiscount(heldOrder.discount);
        setHeldOrders(removeHeldOrder(heldOrder.id, holdScope));
        setShowHeldOrdersDialog(false);
        setMobileTab("cart");

        if (adjustments.length > 0) {
          toast.warning(
            `Held order resumed · ${describeHeldOrderAdjustments(adjustments)}`,
          );
        } else {
          toast.success("Held order resumed");
        }
      } catch {
        // The hold is untouched, so the cashier can simply try again.
        toast.error(
          "Could not check current prices and stock. The held order is still on the register.",
        );
      } finally {
        setResumingHeldId(null);
      }
    },
    [
      cart.length,
      holdScope,
      resumingHeldId,
      setCart,
      setMobileTab,
      settings.posLocationId,
    ],
  );

  /**
   * Park the sale on this register and clear the counter.
   *
   * Returns false when storage refused the write, so every caller keeps the
   * cart instead of clearing it behind a success toast: the hold dialog stays
   * open, and a counter switch does not proceed over a sale that was never
   * actually saved.
   */
  const holdCurrentSale = React.useCallback(
    (label: string): boolean => {
      try {
        saveHeldOrder(
          {
            label,
            cart,
            customer,
            isWalkIn,
            orderNote,
            discount,
          },
          holdScope,
        );
      } catch (err) {
        toast.error(
          err instanceof Error && err.message
            ? err.message
            : "Could not hold this order. The sale is still in the cart.",
        );
        return false;
      }

      setHeldOrders(getHeldOrders(holdScope));
      toast.success(`Order held${label ? ` · ${label}` : ""}`);
      // The next sale must not reuse this sale's idempotency key — the server
      // would return this sale's order as the new sale's "success" and the new
      // sale would never be recorded.
      saleRequestIdRef.current = null;
      setCart([]);
      setCustomer(null);
      setIsWalkIn(false);
      setOrderNote("");
      setDiscount(null);
      setLineDiscountItemId(null);
      setLineNoteItemId(null);
      setSelectedCategory("");
      return true;
    },
    [cart, customer, discount, holdScope, isWalkIn, orderNote, setCart],
  );

  // Hand the hold up to the workspace, which needs it to park a sale at the old
  // counter before moving the register. Cleared on unmount so a stale closure
  // can never park a sale against a cart that no longer exists.
  React.useEffect(() => {
    registerHoldSale?.(holdCurrentSale);
    return () => registerHoldSale?.(null);
  }, [holdCurrentSale, registerHoldSale]);

  // Anything that has already started taking money locks the counter switcher.
  const isSaleBusy =
    isProcessing || showTakePaymentDialog || showSaleCompleteModal;
  React.useEffect(() => {
    onSaleBusyChange?.(isSaleBusy);
  }, [isSaleBusy, onSaleBusyChange]);

  // ============================================
  // Keyboard shortcuts (fullscreen on Enter, hotkeys F2/F3/F4/F9).
  // "/" search focus, F8 scan focus and ALT+C calculator belong to
  // POSSearchBar, which owns those inputs and dialogs.
  // ============================================

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInEditable =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;
      const isButtonTarget = target?.closest("button, a");
      // Radix dialogs (calculator, camera, payment, hold…) are portalled, so
      // they are detected from the DOM rather than from local state.
      const hasOpenOverlay =
        showCustomerDialog ||
        Boolean(selectedProduct) ||
        showTakePaymentDialog ||
        showDiscountDialog ||
        showHoldDialog ||
        showSaleCompleteModal ||
        document.querySelector('[data-slot="dialog-content"]') !== null;

      if (
        e.key === "Enter" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !isInEditable &&
        !isButtonTarget &&
        !hasOpenOverlay
      ) {
        e.preventDefault();
        void toggleFullscreen();
        return;
      }

      // Function-key hotkeys (F2 customer, F3 discount, F4 hold, F9 checkout)
      if (e.key === "F2") {
        e.preventDefault();
        if (!hasOpenOverlay) openCustomerDialog();
      } else if (e.key === "F3") {
        e.preventDefault();
        if (cart.length > 0) {
          setShowDiscountDialog(true);
        }
      } else if (e.key === "F4") {
        e.preventDefault();
        // Mirrors the Hold/Held button: with an empty cart the same key opens
        // the parked sales instead of doing nothing, which is what made a held
        // order feel unrecoverable.
        if (cart.length > 0) {
          setShowHoldDialog(true);
        } else if (heldOrders.length > 0) {
          setShowHeldOrdersDialog(true);
        }
      } else if (e.key === "F9") {
        e.preventDefault();
        // The same block the button carries. A hotkey that walks past a guard
        // the button honours is the guard not existing.
        if (saleBlockedReason) {
          toast.error(saleBlockedReason);
        } else if (cart.length > 0 && !isProcessing) {
          setCashTendered("");
          setPaymentReference("");
          setPaymentNote("");
          setCompletedOrder(null);
          setShowTakePaymentDialog(true);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    cart.length,
    heldOrders.length,
    isProcessing,
    saleBlockedReason,
    selectedProduct,
    showCustomerDialog,
    showDiscountDialog,
    showHoldDialog,
    showSaleCompleteModal,
    showTakePaymentDialog,
    toggleFullscreen,
    openCustomerDialog,
  ]);

  // ============================================
  // Render: Customer Dialog Modal
  // ============================================

  const customerDialog = showCustomerDialog && (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeCustomerDialog();
      }}
    >
      <div className="bg-background rounded-2xl shadow-2xl max-w-lg w-full max-h-[85vh] flex flex-col border animate-in zoom-in-95 slide-in-from-bottom-2 duration-300">
        {/* Dialog Header */}
        <div className="flex items-center justify-between p-5 border-b">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <UserPlus className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-base">
                {t("pos.customer.addCustomer")}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t("pos.customer.addCustomerDesc")}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            onClick={closeCustomerDialog}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Walk-in Option */}
        <div className="px-5 pt-4">
          <button
            onClick={setWalkInCustomer}
            className="w-full flex items-center gap-3 p-3.5 rounded-xl border-2 border-dashed border-primary/40 dark:border-primary/30 text-left transition-all hover:border-primary hover:bg-primary/5 dark:hover:bg-primary/10 active:scale-[0.99]"
          >
            <div className="w-10 h-10 rounded-xl bg-primary/10 dark:bg-primary/20 flex items-center justify-center shrink-0">
              <Footprints className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="font-semibold text-sm">
                {t("pos.customer.walkIn")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("pos.customer.walkInDesc")}
              </p>
            </div>
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="flex gap-1 px-5 pt-4">
          <button
            onClick={() => setCustomerMode("search")}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-all",
              customerMode === "search"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
          >
            <Search className="w-3.5 h-3.5" />
            {t("pos.customer.existingCustomer")}
          </button>
          <button
            onClick={() => setCustomerMode("create")}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-all",
              customerMode === "create"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
          >
            <Plus className="w-3.5 h-3.5" />
            {t("pos.customer.createNew")}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {customerMode === "search" ? (
            <div className="p-5 space-y-3">
              {/* Search Input */}
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder={t("pos.customer.searchPlaceholder")}
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  className="pl-10 h-11 rounded-xl bg-muted/50 border-0 focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:bg-background"
                  autoFocus
                />
                {customerSearch && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full"
                    onClick={() => {
                      setCustomerSearch("");
                      setCustomerResults([]);
                    }}
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>

              {/* Search Results. Scrolls on the capped element itself, not a
                  ScrollArea — same reason as the variant list below: a `max-h`
                  with no definite height leaves Radix's `height: 100%` viewport
                  unresolvable, so it grew past the 15rem cap and the tenth
                  customer onward could not be reached. */}
              {customerSearch.length >= 2 && customerResults.length > 0 ? (
                <div className="max-h-60 overflow-y-auto overscroll-contain">
                  <div className="space-y-1">
                    {customerResults.map((c) => (
                      <button
                        key={c._id}
                        className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-muted/50 text-left transition-all active:scale-[0.99]"
                        onClick={() => selectCustomer(c)}
                      >
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                          {c.image ? (
                            <AppImage
                              src={c.image}
                              alt={c.name}
                              width={40}
                              height={40}
                              className="w-full h-full rounded-full object-cover"
                            />
                          ) : (
                            <UserCheck className="w-4 h-4 text-primary" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {c.name}
                          </p>
                          <div className="flex items-center gap-3 mt-0.5">
                            <span className="text-xs text-muted-foreground truncate flex items-center gap-1">
                              <Mail className="w-3 h-3" />
                              {c.email}
                            </span>
                            {c.phone && (
                              <span className="text-xs text-muted-foreground truncate flex items-center gap-1">
                                <Phone className="w-3 h-3" />
                                {c.phone}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : customerSearch.length >= 2 && customerResults.length === 0 ? (
                <div className="text-center py-8">
                  <div className="w-12 h-12 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-3">
                    <Search className="w-6 h-6 opacity-30" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t("pos.customer.noResults")}
                  </p>
                  <Button
                    variant="link"
                    size="sm"
                    className="mt-1 text-primary"
                    onClick={() => {
                      setCustomerMode("create");
                      setNewCustomerName(customerSearch);
                    }}
                  >
                    {t("pos.customer.createInstead")}
                  </Button>
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-sm text-muted-foreground">
                    {t("pos.customer.searchHint")}
                  </p>
                </div>
              )}
            </div>
          ) : (
            /* Create New Customer Form */
            <div className="p-5 space-y-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-1.5">
                  {t("pos.customer.customerName")}
                  <span className="text-destructive">*</span>
                </Label>
                <Input
                  placeholder={t("pos.customer.namePlaceholder")}
                  value={newCustomerName}
                  onChange={(e) => setNewCustomerName(e.target.value)}
                  className="h-11 rounded-xl"
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-1.5">
                  {t("pos.customer.emailAddress")}
                  <span className="text-destructive">*</span>
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    type="email"
                    placeholder={t("pos.customer.emailPlaceholder")}
                    value={newCustomerEmail}
                    onChange={(e) => setNewCustomerEmail(e.target.value)}
                    className="pl-10 h-11 rounded-xl"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">
                  {t("pos.customer.phone")}
                </Label>
                <div className="relative">
                  <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    type="tel"
                    placeholder={t("pos.customer.phonePlaceholder")}
                    value={newCustomerPhone}
                    onChange={(e) => setNewCustomerPhone(e.target.value)}
                    className="pl-10 h-11 rounded-xl"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Dialog Footer */}
        {customerMode === "create" && (
          <div className="flex items-center justify-end gap-2 p-5 border-t">
            <Button
              variant="outline"
              onClick={closeCustomerDialog}
              className="rounded-xl"
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={createNewCustomer}
              disabled={
                isCreatingCustomer ||
                !newCustomerName.trim() ||
                !newCustomerEmail.trim()
              }
              className="rounded-xl"
            >
              {isCreatingCustomer ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <UserPlus className="w-4 h-4 mr-2" />
              )}
              {t("pos.customer.save")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );

  // ============================================
  // Render: Variant Selector Modal
  // ============================================

  const variantModal = selectedProduct && (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) setSelectedProduct(null);
      }}
    >
      <div className="bg-background rounded-2xl shadow-2xl max-w-lg w-full max-h-[80vh] flex flex-col border animate-in zoom-in-95 slide-in-from-bottom-2 duration-300">
        <div className="flex items-center justify-between p-5 border-b">
          <div className="flex items-center gap-3">
            {selectedProduct.images?.[0] && (
              <div className="w-12 h-12 rounded-xl overflow-hidden bg-muted ring-1 ring-border/50">
                <AppImage
                  src={selectedProduct.images[0]}
                  alt={selectedProduct.name}
                  width={48}
                  height={48}
                  className="w-full h-full object-cover"
                />
              </div>
            )}
            <div>
              <h3 className="font-semibold">{selectedProduct.name}</h3>
              <p className="text-sm text-muted-foreground">
                {t("pos.selectVariant")}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            onClick={() => setSelectedProduct(null)}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
        {/* Scrolls on the flex item itself rather than through a ScrollArea.
            Radix puts `height: 100%` on its viewport, and a percentage height
            needs a definite height to resolve against — which this card, sized
            by its content under a `max-h-[80vh]` cap, never gives it. The
            viewport grew to the full variant list, the root clipped it at
            `overflow-hidden`, and nothing was scrollable: a jacket with 20
            variants showed the first nine and no way to reach the rest.
            `min-h-0` alone does not fix it; the percentage is the problem. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          <div className="grid grid-cols-1 gap-2">
            {selectedProduct.variants.map((variant) => {
              // Same rule as the grid card: the count is only a limit when the
              // product's stock policy says it is.
              const variantSellable =
                getPOSPurchasableQuantity(selectedProduct, variant.stock) > 0;
              return (
              <button
                key={variant._id}
                onClick={() => {
                  addToCart(selectedProduct, variant);
                  setSelectedProduct(null);
                }}
                disabled={!variantSellable}
                className={cn(
                  "flex items-center gap-3 p-3.5 rounded-xl border text-left transition-all w-full",
                  variantSellable
                    ? "hover:border-primary/50 hover:bg-primary/5 hover:shadow-sm cursor-pointer active:scale-[0.99]"
                    : "opacity-40 cursor-not-allowed",
                )}
              >
                {variant.image && (
                  <div className="w-11 h-11 rounded-lg overflow-hidden shrink-0 ring-1 ring-border/50">
                    <AppImage
                      src={variant.image}
                      alt={variant.name}
                      width={44}
                      height={44}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{variant.name}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                    <Hash className="w-3 h-3" />
                    {variant.sku}
                    <span className="text-border">|</span>
                    {variant.stock > 0 ? (
                      <span className="text-green-600 dark:text-green-400">
                        {variant.stock} {t("pos.inStock")}
                      </span>
                    ) : variantSellable ? (
                      <span className="text-green-600 dark:text-green-400">
                        {t("pos.inStock")}
                      </span>
                    ) : (
                      <span className="text-destructive">
                        {t("common.outOfStock")}
                      </span>
                    )}
                  </div>
                </div>
                <div className="font-bold text-sm tabular-nums">
                  {fp(variant.price)}
                </div>
              </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );

  // ============================================
  // Render: Main Terminal View
  // ============================================

  return (
    <TooltipProvider delayDuration={300}>
      <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-card lg:flex-row">
        {variantModal}
        {customerDialog}
        <POSDiscountDialog
          open={showDiscountDialog}
          onOpenChange={setShowDiscountDialog}
          subtotal={discountedSubtotal}
          tax={tax}
          taxIncluded={false}
          current={discount}
          onApply={setDiscount}
          fp={fp}
        />
        <POSLineDiscountDialog
          open={lineDiscountItemId !== null}
          onOpenChange={(open) => {
            if (!open) closeLineDiscountDialog();
          }}
          itemId={lineDiscountItemId}
          itemName={
            lineDiscountItem
              ? `${lineDiscountItem.name}${
                  lineDiscountItem.variantName
                    ? ` · ${lineDiscountItem.variantName}`
                    : ""
                }`
              : ""
          }
          lineSubtotal={
            lineDiscountItem
              ? lineDiscountItem.price * lineDiscountItem.quantity
              : 0
          }
          current={lineDiscountItem?.lineDiscount ?? null}
          onApply={applyLineDiscount}
        />
        <POSLineNoteDialog
          open={lineNoteItemId !== null}
          onOpenChange={(open) => {
            if (!open) closeLineNoteDialog();
          }}
          itemId={lineNoteItemId}
          itemName={
            lineNoteItem
              ? `${lineNoteItem.name}${
                  lineNoteItem.variantName
                    ? ` · ${lineNoteItem.variantName}`
                    : ""
                }`
              : ""
          }
          current={lineNoteItem?.lineNote ?? null}
          onSave={applyLineNote}
        />
        <POSSaleCompleteModal
          open={showSaleCompleteModal && !!completedOrder}
          onOpenChange={(open) => {
            if (!open) {
              setShowSaleCompleteModal(false);
              setCompletedOrder(null);
              setLastPaymentMethod(null);
            }
          }}
          orderNumber={completedOrder?.orderNumber ?? ""}
          total={completedOrder?.total ?? 0}
          itemCount={completedOrder?.itemCount}
          paymentMethod={lastPaymentMethod}
          // The counter the finished sale was rung up at, taken from the receipt
          // rather than from live settings: switching the register while this
          // modal is open must not relabel a sale that has already happened.
          locationName={lastReceipt?.locationName}
          fp={fp}
          onViewReceipt={() => {
            openInvoice("inline");
          }}
          onPrintReceipt={() => {
            printReceipt(lastReceipt);
          }}
          onNewSale={() => {
            setShowSaleCompleteModal(false);
            setCompletedOrder(null);
            setLastPaymentMethod(null);
            clearCart();
          }}
        />
        <POSHoldOrderDialog
          open={showHoldDialog}
          onOpenChange={setShowHoldDialog}
          // Persists the full sale so it can be resumed — previously the cart
          // was cleared and the in-progress order was lost. The sale is only
          // cleared once storage confirms it, or a failed write (private mode,
          // quota) would destroy it behind a success toast. Shared with the
          // counter switcher, which parks the sale before moving the register.
          onHold={holdCurrentSale}
          itemCount={totalItems}
        />
        <POSHeldOrdersDialog
          open={showHeldOrdersDialog}
          onOpenChange={setShowHeldOrdersDialog}
          heldOrders={heldOrders}
          formatPrice={fp}
          resumingId={resumingHeldId}
          onResume={resumeHeldOrder}
          onDelete={(id) => setHeldOrders(removeHeldOrder(id, holdScope))}
          locationName={settings.posLocationName}
        />
        <POSTakePaymentDialog
          isOffline={offline.isOffline}
          open={showTakePaymentDialog}
          onOpenChange={setShowTakePaymentDialog}
          total={total}
          itemCount={totalItems}
          discount={discount}
          onProcess={async (
            method,
            cashAmount,
            reference,
            _note,
            stripePaymentIntentId,
          ) => {
            const completed = await processPayment(
              method,
              cashAmount,
              reference,
              stripePaymentIntentId,
            );
            if (completed) setShowTakePaymentDialog(false);
          }}
          onCreateStripeIntent={createStripeIntent}
          isProcessing={isProcessing}
          settings={settings}
          fp={fp}
        />

        {/* LEFT PANEL - Products */}
        <div
          className={cn(
            "min-h-0 min-w-0 flex-1 flex-col lg:flex lg:flex-1",
            mobileTab === "products" ? "flex" : "hidden",
          )}
        >
          {/* Category Tabs */}
          {categories.length > 0 && (
            <div className="shrink-0 bg-card">
              <ScrollArea className="w-full">
                <div className="flex gap-1 px-3 pb-2.5 pt-2.5 sm:px-5 sm:pb-3 sm:pt-4">
                  <button
                    onClick={() => setSelectedCategory("")}
                    className={cn(
                      "shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200",
                      selectedCategory === ""
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                    )}
                  >
                    {t("pos.allProducts")}
                  </button>
                  {categories.map((cat) => (
                    <button
                      key={cat._id}
                      onClick={() =>
                        setSelectedCategory(
                          selectedCategory === cat._id ? "" : cat._id,
                        )
                      }
                      className={cn(
                        "shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200",
                        selectedCategory === cat._id
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                      )}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Product Grid */}
          <ScrollArea className="min-h-0 flex-1">
            {isLoading && products.length === 0 ? (
              <POSProductGridSkeleton />
            ) : products.length === 0 ? (
              <div className="flex min-h-64 flex-col items-center justify-center gap-3 px-8 py-12 text-center text-muted-foreground">
                <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center">
                  <Package className="w-8 h-8 opacity-40" />
                </div>
                {settings.posLocationName &&
                !searchQuery &&
                !selectedCategory ? (
                  // An empty grid at a counter is not the same as an empty
                  // catalogue, and `getPOSLocationStock` treats the two
                  // situations that produce it as opposites: a product with no
                  // per-location rows falls back to aggregate stock, one with
                  // rows but none here genuinely reads 0. Saying only "no
                  // products" leaves a merchant reading this as lost inventory.
                  <>
                    <p className="font-semibold text-foreground/80">
                      No stock recorded at {settings.posLocationName}
                    </p>
                    <p className="max-w-md text-sm leading-relaxed">
                      Products that count their units per location hold none
                      here. Ones that do not track stock by location still sell
                      from the shared pool — they are just not in this list.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-medium text-foreground/70">
                      {t("pos.noProducts")}
                    </p>
                    <p className="text-sm">{t("pos.noProductsHint")}</p>
                  </>
                )}
              </div>
            ) : (
              // A refetch dims the current results rather than swapping in a
              // skeleton, so switching category does not flash the grid away.
              <div
                className={cn(
                  "grid grid-cols-2 gap-3 p-3 transition-opacity sm:grid-cols-3 sm:gap-4 sm:p-5 md:grid-cols-4 xl:grid-cols-6",
                  isLoading && "pointer-events-none opacity-50",
                )}
              >
                {products.map((product) => {
                  const inCart = cart.find(
                    (item) => item.productId === product._id && !item.variantId,
                  );
                  const variantInCart = cart.filter(
                    (item) => item.productId === product._id && item.variantId,
                  );
                  const totalInCart = inCart
                    ? inCart.quantity
                    : variantInCart.reduce((s, i) => s + i.quantity, 0);
                  const hasVariants =
                    product.variants && product.variants.length > 0;
                  const totalStock = hasVariants
                    ? product.variants.reduce((s, v) => s + (v.stock || 0), 0)
                    : product.stock;
                  // A digital or untracked product reads 0 forever, so the raw
                  // count cannot decide sellability — or the card sits disabled
                  // and the merchant can never ring it up.
                  const stockIsALimit = !productAllowsOversell(product);
                  const isOutOfStock = stockIsALimit && totalStock <= 0;
                  const stockLabel =
                    totalStock > 0 && totalStock < 10
                      ? `0${totalStock}`
                      : String(totalStock);
                  const onSale =
                    !!product.comparePrice &&
                    product.comparePrice > product.price;

                  return (
                    <button
                      key={product._id}
                      onClick={() => handleProductClick(product)}
                      disabled={isOutOfStock}
                      className={cn(
                        "group relative flex flex-col text-left transition-all duration-200",
                        isOutOfStock
                          ? "cursor-not-allowed"
                          : "cursor-pointer active:scale-[0.98]",
                      )}
                    >
                      {/* Product Image */}
                      <div
                        className={cn(
                          "aspect-square rounded-2xl bg-muted relative overflow-hidden transition-all duration-200",
                          !isOutOfStock &&
                            "group-hover:shadow-md group-hover:ring-1 group-hover:ring-primary/20",
                        )}
                      >
                        {product.images?.[0] ? (
                          <AppImage
                            src={product.images[0]}
                            alt={product.name}
                            width={240}
                            height={240}
                            className={cn(
                              "w-full h-full object-cover transition-transform duration-300",
                              isOutOfStock
                                ? "opacity-60 grayscale"
                                : "group-hover:scale-105",
                            )}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Package className="w-8 h-8 text-muted-foreground/20" />
                          </div>
                        )}

                        {/* Top-left: Unavailable pill OR stock count pill */}
                        {isOutOfStock ? (
                          <div className="absolute top-2.5 left-2.5 px-2.5 py-1 rounded-full bg-rose-500 text-white text-[11px] font-semibold shadow-sm">
                            {t("pos.outOfStock")}
                          </div>
                        ) : stockIsALimit ? (
                          <div className="absolute top-2.5 left-2.5 min-w-7 h-6 px-2 rounded-full bg-background text-foreground text-[11px] font-semibold flex items-center justify-center shadow-sm">
                            {stockLabel}
                          </div>
                        ) : null}

                        {/* Top-right: Cart quantity badge */}
                        {totalInCart > 0 && (
                          <div className="absolute top-2.5 right-2.5 w-6 h-6 rounded-full bg-primary text-primary-foreground text-[11px] font-bold flex items-center justify-center shadow-md ring-2 ring-background">
                            {totalInCart}
                          </div>
                        )}
                      </div>

                      {/* Product Info */}
                      <div className="pt-3 px-1 space-y-1">
                        <h4
                          className={cn(
                            "text-sm font-semibold leading-snug line-clamp-1",
                            isOutOfStock
                              ? "text-muted-foreground"
                              : "text-foreground",
                          )}
                        >
                          {product.name}
                        </h4>
                        {/* Wraps rather than sitting on one nowrap line —
                            otherwise the pair widens the grid's min-content and
                            spills into the next column on narrow phones. */}
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span
                            className={cn(
                              "text-sm font-semibold tabular-nums",
                              onSale
                                ? "text-emerald-600 dark:text-emerald-500"
                                : isOutOfStock
                                  ? "text-muted-foreground"
                                  : "text-foreground",
                            )}
                          >
                            {fp(product.price)}
                          </span>
                          {onSale && (
                            <span className="text-xs text-muted-foreground/70 line-through tabular-nums">
                              {fp(product.comparePrice!)}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* RIGHT PANEL - Cart */}
        <div
          className={cn(
            // overflow-y-auto is the safety valve: on very short viewports
            // (landscape phones) the header + footer alone exceed the panel,
            // so the whole panel scrolls instead of clipping the checkout row.
            "min-h-0 w-full flex-1 flex-col overflow-x-hidden overflow-y-auto bg-card lg:flex lg:w-105 lg:flex-none lg:shrink-0 lg:border-l",
            mobileTab === "cart" ? "flex" : "hidden",
          )}
        >
          {/* Cart Header */}
          <div className="shrink-0 space-y-2.5 p-3 pb-2.5 sm:space-y-4 sm:p-5 sm:pb-4">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="hidden text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:block">
                  Order
                </p>
                <h2 className="font-semibold text-[15px] leading-tight">
                  {t("pos.currentSale")}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {totalItems}{" "}
                  {totalItems === 1
                    ? t.has("common.item")
                      ? t("common.item")
                      : "item"
                    : t.has("common.items")
                      ? t("common.items")
                      : "items"}
                </p>
              </div>
              {cart.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearCart}
                  className="text-xs text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 border-border/60 hover:border-rose-200 rounded-full h-8 px-3"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" />
                  {t("pos.clearCart")}
                </Button>
              )}
            </div>

            {/* Customer */}
            {customer ? (
              <div className="flex items-center gap-3 bg-primary/5 border border-primary/15 rounded-xl px-3.5 py-2 sm:py-3">
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <UserCheck className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">
                    {customer.name}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {customer.email}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 rounded-full hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setCustomer(null)}
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            ) : isWalkIn ? (
              <div className="flex items-center gap-3 bg-primary/5 dark:bg-primary/10 border border-primary/20 dark:border-primary/30 rounded-xl px-3.5 py-2 sm:py-3">
                <div className="w-9 h-9 rounded-full bg-primary/10 dark:bg-primary/20 flex items-center justify-center shrink-0">
                  <Footprints className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">
                    {t("pos.customer.walkIn")}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {t("pos.customer.walkInDesc")}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 rounded-full hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setIsWalkIn(false)}
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            ) : (
              <button
                onClick={openCustomerDialog}
                className="group relative w-full flex items-center gap-2.5 rounded-xl border border-dashed border-blue-300/60 dark:border-blue-800/50 bg-blue-50/40 dark:bg-blue-950/10 px-3.5 py-2 sm:py-2.5 text-left transition-all duration-200 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/20"
              >
                <div className="w-9 h-9 rounded-full border border-blue-200/70 dark:border-blue-800/50 flex items-center justify-center shrink-0">
                  <UserPlus className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-blue-700 dark:text-blue-300">
                    {t("pos.addCustomer")}
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    Earn loyalty, attach to order
                  </p>
                </div>
                <kbd className="rounded border border-blue-300/60 bg-blue-100/60 px-1.5 py-0.5 font-mono text-[10px] text-blue-700 dark:text-blue-300 shrink-0">
                  F2
                </kbd>
              </button>
            )}
          </div>

          {/* Cart Items */}
          <ScrollArea className="min-h-24 flex-1">
            {cart.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-8 py-12 text-muted-foreground">
                <div className="w-16 h-16 rounded-2xl bg-muted/30 flex items-center justify-center mb-4">
                  <Receipt className="w-8 h-8 opacity-20" />
                </div>
                <p className="text-sm font-medium text-foreground/40">
                  {t("pos.emptyCart")}
                </p>
                {/* Without this the register looks like the held sale simply
                    vanished — the relabelled button below is the only other cue. */}
                {heldOrders.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setShowHeldOrdersDialog(true)}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                  >
                    <Bookmark className="h-3.5 w-3.5" />
                    <span>
                      {heldOrders.length} held order
                      {heldOrders.length === 1 ? "" : "s"} · resume
                    </span>
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="space-y-4 px-3 pb-4 sm:px-5">
                {cart.map((item, index) => (
                  <div
                    key={item.id}
                    className="flex items-start gap-3 group animate-in fade-in slide-in-from-right-2 duration-300"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    {/* Image */}
                    {item.image ? (
                      <div className="w-12 h-12 rounded-lg overflow-hidden shrink-0 bg-muted">
                        <AppImage
                          src={item.image}
                          alt={item.name}
                          width={48}
                          height={48}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="w-12 h-12 rounded-lg shrink-0 bg-muted/50 flex items-center justify-center">
                        <Package className="w-5 h-5 text-muted-foreground/30" />
                      </div>
                    )}

                    {/* Middle: Name + details */}
                    <div className="flex-1 min-w-0">
                      {/* Name + SKU row */}
                      <div className="flex items-center gap-2 flex-wrap pr-1">
                        <p
                          className="line-clamp-1 text-sm font-semibold leading-tight"
                          title={item.name}
                        >
                          {truncateByWords(item.name, 5)}
                        </p>
                        {item.sku && (
                          // Long unbreakable SKUs would otherwise push the
                          // price and quantity controls off a narrow screen.
                          <span className="line-clamp-1 min-w-0 max-w-full text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                            {item.sku}
                          </span>
                        )}
                      </div>
                      {/* Variant pill */}
                      {item.variantName && (
                        <span className="inline-block mt-1.5 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-primary/10 text-primary dark:bg-primary/20">
                          {item.variantName}
                        </span>
                      )}
                      {/* Line discount indicator */}
                      {item.lineDiscount && (
                        <span className="ml-1.5 inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                          <Tag className="h-2.5 w-2.5" />
                          {item.lineDiscount.type === "percent"
                            ? `${item.lineDiscount.value}% off`
                            : `${fp(item.lineDiscount.value)} off`}
                        </span>
                      )}
                      {/* Line note indicator */}
                      {item.lineNote && (
                        <p
                          className="mt-1.5 text-[11px] italic text-muted-foreground line-clamp-2 pr-1"
                          title={item.lineNote}
                        >
                          “{item.lineNote}”
                        </p>
                      )}
                      {/* Each price (or discounted each price) */}
                      <p className="text-[11px] text-muted-foreground mt-1.5">
                        {item.lineDiscount ? (
                          <>
                            <span className="line-through">
                              {fp(item.price)}
                            </span>{" "}
                            {fp(
                              item.price -
                                getLineDiscountAmount(item) /
                                  Math.max(item.quantity, 1),
                            )}{" "}
                            each
                          </>
                        ) : (
                          <>{fp(item.price)} each</>
                        )}
                      </p>
                    </div>

                    {/* Right: Price, Qty, Actions */}
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <p className="text-sm font-bold tabular-nums leading-tight">
                        {item.lineDiscount
                          ? fp(
                              item.price * item.quantity -
                                getLineDiscountAmount(item),
                            )
                          : fp(item.price * item.quantity)}
                      </p>
                      <div className="flex items-center border border-border/60 rounded-full px-1 py-0.5 bg-background">
                        <button
                          onClick={() => updateQuantity(item.id, -1)}
                          className="w-5 h-5 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted disabled:opacity-30 transition-colors"
                          disabled={item.quantity <= 1}
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="text-xs font-semibold w-6 text-center tabular-nums">
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => updateQuantity(item.id, 1)}
                          className="w-5 h-5 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={() => openLineDiscountDialog(item.id)}
                          className={cn(
                            "p-1 rounded transition-colors",
                            item.lineDiscount
                              ? "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30"
                              : "text-muted-foreground/60 hover:text-foreground",
                          )}
                          aria-label="Add line discount"
                          title="Add line discount"
                        >
                          <Tag className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => openLineNoteDialog(item.id)}
                          className={cn(
                            "p-1 rounded transition-colors",
                            item.lineNote
                              ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30"
                              : "text-muted-foreground/60 hover:text-foreground",
                          )}
                          aria-label="Add line note"
                          title="Add line note"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => removeFromCart(item.id)}
                          aria-label={t("common.delete")}
                          className="text-muted-foreground/60 hover:text-destructive p-1 rounded transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          {/* Cart Footer */}
          <div className="shrink-0 space-y-2.5 border-t border-border/60 bg-card px-3 pb-3 pt-3 sm:space-y-3 sm:px-5 sm:pb-5">
            {/* Items count + subtotal (or discounted subtotal) */}
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {totalItems} {totalItems === 1 ? "item" : "items"} ·{" "}
                {cart.reduce((s, i) => s + i.quantity, 0)}{" "}
                {cart.reduce((s, i) => s + i.quantity, 0) === 1
                  ? "unit"
                  : "units"}
              </span>
              <span className="tabular-nums font-semibold">
                {lineDiscountTotal > 0 ? (
                  <>
                    <span className="text-muted-foreground line-through font-normal mr-1.5">
                      {fp(subtotal)}
                    </span>
                    {fp(discountedSubtotal)}
                  </>
                ) : (
                  fp(subtotal)
                )}
              </span>
            </div>

            {/* Line discount summary (only if any line has discount) */}
            {lineDiscountTotal > 0 ? (
              <div className="flex items-center justify-between text-sm text-emerald-600 dark:text-emerald-400">
                <span className="inline-flex items-center gap-1.5">
                  <Tag className="h-3.5 w-3.5" />
                  <span>
                    Line discounts · {cart.filter((i) => i.lineDiscount).length}{" "}
                    {cart.filter((i) => i.lineDiscount).length === 1
                      ? "item"
                      : "items"}
                  </span>
                </span>
                <span className="tabular-nums font-semibold">
                  −{fp(lineDiscountTotal)}
                </span>
              </div>
            ) : null}

            {/* Add discount link — redundant with the Discount button below on
                narrow screens, so it only shows there once one is applied. */}
            {cart.length > 0 ? (
              <div
                className={cn(
                  "items-center justify-between text-sm",
                  discount ? "flex" : "hidden lg:flex",
                )}
              >
                <button
                  type="button"
                  onClick={() => setShowDiscountDialog(true)}
                  className={cn(
                    "inline-flex items-center gap-1.5 text-sm font-medium transition-colors",
                    discount
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Tag className="h-3.5 w-3.5" />
                  <span>
                    {discount
                      ? `Discount · ${discount.type === "percent" ? `${discount.value}%` : fp(discount.value)}`
                      : "Add discount"}
                  </span>
                </button>
                <kbd className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  F3
                </kbd>
              </div>
            ) : null}

            {/* TOTAL DUE */}
            <div className="flex items-baseline justify-between border-t border-border/60 pt-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Total due
              </span>
              <span className="text-2xl font-bold tabular-nums tracking-tight">
                {fp(total)}
              </span>
            </div>

            {/* A greyed-out Checkout with no stated reason reads as a bug, and
                a `title` tooltip is not something a cashier at a counter will
                find. Holding the sale stays available on purpose — the way out
                of this state is to park it and move to a live counter. */}
            {saleBlockedReason ? (
              <p className="flex items-start gap-2 rounded-xl border border-amber-300/70 bg-amber-50 px-3 py-2 text-[13px] leading-relaxed text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{saleBlockedReason}</span>
              </p>
            ) : null}

            {/* Action buttons: Hold / Discount / Checkout.
                Narrow panels stack Checkout onto its own full-width row so it
                stays a comfortable touch target. */}
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
              <button
                type="button"
                disabled={cart.length === 0 && heldOrders.length === 0}
                onClick={() =>
                  cart.length > 0
                    ? setShowHoldDialog(true)
                    : setShowHeldOrdersDialog(true)
                }
                aria-label={
                  cart.length > 0
                    ? "Hold this order"
                    : `Resume held orders (${heldOrders.length})`
                }
                title={
                  cart.length > 0
                    ? "Park this sale so you can serve another customer (F4)"
                    : "Resume a parked sale (F4)"
                }
                className={cn(
                  "group relative flex h-11 items-center justify-center gap-1.5 rounded-xl border text-sm font-medium transition-all",
                  cart.length === 0 && heldOrders.length === 0
                    ? "cursor-not-allowed border-border/60 bg-card opacity-50"
                    : // Resuming is a different action from holding, so the
                      // button stops looking identical in the two states.
                      cart.length === 0
                      ? "border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/15 active:scale-[0.99] dark:text-amber-400"
                      : "border-border/60 bg-card hover:border-foreground/30 hover:bg-muted/40 active:scale-[0.99]",
                )}
              >
                <Bookmark className="h-4 w-4" />
                {/* "Resume", not "Held": the label has to name the way back,
                    since this button is the register's only route to a parked
                    sale. */}
                <span>{cart.length > 0 ? "Hold" : "Resume"}</span>
                {heldOrders.length > 0 ? (
                  <span
                    className={cn(
                      "ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white",
                      cart.length === 0 ? "bg-amber-500" : "bg-primary",
                    )}
                  >
                    {heldOrders.length}
                  </span>
                ) : null}
                <kbd className="absolute right-1.5 top-1 hidden rounded border border-border/60 bg-muted/40 px-1 font-mono text-[9px] text-muted-foreground sm:inline-block">
                  F4
                </kbd>
              </button>
              <button
                type="button"
                disabled={cart.length === 0}
                onClick={() => setShowDiscountDialog(true)}
                className={cn(
                  "group relative flex h-11 items-center justify-center gap-1.5 rounded-xl border border-border/60 bg-card text-sm font-medium transition-all",
                  cart.length > 0
                    ? discount
                      ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
                      : "hover:border-foreground/30 hover:bg-muted/40 active:scale-[0.99]"
                    : "cursor-not-allowed opacity-50",
                )}
              >
                <Tag className="h-4 w-4" />
                <span>Discount</span>
                <kbd className="absolute right-1.5 top-1 hidden rounded border border-border/60 bg-muted/40 px-1 font-mono text-[9px] text-muted-foreground sm:inline-block">
                  F3
                </kbd>
              </button>
              <button
                type="button"
                disabled={
                  cart.length === 0 || isProcessing || !!saleBlockedReason
                }
                title={saleBlockedReason ?? undefined}
                onClick={() => {
                  setCashTendered("");
                  setPaymentReference("");
                  setPaymentNote("");
                  setCompletedOrder(null);
                  setShowTakePaymentDialog(true);
                }}
                className={cn(
                  "group relative col-span-2 flex h-12 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold text-white transition-all lg:col-span-1 lg:h-11",
                  cart.length > 0 && !isProcessing && !saleBlockedReason
                    ? "bg-primary hover:bg-primary/90 active:scale-[0.99]"
                    : "cursor-not-allowed bg-muted text-muted-foreground",
                )}
              >
                <CreditCard className="h-4 w-4" />
                <span>Checkout</span>
                <kbd className="absolute right-1.5 top-1 hidden rounded border border-white/30 bg-white/15 px-1 font-mono text-[9px] sm:inline-block">
                  F9
                </kbd>
              </button>
            </div>
          </div>
        </div>

        {/* Mobile tab bar — a flex sibling (not fixed) so the panels above it
            keep a bounded height and scroll internally. */}
        <div className="shrink-0 border-t border-border/70 bg-background/95 px-2 pb-[max(env(safe-area-inset-bottom),0.25rem)] pt-1.5 backdrop-blur lg:hidden">
          <div className="mx-auto grid max-w-md grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMobileTab("products")}
              aria-pressed={mobileTab === "products"}
              className={cn(
                "relative flex h-11 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-medium transition-colors",
                mobileTab === "products"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Package className="h-5 w-5" />
              <span>Products</span>
            </button>
            <button
              type="button"
              onClick={() => setMobileTab("cart")}
              aria-pressed={mobileTab === "cart"}
              className={cn(
                "relative flex h-11 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-medium transition-colors",
                mobileTab === "cart"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="relative">
                <ShoppingCart className="h-5 w-5" />
                {totalItems > 0 ? (
                  <span className="absolute -right-2.5 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground">
                    {totalItems > 99 ? "99+" : totalItems}
                  </span>
                ) : heldOrders.length > 0 ? (
                  // An empty cart hides the register's only route back to a
                  // parked sale behind this tab, so flag that one is waiting.
                  <span className="absolute -right-2.5 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold leading-none text-white">
                    {heldOrders.length > 99 ? "99+" : heldOrders.length}
                  </span>
                ) : null}
              </span>
              <span>
                {cart.length > 0
                  ? fp(total)
                  : heldOrders.length > 0
                    ? "Held"
                    : "Cart"}
              </span>
            </button>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
