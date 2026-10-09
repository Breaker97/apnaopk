"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/hooks/use-locale-navigation";
import type { DateRange } from "react-day-picker";
import { Clock, Loader2 } from "lucide-react";
import { toast } from "@/components/ui/toast-notification";
import {
  BookingDialogFrame,
  BookingFooter,
  BookingProductStep,
  BookingSlotStep,
  BookingStepper,
  BookingSummary,
  formatBookingRange,
  formatBookingRuns,
  selectionFromRange,
  type BookingStepItem,
} from "@/components/boosts/boost-booking-dialog";
import { ApiClientError, apiClient } from "@/lib/api/client";
import { useCurrencyFormatter } from "@/providers/currency-provider";
import { openRazorpayCheckout } from "@/components/checkout/checkout-helpers";
import {
  PaymentMethodPicker,
  platformPaymentErrorMessage,
  type PlatformGateway,
} from "@/components/vendor/payment-method-picker";
import { addDays, enumerateDays } from "@/lib/boosts/boost-days";
import {
  clashingDays,
  fromVendorAvailability,
  type BookingRung,
  type BookingSurface,
  type VendorAvailabilityPayload,
} from "@/lib/boosts/boost-booking";
import { quantizeToCurrency } from "@/lib/intl/money";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { useGatewayWindow } from "@/hooks/use-gateway-window";

interface BoostablePicker {
  _id: string;
  name: string;
  image?: string | null;
}

interface LadderRung {
  position: number;
  label: string;
  description: string;
  pricePerDay: number;
  /** Priced in a currency the store no longer uses — checkout will refuse it. */
  stale: boolean;
  reach: Record<BookingSurface, boolean>;
  avgImpressionsPerDay: number | null;
}

interface CatalogPayload {
  currency: string;
  paymentMethods: PlatformGateway[];
  positions: LadderRung[];
  placementDepth: Record<BookingSurface, number>;
  placementsEnabled: Record<BookingSurface, boolean>;
  bookingHorizonDays: number;
  maxBookingDays: number;
  holdMinutes: number;
  bookingCountByProduct: Record<string, number>;
}

type AvailabilityPayload = VendorAvailabilityPayload & { from: string; to: string };

type Step = "product" | "slot" | "payment";

interface CheckoutResponse {
  paymentId: string;
  campaignId: string;
  provider: PlatformGateway;
  type: "redirect" | "razorpay" | "polling";
  url?: string;
  keyId?: string;
  razorpayOrderId?: string;
  amount?: number;
  currency?: string;
  name?: string;
  description?: string;
  prefill?: { email?: string; name?: string; contact?: string };
  callbackUrl?: string;
}

const POLL_INTERVAL_MS = 4000;
const POLL_MAX_ATTEMPTS = 45;
/** Refetch availability on focus only after the payload has had time to rot. */
const REFETCH_AFTER_IDLE_MS = 60_000;
const PRODUCT_PAGE_SIZE = 8;

/**
 * The vendor's boost purchase flow: pick product → pick a ladder rung and a
 * date range → pick payment → gateway hand-off. Redirect gateways leave the
 * page and return to /vendor/boosts?boost_payment=… — Razorpay too, from its own
 * window, carrying the signed payment; ioTec mobile money stays on a "check
 * your phone" polling state.
 *
 * The screens are the admin's offline booking dialog's own
 * (components/boosts/boost-booking-dialog.tsx); only loading and paying differ.
 *
 * What the vendor buys is a VISUAL SLOT for a set of UTC days, not an
 * impression budget. Three things follow, and all three are visible in the UI
 * rather than buried in terms: the slot does not move up when a rung above it
 * is unsold, a rung shallower than a placement's depth simply does not render
 * there, and days already run are never refundable.
 */
export function BoostPurchaseDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: string;
  preselectedProduct?: BoostablePicker | null;
}) {
  const t = useTranslations();
  const router = useRouter();
  const locale = useLocale();
  // `t()` runs the ICU formatter, which throws when a placeholder has no
  // value, so interpolation values are handed to `t()` itself; the fallback
  // gets the same substitution by hand.
  const label = useFallbackTranslator(t);

  const [step, setStep] = useState<Step>("product");
  const [productSearch, setProductSearch] = useState("");
  const [products, setProducts] = useState<BoostablePicker[]>([]);
  const [productTotal, setProductTotal] = useState(0);
  const [productsLoading, setProductsLoading] = useState(false);
  const [product, setProduct] = useState<BoostablePicker | null>(null);
  const [catalog, setCatalog] = useState<CatalogPayload | null>(null);
  const [availability, setAvailability] = useState<AvailabilityPayload | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [position, setPosition] = useState<number | null>(null);
  const [range, setRange] = useState<DateRange | undefined>();
  const [conflictNote, setConflictNote] = useState<string | null>(null);
  const [method, setMethod] = useState<PlatformGateway | null>(null);
  const [iotecChannel, setIotecChannel] = useState<"mobile_money" | "card">(
    "mobile_money",
  );
  const [iotecPhone, setIotecPhone] = useState("");
  const [mtnMomoPhone, setMtnMomoPhone] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [holdExpiresAt, setHoldExpiresAt] = useState<number | null>(null);
  const [holdRemaining, setHoldRemaining] = useState<number>(0);
  const lastAvailabilityFetch = useRef(0);
  const { gatewayOpen, withGatewayWindow } = useGatewayWindow();

  const formatPrice = useCurrencyFormatter(catalog?.currency);

  // Reset per open; a preselected product (products-table row action) skips
  // straight to the slot step.
  useApplyOnChange([props.open, props.preselectedProduct], () => {
    if (!props.open) return;
    setProduct(props.preselectedProduct ?? null);
    setStep(props.preselectedProduct ? "slot" : "product");
    setProductSearch("");
    setPosition(null);
    setRange(undefined);
    setConflictNote(null);
    setMethod(null);
    setIsPolling(false);
    setIsSubmitting(false);
    setHoldExpiresAt(null);
  });

  // The static half — ladder, prices, reach, booking rules — once per open.
  useEffect(() => {
    if (!props.open) return;
    let cancelled = false;
    apiClient
      .get<CatalogPayload>("/api/vendor/boosts/catalog")
      .then((data) => {
        if (!cancelled) setCatalog(data);
      })
      .catch((error) => {
        toast.error(
          error instanceof Error
            ? error.message
            : label("boosts.purchase.loadFailed", "Failed to load the boost ladder"),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [props.open, label]);

  const loadAvailability = useCallback((): Promise<AvailabilityPayload | null> => {
    if (!catalog) return Promise.resolve(null);
    const todayGuess = new Date().toISOString().slice(0, 10);
    return apiClient
      .get<AvailabilityPayload>("/api/vendor/boosts/availability", {
        query: {
          from: todayGuess,
          to: addDays(todayGuess, catalog.bookingHorizonDays),
          productId: product?._id,
        },
      })
      .then((data) => {
        setAvailability(data);
        lastAvailabilityFetch.current = Date.now();
        return data;
      })
      .catch((error) => {
        toast.error(
          error instanceof Error
            ? error.message
            : label(
                "boosts.purchase.availabilityFailed",
                "Failed to load the booking calendar",
              ),
        );
        return null;
      })
      .finally(() => setAvailabilityLoading(false));
  }, [catalog, product?._id, label]);
  // Refreshes from the UI show the calendar spinner; the slot step's own load
  // sets it during render below.
  const refreshAvailability = useCallback(() => {
    if (!catalog) return Promise.resolve(null);
    setAvailabilityLoading(true);
    return loadAvailability();
  }, [catalog, loadAvailability]);

  // Refetch when the slot step opens — including after a Back — and again when
  // the tab regains focus after sitting idle. Neither is a guarantee; the
  // insert in the checkout route is the only authority. They just keep the
  // common race off the vendor's screen.
  useApplyOnChange([props.open, step, catalog], () => {
    if (props.open && step === "slot" && catalog) setAvailabilityLoading(true);
  });
  useEffect(() => {
    if (!props.open || step !== "slot" || !catalog) return;
    void loadAvailability();
  }, [props.open, step, catalog, loadAvailability]);

  useEffect(() => {
    if (!props.open || step !== "slot") return;
    const onFocus = () => {
      if (Date.now() - lastAvailabilityFetch.current < REFETCH_AFTER_IDLE_MS) {
        return;
      }
      void loadAvailability();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [props.open, step, loadAvailability]);

  // Product search (vendor's active products only — inactive can't be boosted).
  useApplyOnChange([props.open, step, productSearch], () => {
    if (props.open && step === "product") setProductsLoading(true);
  });

  useEffect(() => {
    if (!props.open || step !== "product") return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          status: "active",
          limit: String(PRODUCT_PAGE_SIZE),
        });
        if (productSearch.trim()) params.set("search", productSearch.trim());
        const res = await fetch(`/api/vendor/products?${params.toString()}`);
        const json = await res.json();
        if (cancelled) return;
        const rows = (json?.data?.data ?? []) as Array<{
          _id: string;
          name?: string;
          images?: string[];
        }>;
        // Nothing is hidden here. Under the ladder a product may legitimately
        // hold this week's Position 1 and next month's Position 2, so the old
        // boosted-product hide-list would lock a vendor out of their own
        // best-selling item; the calendar greys out the days it already holds.
        setProducts(
          rows.map((row) => ({
            _id: row._id,
            name: row.name || "",
            image: row.images?.[0] || null,
          })),
        );
        setProductTotal(Number(json?.data?.pagination?.total ?? rows.length));
      } catch {
        if (!cancelled) {
          setProducts([]);
          setProductTotal(0);
        }
      } finally {
        if (!cancelled) setProductsLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [props.open, step, productSearch]);

  // ---- what the calendar and the ladder list read ---------------------
  const horizonDays = catalog?.bookingHorizonDays ?? 60;
  const maxBookingDays = catalog?.maxBookingDays ?? 60;

  const rungs = useMemo<BookingRung[]>(
    () =>
      catalog
        ? catalog.positions.map((row) => ({
            position: row.position,
            label: row.label,
            pricePerDay: row.pricePerDay,
            currency: catalog.currency,
            reach: row.reach,
            blocked: row.stale ? "stale" : null,
          }))
        : [],
    [catalog],
  );

  const calendarData = useMemo(
    () =>
      availability
        ? fromVendorAvailability(availability, addDays(availability.today, horizonDays))
        : null,
    [availability, horizonDays],
  );

  const rung = rungs.find((row) => row.position === position) ?? null;
  const selection = useMemo(() => selectionFromRange(range), [range]);
  const clash =
    calendarData && rung && selection
      ? clashingDays(calendarData, rung.position, selection.startDay, selection.endDay)
      : [];
  const slotReady = Boolean(
    product &&
      rung &&
      !rung.blocked &&
      selection &&
      clash.length === 0 &&
      selection.days <= maxBookingDays,
  );
  const total =
    rung && selection && catalog
      ? quantizeToCurrency(rung.pricePerDay * selection.days, catalog.currency)
      : null;

  // ---- the hold countdown ----------------------------------------------
  // UI for a server rule, not a second source of truth: `holdExpiresAt` on the
  // campaign and the cron are authoritative, and this only tells the vendor how
  // long the days in front of them stay theirs.
  useEffect(() => {
    if (!holdExpiresAt) return;
    const tick = () => {
      const remaining = Math.max(0, holdExpiresAt - Date.now());
      setHoldRemaining(remaining);
      if (remaining === 0) {
        toast.error(
          label(
            "boosts.purchase.holdExpired",
            "Your hold expired and the dates went back on sale.",
          ),
        );
        props.onOpenChange(false);
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [holdExpiresAt, label, props]);

  const pollVerify = useCallback(
    async (paymentId: string) => {
      setIsPolling(true);
      for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        try {
          const result = await apiClient.post<{ paid: boolean }>(
            "/api/vendor/boosts/checkout/verify",
            { paymentId },
          );
          if (result.paid) {
            setIsPolling(false);
            toast.success(
              label("boosts.purchase.booked", "Your booking is confirmed."),
            );
            props.onOpenChange(false);
            router.refresh();
            return;
          }
        } catch {
          // Transient poll errors are expected while the payer approves.
        }
      }
      setIsPolling(false);
      toast.error(
        label(
          "boosts.purchase.pollTimeout",
          "We could not confirm the payment yet. It will activate automatically once confirmed.",
        ),
      );
      props.onOpenChange(false);
      router.refresh();
    },
    [label, props, router],
  );

  const handleConfirm = useCallback(async () => {
    if (!product || !rung || !selection || !method) return;
    setIsSubmitting(true);
    try {
      // Layer 1 of three: an awaited refetch immediately before the post, so a
      // range that vanished while the vendor chose a card is caught here rather
      // than at the gateway's door. Layers 2 and 3 (the insert, then the hold)
      // are the actual guarantees.
      const fresh = await refreshAvailability();
      const freshTaken = new Set([
        ...(fresh?.positions.find((p) => p.position === rung.position)?.takenDays ??
          []),
        ...(fresh?.productBookedDays ?? []),
      ]);
      const gone = enumerateDays(selection.startDay, selection.endDay).filter((day) =>
        freshTaken.has(day),
      );
      if (gone.length > 0) {
        setStep("slot");
        setRange(undefined);
        setConflictNote(
          label(
            "boosts.purchase.slotTakenRetry",
            "Someone booked {days} while you were choosing. Pick again.",
            { days: formatBookingRuns(gone, locale) },
          ),
        );
        return;
      }

      const response = await apiClient.post<CheckoutResponse>(
        "/api/vendor/boosts/checkout",
        {
          productId: product._id,
          position: rung.position,
          startDay: selection.startDay,
          endDay: selection.endDay,
          paymentMethod: method,
          locale: props.locale,
          ...(method === "iotec"
            ? { iotecChannel, iotecPhone: iotecPhone || undefined }
            : {}),
          ...(method === "mtn_momo" ? { mtnMomoPhone: mtnMomoPhone || undefined } : {}),
        },
      );

      // The days are held from here. Redirect gateways leave the page, so the
      // countdown only ever renders for the flows that stay.
      if (catalog) {
        setHoldExpiresAt(Date.now() + catalog.holdMinutes * 60 * 1000);
      }

      if (response.type === "redirect" && response.url) {
        window.location.assign(response.url);
        return;
      }

      if (response.type === "razorpay" && response.razorpayOrderId) {
        const razorpayOrderId = response.razorpayOrderId;
        // Never resolves: Razorpay returns the vendor to /vendor/boosts, which
        // verifies the payment with the signature the return carries. The
        // dialog steps aside meanwhile, or its modal lock would leave
        // Razorpay's window unclickable; it comes back if the vendor closes it.
        await withGatewayWindow(() =>
          openRazorpayCheckout({
            keyId: response.keyId ?? "",
            razorpayOrderId,
            amount: response.amount ?? 0,
            currency: response.currency ?? "",
            name: response.name ?? "",
            description: response.description,
            callbackUrl: response.callbackUrl ?? "",
            prefill: response.prefill,
            canceledMessage: label(
              "boosts.purchase.canceled",
              "Payment was canceled. Please try again.",
            ),
          }),
        );
        return;
      }

      if (response.type === "polling") {
        toast.info(
          label(
            "boosts.purchase.checkPhone",
            "Check your phone and approve the payment request.",
          ),
        );
        await pollVerify(response.paymentId);
        return;
      }

      throw new Error(label("boosts.purchase.failed", "Failed to start the payment"));
    } catch (error) {
      // The open-checkout cap carries a machine-readable reason precisely so
      // this branch does not have to match on the server's English sentence.
      if (error instanceof ApiClientError) {
        const details = error.details as { reason?: string; limit?: number } | undefined;
        if (details?.reason === "too_many_holds") {
          toast.error(
            label(
              "boosts.purchase.tooManyHolds",
              "You already have {limit} checkouts open. Finish or cancel one first.",
              { limit: details.limit ?? 3 },
            ),
          );
          return;
        }
      }
      // A 409 from the insert names the days that were taken. Two unique
      // indexes can fire and they mean different things: a position conflict
      // is "buy another rung or other days", a product conflict is "this
      // product is already on screen that day".
      if (error instanceof ApiClientError && error.status === 409) {
        const details = error.details as
          | { conflictDays?: string[]; productConflictDays?: string[] }
          | undefined;
        const productDays = details?.productConflictDays ?? [];
        const positionDays = details?.conflictDays ?? [];
        if (productDays.length > 0 || positionDays.length > 0) {
          setStep("slot");
          setRange(undefined);
          setHoldExpiresAt(null);
          void refreshAvailability();
          setConflictNote(
            productDays.length > 0
              ? label(
                  "boosts.purchase.productBusy",
                  "This product is already scheduled on {days}. Pick other dates, or a different product.",
                  { days: formatBookingRuns(productDays, locale) },
                )
              : label(
                  "boosts.purchase.slotTaken",
                  "Someone just booked {days} at this position.",
                  { days: formatBookingRuns(positionDays, locale) },
                ),
          );
          return;
        }
      }
      toast.error(
        platformPaymentErrorMessage(
          error,
          label,
          label("boosts.purchase.failed", "Failed to start the payment"),
        ),
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [
    product,
    rung,
    selection,
    method,
    catalog,
    props.locale,
    iotecChannel,
    iotecPhone,
    mtnMomoPhone,
    label,
    locale,
    refreshAvailability,
    pollVerify,
    withGatewayWindow,
  ]);

  const holdClock = useMemo(() => {
    const totalSeconds = Math.floor(holdRemaining / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }, [holdRemaining]);

  const steps: BookingStepItem[] = [
    {
      key: "product",
      label: label("boosts.purchase.stepProduct", "Product"),
      picked: product?.name,
      // Opened from a product's row: that product is the point, not a pick.
      locked: Boolean(props.preselectedProduct),
    },
    {
      key: "slot",
      label: label("boosts.booking.stepPositionDates", "Position & dates"),
      picked:
        rung && selection
          ? `#${rung.position} · ${formatBookingRange(selection.startDay, selection.endDay, locale)}`
          : null,
    },
    { key: "payment", label: label("boosts.purchase.stepPayment", "Payment") },
  ];

  const daysLabel = selection
    ? label("boosts.booking.dayCount", "{count} days", { count: selection.days })
    : "";

  const payDisabled =
    !method ||
    isSubmitting ||
    !slotReady ||
    (method === "iotec" && iotecChannel === "mobile_money" && !iotecPhone.trim()) ||
    (method === "mtn_momo" && !mtnMomoPhone.trim());

  let body;
  let footer;
  if (isPolling) {
    body = (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">
          {label(
            "boosts.purchase.checkPhone",
            "Check your phone and approve the payment request.",
          )}
        </p>
      </div>
    );
  } else if (step === "product") {
    body = (
      <BookingProductStep
        query={productSearch}
        onQueryChange={setProductSearch}
        placeholder={label("boosts.purchase.searchProducts", "Search your products…")}
        items={products.map((row) => ({ id: row._id, name: row.name, image: row.image }))}
        total={productTotal}
        loading={productsLoading}
        selectedId={product?._id ?? null}
        onSelect={(item) =>
          setProduct(products.find((row) => row._id === item.id) ?? null)
        }
        emptyText={label("boosts.purchase.noProducts", "No active products found")}
      />
    );
    footer = (
      <BookingFooter
        secondary={{
          label: label("common.cancel", "Cancel"),
          onClick: () => props.onOpenChange(false),
        }}
        total={null}
        primary={{
          label: label("common.continue", "Continue"),
          onClick: () => setStep("slot"),
          disabled: !product,
          arrow: true,
        }}
      />
    );
  } else if (!catalog) {
    body = (
      <div className="flex justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  } else if (step === "slot") {
    body = (
      <BookingSlotStep
        area="vendor"
        rungs={rungs}
        placementsEnabled={catalog.placementsEnabled}
        data={calendarData}
        refreshing={availabilityLoading}
        horizonDays={horizonDays}
        maxBookingDays={maxBookingDays}
        position={position}
        onPositionChange={(next) => {
          setPosition(next);
          setConflictNote(null);
        }}
        range={range}
        onRangeChange={(next) => {
          setRange(next);
          setConflictNote(null);
        }}
        serverNote={conflictNote}
        formatPrice={(amount) => formatPrice(amount)}
      />
    );
    footer = (
      <BookingFooter
        secondary={
          props.preselectedProduct
            ? {
                label: label("common.cancel", "Cancel"),
                onClick: () => props.onOpenChange(false),
              }
            : { label: label("common.back", "Back"), onClick: () => setStep("product") }
        }
        total={
          slotReady && total !== null
            ? {
                label: `${label("boosts.booking.total", "Total")} · ${daysLabel}`,
                value: formatPrice(total),
              }
            : null
        }
        primary={{
          label: label("common.continue", "Continue"),
          onClick: () => setStep("payment"),
          disabled: !slotReady,
          arrow: true,
        }}
      />
    );
  } else if (product && rung && selection && total !== null) {
    body = (
      <div className="grid gap-6 md:grid-cols-[300px_minmax(0,1fr)] md:items-start">
        <div className="space-y-3">
          <BookingSummary
            productName={product.name}
            productImage={product.image}
            rows={[
              {
                label: label("boosts.admin.position", "Position"),
                value: `#${rung.position} ${rung.label}`,
              },
              {
                label: label("boosts.booking.dates", "Dates"),
                value: `${formatBookingRange(selection.startDay, selection.endDay, locale, true)} · ${daysLabel}`,
              },
              {
                label: label("boosts.booking.price", "Price"),
                value: `${formatPrice(rung.pricePerDay)} × ${selection.days} = ${formatPrice(total)}`,
              },
            ]}
          />
          {/* The disclosures, kept short: they are the difference between
              selling a visual slot and implying an audience. Reach is shown
              on each rung before it is picked. */}
          <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground">
            <li>
              {label(
                "boosts.booking.termSlot",
                "You're buying slot #{position}. If a slot above is unsold, yours doesn't move up.",
                { position: rung.position },
              )}
            </li>
            {rung.reach.listing && catalog.placementsEnabled.listing ? (
              <li>
                {label(
                  "boosts.booking.termListings",
                  "On listings it shows on the shop and category pages, never in search results.",
                )}
              </li>
            ) : null}
            <li>
              {label(
                "boosts.booking.termRefund",
                "Days already run aren't refundable. Future days can be released for credit.",
              )}
            </li>
            <li>
              {label(
                "boosts.booking.termHold",
                "Your dates are held for {minutes} minutes while you pay.",
                { minutes: catalog.holdMinutes },
              )}
            </li>
          </ul>
        </div>
        <div className="min-w-0 space-y-3">
          <h3 className="text-sm font-medium">{label("boosts.booking.payWith", "Pay with")}</h3>
          {holdExpiresAt ? (
            <p className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 p-2.5 text-xs text-foreground">
              <Clock className="h-3.5 w-3.5 shrink-0 text-primary" />
              {label("boosts.purchase.holdExpires", "These dates are held for you for {clock}", {
                clock: holdClock,
              })}
            </p>
          ) : null}
          <PaymentMethodPicker
            methods={catalog.paymentMethods ?? []}
            value={method}
            onChange={setMethod}
            iotecChannel={iotecChannel}
            onIotecChannelChange={setIotecChannel}
            iotecPhone={iotecPhone}
            onIotecPhoneChange={setIotecPhone}
            mtnMomoPhone={mtnMomoPhone}
            onMtnMomoPhoneChange={setMtnMomoPhone}
          />
        </div>
      </div>
    );
    footer = (
      <BookingFooter
        secondary={{
          label: label("common.back", "Back"),
          onClick: () => setStep("slot"),
          disabled: isSubmitting,
        }}
        total={{
          label: label("boosts.booking.totalDue", "Total due"),
          value: formatPrice(total),
        }}
        primary={{
          label: label("boosts.purchase.payNow", "Pay & book"),
          onClick: handleConfirm,
          disabled: payDisabled,
          busy: isSubmitting,
        }}
      />
    );
  }

  return (
    <BookingDialogFrame
      open={props.open && !gatewayOpen}
      onOpenChange={(open) => {
        if (isPolling || isSubmitting) return;
        props.onOpenChange(open);
      }}
      title={
        isPolling
          ? label("boosts.purchase.waitingTitle", "Waiting for payment")
          : label("boosts.booking.vendorTitle", "Boost a product")
      }
      description={label(
        "boosts.purchase.subtitle",
        "Book a numbered slot on the sponsored ladder for the days you choose.",
      )}
      stepper={
        isPolling ? null : (
          <BookingStepper
            steps={steps}
            current={step}
            onStepClick={(key) => {
              if (isSubmitting) return;
              setStep(key as Step);
            }}
          />
        )
      }
      footer={footer}
    >
      {body}
    </BookingDialogFrame>
  );
}
