"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Pause, X } from "lucide-react";
import { POSTerminal, type POSMobileTab } from "@/components/pos/pos-terminal";
import { POSSearchBar } from "@/components/pos/pos-search-bar";
import { POSOfflineBanner } from "@/components/pos/pos-offline-banner";
import { POSOfflineLocked } from "@/components/pos/pos-offline-locked";
import { POSLocationBadge } from "@/components/pos/pos-location-badge";
import { POSLocationPicker } from "@/components/pos/pos-location-picker";
import { POSLocationSwitchDialog } from "@/components/pos/pos-location-switch-dialog";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast-notification";
import { playPOSSound, configurePOSSounds } from "@/lib/pos/pos-sounds";
import { cleanScannedCode } from "@/lib/catalog/barcodes";
import { getPOSPurchasableQuantity } from "@/lib/pos/product-stock";
import { resolvePOSBarcodeMatch } from "@/lib/pos/barcode-lookup";
import { usePOSOffline, type POSOfflineState } from "@/hooks/use-pos-offline";
import { getHeldOrders, heldOrdersScope } from "@/lib/pos/held-orders";
import {
  describeHeldOrderAdjustments,
  revalidateHeldCart,
  type HeldOrderRevalidation,
} from "@/lib/pos/revalidate-held-order";
import {
  pushRecentLocation,
  readRecentLocations,
  readRegisterLocation,
  writeRegisterLocation,
} from "@/lib/pos/register-location";
import type { POSSettings } from "@/lib/pos/build-pos-settings";
import type { POSLocationOption } from "@/lib/pos/list-locations";
import type { POSProductListResult } from "@/lib/pos/list-products";
import type {
  POSProduct,
  POSVariant,
  POSCartItem,
  POSCategory,
} from "@/components/pos/pos-types";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";
import { useHydrated } from "@/hooks/use-client-value";

type POSStockStatusFilter = "all" | "in_stock" | "out_of_stock";
type POSScanSource = "hardware" | "camera";
type POSScanQueueItem = { code: string; source: POSScanSource };
type POSScanFeedback = {
  status: "success" | "error";
  code: string;
  message: string;
  detail?: string;
};
type POSBarcodeApiResponse = {
  success?: boolean;
  code?: string;
  message?: string;
  data?: {
    status?: "matched";
    match?: {
      field: "barcode" | "sku";
      scope: "product" | "variant";
      product: POSProduct;
      variant?: POSVariant;
    };
  };
};

interface POSWorkspaceProps {
  settings: POSSettings;
  /**
   * Every counter this cashier may stand at, as the server render saw it. Held
   * in state from here on, because a register is left open for hours and the
   * list can change under it — see the refresh effect below.
   */
  locations: POSLocationOption[];
  cashierName: string | null;
  initialData: POSProductListResult;
}

export function POSWorkspace({
  settings,
  locations: initialLocations,
  cashierName,
  initialData,
}: POSWorkspaceProps) {
  const t = useTranslations();

  // Search state (lifted from POSTerminal)
  const [searchQuery, setSearchQuery] = React.useState("");
  const [scanQuery, setScanQuery] = React.useState("");
  const [stockStatus, setStockStatus] =
    React.useState<POSStockStatusFilter>("all");
  // Scan state
  const [isScanResolving, setIsScanResolving] = React.useState(false);
  const [showCameraScanner, setShowCameraScanner] = React.useState(false);
  const [scanQueueLength, setScanQueueLength] = React.useState(0);
  const [lastScanFeedback, setLastScanFeedback] =
    React.useState<POSScanFeedback | null>(null);

  // Refs
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const scanInputRef = React.useRef<HTMLInputElement>(null);
  const scanQueueRef = React.useRef<POSScanQueueItem[]>([]);
  const isScanResolvingRef = React.useRef(false);

  // Which panel the phone/tablet layout shows. Lifted out of POSTerminal so
  // the search/scan bar can step aside while the cart is on screen.
  const [mobileTab, setMobileTab] = React.useState<POSMobileTab>("products");

  // Cart state (passed to POSTerminal)
  const [cart, setCart] = React.useState<POSCartItem[]>([]);
  // Seeded from the server render, so the terminal mounts with a populated grid
  // and only refetches once a filter or the search box actually changes.
  const [products, setProducts] = React.useState<POSProduct[]>(
    initialData.products,
  );
  const [categories, setCategories] = React.useState<POSCategory[]>(
    initialData.categories,
  );

  // ==========================================================================
  // Which counter this register is standing at
  //
  // The location is client state, not a server constant: a register is a
  // physical machine and two tills in one shop must be able to sell from two
  // counters. The server still decides what the id is ALLOWED to be — every
  // request carrying it goes back through `resolvePOSLocationId` — so this
  // holds a preference, never an authority.
  // ==========================================================================
  const [locations, setLocations] =
    React.useState<POSLocationOption[]>(initialLocations);
  const [locationId, setLocationId] = React.useState(
    settings.posLocationId ?? "",
  );
  // The snapshot and the outbox are scoped to the counter the register is
  // standing at, not to the id the server rendered with: switching counters
  // has to re-pull that counter's stock and park its queued sales separately.
  const offline = usePOSOffline({
    locationId,
    initialProducts: initialData.products,
  });

  const [needsCounterPick, setNeedsCounterPick] = React.useState(false);
  /**
   * False until the machine's stored counter has been read.
   *
   * Both the badge and the picker stay off screen until then. Rendering the
   * badge first showed the SERVER's answer — usually "Shared stock" — for the
   * frame before the browser's own could be applied, which is a register
   * telling a cashier the wrong thing about where their stock is coming from.
   */
  const [hasBooted, setHasBooted] = React.useState(false);
  const [isSaleBusy, setIsSaleBusy] = React.useState(false);
  const [heldCounts, setHeldCounts] = React.useState<Record<string, number>>(
    {},
  );
  /** Bumped on every deliberate counter change, to pulse the badge once. */
  const [flashToken, setFlashToken] = React.useState(0);
  /**
   * A counter just left behind with sales still parked at it.
   *
   * Held orders are keyed by location, so walking away from a counter makes its
   * parked sales vanish from the screen — correct, and indistinguishable from
   * having lost them. The toast that announces the move is gone in seconds,
   * which is not long enough for work somebody has to come back to.
   */
  const [leftBehind, setLeftBehind] = React.useState<{
    id: string;
    name: string;
    count: number;
  } | null>(null);
  /**
   * Counters this machine has sold from, newest first.
   *
   * Read once at boot and kept in step on every commit, rather than read where
   * the picker renders: `localStorage` is unreachable during the server render,
   * and reading it inside the picker would make that component's first paint
   * differ between server and client.
   */
  const [recentLocationIds, setRecentLocationIds] = React.useState<string[]>(
    [],
  );

  // `localStorage` is unreachable during the server render, so the machine's own
  // counter can only be applied once hydrated. Keyed on that alone — not on
  // `locations` — so a later refresh of that list never overrides a choice the
  // cashier has since made.
  const hydrated = useHydrated();
  useApplyOnChange([hydrated], () => {
    if (!hydrated) return;
    setHasBooted(true);
    setRecentLocationIds(readRecentLocations());

    const stored = readRegisterLocation();

    // Never asked on this machine. With a real choice to make, ask before the
    // first sale rather than guessing and being wrong all shift.
    if (stored === null) {
      if (locations.length > 1) setNeedsCounterPick(true);
      return;
    }

    // An empty string is a real answer — "sell from shared stock" — and must not
    // be confused with never having been asked.
    if (stored === "") {
      setLocationId("");
      return;
    }

    if (locations.some((location) => location.id === stored)) {
      setLocationId(stored);
      return;
    }

    // The remembered counter is gone: deactivated, or this cashier is no longer
    // assigned to it. Ask again rather than silently landing somewhere else.
    if (locations.length > 1) {
      setNeedsCounterPick(true);
    } else {
      setLocationId(locations[0]?.id ?? "");
    }
  });

  /**
   * Re-ask which counters exist when the cashier comes back to the tab.
   *
   * A register is left open for a whole shift, so the list the page rendered
   * with goes stale: an admin closes a branch, or takes a counter off the till,
   * and nothing reaches the terminal. Without this the register would keep
   * decrementing a closed branch until somebody happened to reload.
   *
   * Focus rather than an interval — the moment a cashier looks at the screen is
   * the moment the answer has to be right, and polling a register that is
   * sitting idle all afternoon buys nothing.
   */
  React.useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const res = await fetch("/api/pos/locations");
        const json = await res.json();
        if (
          !cancelled &&
          json?.success &&
          Array.isArray(json.data?.locations)
        ) {
          setLocations(json.data.locations);
        }
      } catch {
        // Offline, or mid-deploy. The list the page rendered with still stands;
        // guessing that every counter vanished would be far worse.
      }
    };

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  const commitLocation = React.useCallback(
    (nextId: string) => {
      // Read the counter being LEFT before the move, and read its holds from
      // storage rather than from `heldCounts` — a sale parked by the switch
      // itself lands a moment before this runs and the memoised count would
      // still be one behind.
      const previous =
        locations.find((location) => location.id === locationId) ?? null;
      const parkedBehind =
        previous && previous.id !== nextId
          ? getHeldOrders(heldOrdersScope(previous.id)).length
          : 0;

      setLocationId(nextId);
      writeRegisterLocation(nextId);
      // History, not the active choice — see `pushRecentLocation`. Shared stock
      // records nothing, so the last real counter stays the one offered back.
      pushRecentLocation(nextId);
      setRecentLocationIds(readRecentLocations());
      setNeedsCounterPick(false);
      setFlashToken((token) => token + 1);
      setLeftBehind(
        previous && parkedBehind > 0
          ? { id: previous.id, name: previous.name, count: parkedBehind }
          : null,
      );

      const name = locations.find((location) => location.id === nextId)?.name;
      toast.success(
        name ? `Now selling from ${name}` : "Now selling from shared stock",
      );
    },
    [locationId, locations],
  );

  // Drop the reminder once those sales are gone — resumed from the other
  // counter, or deleted. A chip pointing at an empty counter is worse than none.
  //
  // `heldCounts` is the trigger but NOT the source: it is recomputed by another
  // effect, so on the render right after a hold-and-switch it still holds the
  // count from before the sale was parked — and reading it here cleared the chip
  // the instant it appeared. Storage is already correct by then, so ask it.
  useApplyOnChange([heldCounts, leftBehind], () => {
    if (!leftBehind) return;
    if (getHeldOrders(heldOrdersScope(leftBehind.id)).length === 0) {
      setLeftBehind(null);
    }
  });

  // Held sales are keyed by counter, so the ones parked elsewhere are invisible
  // from here. Counting them is what lets the picker say so before a cashier
  // walks away from work they have forgotten about.
  // Recounted when the cart or counter changes: a hold parks the cart, so
  // those are the moments the storage-backed counts can move.
  useApplyOnChange([cart.length, locationId, locations], () => {
    const counts: Record<string, number> = {};
    for (const location of locations) {
      counts[location.id] = getHeldOrders(heldOrdersScope(location.id)).length;
    }
    setHeldCounts(counts);
  });

  // The terminal owns the customer, note and discount a hold has to carry, so it
  // hands its "park the sale" action up here rather than lifting all of that.
  const holdSaleRef = React.useRef<((label: string) => boolean) | null>(null);
  const registerHoldSale = React.useCallback(
    (hold: ((label: string) => boolean) | null) => {
      holdSaleRef.current = hold;
    },
    [],
  );

  // ---------------------------------------------------------- switching guard
  const [switchTarget, setSwitchTarget] =
    React.useState<POSLocationOption | null>(null);
  const [probe, setProbe] = React.useState<HeldOrderRevalidation | null>(null);
  const [isProbing, setIsProbing] = React.useState(false);

  const closeSwitchDialog = React.useCallback(() => {
    setSwitchTarget(null);
    setProbe(null);
  }, []);

  /**
   * Move the register, or ask first.
   *
   * An empty counter switches immediately — there is nothing to lose and a
   * dialog over an empty cart is pure friction. With a sale open, the new
   * counter's stock has to be read BEFORE the dialog can say anything useful:
   * the loaded grid is scoped to the counter being left, so it cannot answer
   * "will this line survive". That probe is the same one a resumed held sale
   * runs, against the same endpoint.
   */
  const requestLocationSwitch = React.useCallback(
    async (nextId: string) => {
      if (nextId === locationId) return;

      const target =
        locations.find((location) => location.id === nextId) ?? null;
      if (!target) return;

      // The offline outbox is scoped to the counter that took the sale, so
      // moving with money still queued takes it off this screen — the queue is
      // intact, but a cashier has no way to tell that from having lost it.
      // Sync first; the move is worth less than the reassurance.
      if (offline.queued.length > 0) {
        toast.error(
          "Sales taken at this counter have not reached the server yet. Sync them before moving the register.",
        );
        return;
      }

      if (cart.length === 0) {
        commitLocation(nextId);
        return;
      }

      setSwitchTarget(target);
      setProbe(null);
      setIsProbing(true);

      try {
        const ids = Array.from(new Set(cart.map((item) => item.productId)));
        const params = new URLSearchParams({ ids: ids.join(",") });
        if (nextId) params.set("locationId", nextId);

        const res = await fetch(`/api/pos/products?${params.toString()}`);
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.message || "Lookup failed");
        }

        setProbe(revalidateHeldCart(cart, json.data.products ?? []));
      } catch {
        // The register has not moved and the cart is untouched, so the cashier
        // can simply try again.
        toast.error(
          "Could not check stock at that counter. The register has not moved.",
        );
        closeSwitchDialog();
      } finally {
        setIsProbing(false);
      }
    },
    [
      cart,
      closeSwitchDialog,
      commitLocation,
      locationId,
      locations,
      offline.queued.length,
    ],
  );

  const handleHoldAndSwitch = React.useCallback(() => {
    if (!switchTarget) return;

    const hold = holdSaleRef.current;
    if (!hold) {
      toast.error("The sale could not be held. The register has not moved.");
      return;
    }

    // Runs BEFORE the location moves, so the sale is parked under the counter
    // it belongs to and is waiting there when the cashier comes back. Synchronous
    // — `saveHeldOrder` writes to `localStorage`, so there is nothing to wait on.
    //
    // Labelled, because the held list is read later out of context: "Untitled
    // hold" gives a cashier nothing, while the counter it was heading to says
    // why the sale stopped.
    const parked = hold(`Counter change → ${switchTarget.name}`);
    // Storage refused the write. The cart is still on the counter, so moving the
    // register now would strand it against another branch's stock.
    if (!parked) return;

    commitLocation(switchTarget.id);
    closeSwitchDialog();
  }, [closeSwitchDialog, commitLocation, switchTarget]);

  const handleSwitchAndRecheck = React.useCallback(() => {
    if (!switchTarget || !probe) return;

    setCart(probe.cart);
    commitLocation(switchTarget.id);
    if (probe.adjustments.length > 0) {
      toast.warning(
        `Sale re-checked · ${describeHeldOrderAdjustments(probe.adjustments)}`,
      );
    }
    closeSwitchDialog();
  }, [closeSwitchDialog, commitLocation, probe, switchTarget]);

  // What the terminal and every request it makes agree the counter is. Derived
  // rather than stored so there is exactly one location in play at any moment —
  // the product fetch, the barcode lookup and the held-order scope all key off
  // this field and would otherwise be able to drift apart.
  const activeSettings = React.useMemo<POSSettings>(
    () => ({
      ...settings,
      posLocationId: locationId,
      posLocationName: locations.find((location) => location.id === locationId)
        ?.name,
    }),
    [locationId, locations, settings],
  );

  const currentLocation =
    locations.find((location) => location.id === locationId) ?? null;

  /**
   * The counter went away under the cashier — deactivated, taken off the till,
   * or unassigned from this account since the page loaded.
   */
  const counterUnavailable = Boolean(locationId) && !currentLocation;

  // An empty counter can simply be asked again. One with a sale on it must not
  // be ejected mid-transaction, so the badge warns (amber) and the next payment
  // is what gets blocked — the line already rung up is still the cashier's to
  // finish or void.
  useApplyOnChange([cart.length, counterUnavailable, locations.length], () => {
    if (counterUnavailable && cart.length === 0 && locations.length > 0) {
      setNeedsCounterPick(true);
    }
  });

  const saleBlockedReason =
    counterUnavailable && cart.length > 0
      ? "This counter is no longer available. Pick another before taking payment."
      : null;

  // A store with no locations gets no badge at all: a control for a feature the
  // merchant has not set up is noise, and the register behaves exactly as it did
  // before locations existed.
  const showCounterBadge =
    hasBooted && locations.length > 0 && !needsCounterPick;
  const badgeProps = {
    locations,
    locationId,
    onSelect: requestLocationSwitch,
    heldCounts,
    locked: isSaleBusy,
    flashToken,
  };

  // Configure POS sounds
  React.useEffect(() => {
    if (settings.sound) {
      configurePOSSounds(settings.sound);
    }
  }, [settings.sound]);

  // Add to cart (used by scan logic)
  const addToCart = React.useCallback(
    (product: POSProduct, variant?: POSVariant) => {
      const itemId = variant ? `${product._id}-${variant._id}` : product._id;
      const price = variant ? variant.price : product.price;
      // Not `variant.stock`/`product.stock` directly: a digital product or one
      // with "track quantity" off sits at 0 by design and would be permanently
      // unsellable at the counter.
      const maxStock = getPOSPurchasableQuantity(
        product,
        variant ? variant.stock : product.stock,
      );
      const image = variant?.image || product.images?.[0];

      let added = false;
      setCart((prev) => {
        const existing = prev.find((item) => item.id === itemId);
        if (existing) {
          if (existing.quantity >= maxStock) {
            toast.error(t("pos.outOfStock"));
            playPOSSound("error");
            return prev;
          }
          added = true;
          return prev.map((item) =>
            item.id === itemId
              ? { ...item, quantity: item.quantity + 1 }
              : item,
          );
        }
        if (maxStock <= 0) {
          toast.error(t("pos.outOfStock"));
          playPOSSound("error");
          return prev;
        }
        added = true;
        return [
          ...prev,
          {
            id: itemId,
            productId: product._id,
            variantId: variant?._id,
            name: product.name,
            variantName: variant?.name,
            sku: variant?.sku || product.sku,
            price,
            quantity: 1,
            image,
            vendorId: product.vendorId,
            maxStock,
          },
        ];
      });
      if (added) playPOSSound("addToCart");
    },
    [t],
  );

  // Scan logic
  const resolveSingleScan = React.useCallback(
    async ({ code }: POSScanQueueItem) => {
      const params = new URLSearchParams({ code });
      if (locationId) {
        params.set("locationId", locationId);
      }

      try {
        const res = await fetch(`/api/pos/barcode?${params.toString()}`);
        const json = (await res.json()) as POSBarcodeApiResponse;
        const match = json.data?.match;

        if (!res.ok || !json.success || !match?.product) {
          const message =
            json.code === "MULTIPLE_MATCHES"
              ? "Multiple products match this code. Please fix duplicate SKU or barcode values."
              : json.code === "OUT_OF_STOCK"
                ? t("pos.outOfStock")
                : json.code === "NO_MATCH"
                  ? "No product found for the scanned code."
                  : json.message || "Unable to look up the scanned code.";

          playPOSSound("error");
          toast.error(message);
          setLastScanFeedback({
            status: "error",
            code,
            message,
            detail: json.code,
          });
          return;
        }

        addToCart(match.product, match.variant);
        const itemName = match.variant?.name
          ? `${match.product.name} - ${match.variant.name}`
          : match.product.name;
        setLastScanFeedback({
          status: "success",
          code,
          message: itemName,
          detail: match.field.toUpperCase(),
        });
        setScanQuery("");
        scanInputRef.current?.focus();
      } catch {
        // The request never reached the server. Resolve the scan against the
        // catalogue snapshot instead — the same matcher the route runs, so a
        // code resolves to the same product with or without a connection.
        const local = resolvePOSBarcodeMatch(offline.offlineProducts, code);

        if (local.status === "matched") {
          addToCart(local.match.product, local.match.variant);
          const itemName = local.match.variant?.name
            ? `${local.match.product.name} - ${local.match.variant.name}`
            : local.match.product.name;
          setLastScanFeedback({
            status: "success",
            code,
            message: itemName,
            // Flagged so the cashier knows this line was priced from a snapshot
            // rather than from live stock.
            detail: "OFFLINE",
          });
          setScanQuery("");
          scanInputRef.current?.focus();
          return;
        }

        const message =
          local.status === "multiple"
            ? "Multiple products match this code. Please fix duplicate SKU or barcode values."
            : "No product found for the scanned code.";
        playPOSSound("error");
        toast.error(message);
        setLastScanFeedback({
          status: "error",
          code,
          message,
          detail:
            local.status === "multiple"
              ? "MULTIPLE_MATCHES"
              : "OFFLINE_NO_MATCH",
        });
      }
    },
    [addToCart, locationId, offline.offlineProducts, t],
  );

  const processScanQueue = React.useCallback(async () => {
    if (isScanResolvingRef.current) return;

    const nextScan = scanQueueRef.current.shift();
    setScanQueueLength(scanQueueRef.current.length);
    if (!nextScan) return;

    isScanResolvingRef.current = true;
    setIsScanResolving(true);
    try {
      await resolveSingleScan(nextScan);
    } finally {
      isScanResolvingRef.current = false;
      setIsScanResolving(false);
      if (scanQueueRef.current.length > 0) {
        window.setTimeout(() => void processScanQueue(), 0);
      }
    }
  }, [resolveSingleScan]);

  const enqueueScannedCode = React.useCallback(
    (rawCode: string, source: POSScanSource = "hardware") => {
      const code = cleanScannedCode(rawCode);
      if (!code) return;

      scanQueueRef.current = [
        ...scanQueueRef.current.slice(-4),
        { code, source },
      ];
      setScanQueueLength(scanQueueRef.current.length);
      void processScanQueue();
    },
    [processScanQueue],
  );

  const handleScanKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      enqueueScannedCode(event.currentTarget.value, "hardware");
      setScanQuery("");
    },
    [enqueueScannedCode],
  );

  // Stable identity matters: the camera dialog keys its start effect on this
  // handler, so an inline arrow would restart the camera on every render of
  // this component — including the ones a scan itself triggers.
  const handleCameraScan = React.useCallback(
    (code: string) => enqueueScannedCode(code, "camera"),
    [enqueueScannedCode],
  );

  return (
    // Fills exactly the viewport left under the dashboard header (4rem for
    // admin/staff, 5rem for vendor) so the terminal never grows the page and
    // its panels can scroll internally. `relative` anchors the shift-start
    // picker, which covers the terminal rather than replacing it — the grid
    // behind it is already correct for whichever counter is confirmed.
    <div className="relative -mx-6 -my-6 flex h-[calc(100dvh-var(--dashboard-header-height,4rem))] flex-col overflow-hidden bg-muted/40 p-2 sm:p-3">
      {/* A locked register replaces the terminal outright, counter controls
          included: there is nothing to pick a counter for until it can sign in
          again. */}
      {offline.isLocked ? (
        <POSOfflineLocked
          session={offline.session}
          queuedCount={offline.queued.length}
        />
      ) : (
        <>
          {/* The cashier has to know which mode they are selling in *before* they
          ring anything up: an offline sale prints a provisional receipt number
          and its stock figures come from a snapshot. */}
          <POSOfflineBanner
            isOffline={offline.isOffline}
            snapshotAt={offline.snapshotAt}
            queued={offline.queued}
            isSyncing={offline.isSyncing}
            onSync={() => void offline.sync()}
          />
          {/* Search bar - outside the products card */}
          <POSSearchBar
            className={cn(mobileTab === "cart" && "hidden lg:block")}
            leading={
              showCounterBadge ? (
                <>
                  {/* Below `lg` the name is traded for a three-letter code so the
                  search field keeps its width. Two instances rather than one
                  CSS-swapped label: the compact form also changes the tracking
                  and the popover alignment. */}
                  <POSLocationBadge
                    {...badgeProps}
                    compact
                    className="lg:hidden"
                  />
                  <POSLocationBadge
                    {...badgeProps}
                    className="hidden lg:block"
                  />
                </>
              ) : null
            }
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchInputRef={searchInputRef}
            scanQuery={scanQuery}
            onScanQueryChange={setScanQuery}
            onScanKeyDown={handleScanKeyDown}
            scanInputRef={scanInputRef}
            isScanResolving={isScanResolving}
            scanQueueLength={scanQueueLength}
            lastScanFeedback={lastScanFeedback}
            onOpenCameraScanner={() => setShowCameraScanner(true)}
            showCameraScanner={showCameraScanner}
            onCameraOpenChange={setShowCameraScanner}
            onCameraScan={handleCameraScan}
            stockStatus={stockStatus}
            onStockStatusChange={setStockStatus}
          />

          {/* The cart tab hides the search bar, and the badge with it — on exactly
          the screen where the money is taken. Below `lg` the counter says where
          it is here instead. */}
          {showCounterBadge && mobileTab === "cart" ? (
            <POSLocationBadge {...badgeProps} stretch className="lg:hidden" />
          ) : null}

          {/* Sales left parked at the counter the register just moved off. They are
          not lost, but they are invisible from here, so the reminder stays on
          screen until they are dealt with — a toast is gone in seconds and this
          is work somebody has to come back to. */}
          {leftBehind ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-amber-300/70 bg-amber-50 px-3 py-2 text-[13px] text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
              <span className="flex min-w-0 items-center gap-2">
                <Pause className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0">
                  <span className="font-semibold">
                    {leftBehind.count}{" "}
                    {leftBehind.count === 1 ? "sale" : "sales"}
                  </span>{" "}
                  still held at {leftBehind.name}
                </span>
              </span>
              <button
                type="button"
                onClick={() => requestLocationSwitch(leftBehind.id)}
                className="cursor-pointer rounded-lg border border-amber-300 bg-white/70 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-white dark:border-amber-900/60 dark:bg-amber-950/40 dark:hover:bg-amber-950/70"
              >
                Go back to {leftBehind.name}
              </button>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => setLeftBehind(null)}
                className="ml-auto cursor-pointer rounded-full p-1 transition-colors hover:bg-amber-100 dark:hover:bg-amber-950/60"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}

          {/* Products card - flex fills remaining height, no forced height */}
          <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/50 bg-card shadow-sm sm:mt-3">
            <POSTerminalControlled
              settings={activeSettings}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              stockStatus={stockStatus}
              setStockStatus={setStockStatus}
              cart={cart}
              setCart={setCart}
              products={products}
              setProducts={setProducts}
              categories={categories}
              setCategories={setCategories}
              mobileTab={mobileTab}
              setMobileTab={setMobileTab}
              addToCart={addToCart}
              offline={offline}
              registerHoldSale={registerHoldSale}
              onSaleBusyChange={setIsSaleBusy}
              saleBlockedReason={saleBlockedReason}
            />
          </div>

          <POSLocationSwitchDialog
            open={Boolean(switchTarget)}
            from={currentLocation}
            to={switchTarget}
            adjustments={probe?.adjustments ?? []}
            keptLines={probe?.cart.length ?? cart.length}
            totalLines={cart.length}
            totalUnits={cart.reduce((sum, item) => sum + item.quantity, 0)}
            heldAtCurrent={heldCounts[locationId] ?? 0}
            isProbing={isProbing}
            onHoldAndSwitch={handleHoldAndSwitch}
            onSwitchAndRecheck={handleSwitchAndRecheck}
            onCancel={closeSwitchDialog}
          />

          {needsCounterPick ? (
            <POSLocationPicker
              locations={locations}
              recentLocationIds={recentLocationIds}
              preselectedLocationId={locationId || undefined}
              onConfirm={commitLocation}
              cashierName={cashierName}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

// Wrapper that passes controlled state to POSTerminal
interface POSTerminalControlledProps {
  settings: POSSettings;
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
  offline: POSOfflineState;
  registerHoldSale: (hold: ((label: string) => boolean) | null) => void;
  onSaleBusyChange: (busy: boolean) => void;
  saleBlockedReason: string | null;
}

function POSTerminalControlled({
  settings,
  searchQuery,
  setSearchQuery,
  stockStatus,
  setStockStatus,
  cart,
  setCart,
  products,
  setProducts,
  categories,
  setCategories,
  mobileTab,
  setMobileTab,
  addToCart: externalAddToCart,
  offline,
  registerHoldSale,
  onSaleBusyChange,
  saleBlockedReason,
}: POSTerminalControlledProps) {
  return (
    <POSTerminal
      settings={settings}
      offline={offline}
      controlledState={{
        searchQuery,
        setSearchQuery,
        stockStatus,
        setStockStatus,
        cart,
        setCart,
        products,
        setProducts,
        categories,
        setCategories,
        mobileTab,
        setMobileTab,
        addToCart: externalAddToCart,
        registerHoldSale,
        onSaleBusyChange,
        saleBlockedReason,
      }}
    />
  );
}
