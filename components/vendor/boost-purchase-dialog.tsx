"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { DateRange } from "react-day-picker";
import { AlertTriangle, Check, Clock, Loader2, Rocket, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast-notification";
import { ApiClientError, apiClient } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { useCurrencyFormatter } from "@/providers/currency-provider";
import { loadRazorpayCheckoutScript } from "@/components/checkout/checkout-helpers";
import {
  PaymentMethodPicker,
  type PlatformGateway,
} from "@/components/vendor/payment-method-picker";
import {
  addDays,
  calendarDateFromUtcDay,
  daysBetweenInclusive,
  enumerateDays,
  utcDayFromCalendarDate,
} from "@/lib/boosts/boost-days";
import { quantizeToCurrency } from "@/lib/intl/money";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

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
  reach: { home: boolean; listing: boolean; productPage: boolean };
  avgImpressionsPerDay: number | null;
}

interface CatalogPayload {
  currency: string;
  paymentMethods: PlatformGateway[];
  positions: LadderRung[];
  placementDepth: { home: number; listing: number; productPage: number };
  placementsEnabled: { home: boolean; listing: boolean; productPage: boolean };
  bookingHorizonDays: number;
  maxBookingDays: number;
  holdMinutes: number;
  bookingCountByProduct: Record<string, number>;
}

interface AvailabilityPayload {
  from: string;
  to: string;
  /** The server's UTC day. The client's own clock is never trusted. */
  today: string;
  positions: Array<{
    position: number;
    takenDays: string[];
    ownDays: string[];
  }>;
  productBookedDays?: string[];
}

type Step = "product" | "slot" | "payment";

interface RazorpayInitiation {
  keyId: string;
  razorpayOrderId: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  prefill: { email?: string; name?: string; contact?: string };
}

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
  prefill?: RazorpayInitiation["prefill"];
}

const POLL_INTERVAL_MS = 4000;
const POLL_MAX_ATTEMPTS = 45;
/** Refetch availability on focus only after the payload has had time to rot. */
const REFETCH_AFTER_IDLE_MS = 60_000;

/**
 * Step-progress rail mirroring the numbered-circle stepper used by the
 * become-a-vendor wizard (components/vendor/vendor-registration-form.tsx)
 * so multi-step flows read consistently across the app. Completed steps are
 * clickable to jump back; the upcoming step is not (nothing to show yet).
 */
function BoostStepper(props: {
  steps: { key: Step; label: string }[];
  currentKey: Step;
  onStepClick: (key: Step) => void;
}) {
  const currentIndex = props.steps.findIndex((s) => s.key === props.currentKey);
  return (
    <div className="flex items-center pb-1">
      {props.steps.map((item, index) => {
        const isDone = index < currentIndex;
        const isCurrent = item.key === props.currentKey;
        const clickable = isDone;
        return (
          <div
            key={item.key}
            className={cn("flex items-center", index > 0 && "flex-1")}
          >
            {index > 0 && (
              <div
                className={cn(
                  "mx-2 h-px flex-1",
                  isDone || isCurrent ? "bg-primary" : "bg-border",
                )}
              />
            )}
            <button
              type="button"
              onClick={() => clickable && props.onStepClick(item.key)}
              disabled={!clickable}
              aria-current={isCurrent ? "step" : undefined}
              className={cn(
                "group flex items-center gap-2 rounded-full",
                clickable ? "cursor-pointer" : "cursor-default",
              )}
            >
              <div
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors",
                  isDone && "border-primary bg-primary text-primary-foreground",
                  isCurrent && !isDone && "border-primary text-primary",
                  !isDone && !isCurrent && "border-border text-muted-foreground",
                  clickable && "group-hover:border-primary",
                )}
              >
                {isDone ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </div>
              <span
                className={cn(
                  "hidden text-xs font-medium transition-colors sm:inline",
                  isCurrent ? "text-foreground" : "text-muted-foreground",
                  clickable && "group-hover:text-foreground",
                )}
              >
                {item.label}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** "12–18 Sep 2026", or a single day when the range is one day long. */
function formatDayRange(startDay: string, endDay: string, locale: string) {
  const formatter = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const from = formatter.format(new Date(`${startDay}T00:00:00.000Z`));
  if (startDay === endDay) return from;
  return `${from} – ${formatter.format(new Date(`${endDay}T00:00:00.000Z`))}`;
}

/**
 * The vendor's boost purchase flow: pick product → pick a ladder rung and a
 * date range → pick payment → gateway hand-off. Redirect gateways leave the
 * page and return to /vendor/boosts?boost_payment=…; Razorpay opens its modal
 * here; ioTec mobile money stays on a "check your phone" polling state.
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
  // `t()` runs the ICU formatter, which throws when a placeholder in the
  // message has no value — so interpolation values must be handed to `t()`
  // itself. The fallback string never reaches the formatter, so it gets the
  // same substitution by hand.
  const label = useCallback(
    (
      key: string,
      fallback: string,
      values?: Record<string, string | number>,
    ) => {
      if (t.has(key)) return t(key, values);
      if (!values) return fallback;
      return Object.entries(values).reduce(
        (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
        fallback,
      );
    },
    [t],
  );

  const [step, setStep] = useState<Step>("product");
  const [productSearch, setProductSearch] = useState("");
  const [products, setProducts] = useState<BoostablePicker[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [product, setProduct] = useState<BoostablePicker | null>(null);
  const [catalog, setCatalog] = useState<CatalogPayload | null>(null);
  const [availability, setAvailability] = useState<AvailabilityPayload | null>(
    null,
  );
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

  const formatPrice = useCurrencyFormatter(catalog?.currency);

  // Reset per open; a preselected product (products-table row action) skips
  // straight to the slot step.
  useApplyOnChange([props.open, props.preselectedProduct], () => {
    if (!props.open) return;
    setProduct(props.preselectedProduct ?? null);
    setStep(props.preselectedProduct ? "slot" : "product");
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
        const params = new URLSearchParams({ status: "active", limit: "8" });
        if (productSearch.trim()) params.set("search", productSearch.trim());
        const res = await fetch(`/api/vendor/products?${params.toString()}`);
        const json = await res.json();
        if (cancelled) return;
        const rows = (json?.data?.data ?? []) as Array<{
          _id: string;
          name?: string;
          images?: string[];
        }>;
        // Nothing is hidden here any more. Under the ladder a product may
        // legitimately hold this week's Position 1 and next month's Position 2,
        // so the old boosted-product hide-list would lock a vendor out of their
        // own best-selling item. The count is shown instead, and the calendar
        // greys out the specific days that product already holds.
        setProducts(
          rows.map((row) => ({
            _id: row._id,
            name: row.name || "",
            image: row.images?.[0] || null,
          })),
        );
      } catch {
        if (!cancelled) setProducts([]);
      } finally {
        if (!cancelled) setProductsLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [props.open, step, productSearch]);

  // ---- day sets the calendar paints from -------------------------------
  const today = availability?.today ?? new Date().toISOString().slice(0, 10);
  const horizonEnd = addDays(today, catalog?.bookingHorizonDays ?? 60);

  const rung = useMemo(
    () => catalog?.positions.find((p) => p.position === position) ?? null,
    [catalog, position],
  );

  const dayGroups = useMemo(() => {
    const forPosition = availability?.positions.find(
      (p) => p.position === position,
    );
    const own = new Set(forPosition?.ownDays ?? []);
    // Every day this product already holds at ANY rung: the {productId, day}
    // unique index refuses these, so they are disabled rather than discovered
    // on the way back from a gateway.
    const productBooked = new Set(availability?.productBookedDays ?? []);
    const blocked = new Set<string>([
      ...(forPosition?.takenDays ?? []),
      ...productBooked,
    ]);
    return {
      blocked,
      own,
      productBooked,
      // "Taken by someone else" is what earns the strike-through; a vendor's
      // own days are ringed instead, because seeing them struck out reads as a
      // fault rather than as their own booking.
      taken: new Set(
        [...(forPosition?.takenDays ?? [])].filter((day) => !own.has(day)),
      ),
    };
  }, [availability, position]);

  const selection = useMemo(() => {
    if (!range?.from || !range.to) return null;
    const from = utcDayFromCalendarDate(range.from);
    const to = utcDayFromCalendarDate(range.to);
    const startDay = from <= to ? from : to;
    const endDay = from <= to ? to : from;
    return {
      startDay,
      endDay,
      days: daysBetweenInclusive(startDay, endDay),
    };
  }, [range]);

  const total = useMemo(() => {
    if (!selection || !rung || !catalog) return null;
    return quantizeToCurrency(
      rung.pricePerDay * selection.days,
      catalog.currency,
    );
  }, [selection, rung, catalog]);

  // Switching rungs re-derives the blocked set from the already-loaded payload
  // (it covers every rung), so there is no refetch — but a draft that now
  // intersects a taken day has to go, or the vendor pays the 409 to find out.
  useApplyOnChange([dayGroups.blocked, selection, label], () => {
    if (!selection) return;
    const clash = enumerateDays(selection.startDay, selection.endDay).filter(
      (day) => dayGroups.blocked.has(day),
    );
    if (clash.length === 0) return;
    setRange(undefined);
    setConflictNote(
      label(
        "boosts.purchase.conflictInline",
        "Those dates aren't free at this position — pick again.",
      ),
    );
  });

  const maxBookingDays = catalog?.maxBookingDays ?? 60;
  const overMax = Boolean(selection && selection.days > maxBookingDays);

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
        ...(fresh?.positions.find((p) => p.position === rung.position)
          ?.takenDays ?? []),
        ...(fresh?.productBookedDays ?? []),
      ]);
      const gone = enumerateDays(selection.startDay, selection.endDay).filter(
        (day) => freshTaken.has(day),
      );
      if (gone.length > 0) {
        setStep("slot");
        setRange(undefined);
        setConflictNote(
          label(
            "boosts.purchase.slotTakenRetry",
            "Someone booked {days} while you were choosing. Pick again.",
            { days: gone.join(", ") },
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
          ...(method === "mtn_momo"
            ? { mtnMomoPhone: mtnMomoPhone || undefined }
            : {}),
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
        await loadRazorpayCheckoutScript();
        const Razorpay = (
          window as unknown as {
            Razorpay?: new (options: Record<string, unknown>) => {
              open: () => void;
              on: (event: string, cb: (r: unknown) => void) => void;
            };
          }
        ).Razorpay;
        if (!Razorpay) {
          throw new Error("Razorpay checkout is unavailable");
        }
        const payload = await new Promise<{
          razorpay_payment_id: string;
          razorpay_signature: string;
        }>((resolve, reject) => {
          let settled = false;
          const razorpay = new Razorpay({
            key: response.keyId,
            amount: response.amount,
            currency: response.currency,
            name: response.name,
            description: response.description,
            order_id: response.razorpayOrderId,
            prefill: response.prefill,
            handler: (result: unknown) => {
              settled = true;
              resolve(
                result as {
                  razorpay_payment_id: string;
                  razorpay_signature: string;
                },
              );
            },
            modal: {
              ondismiss: () => {
                if (!settled) {
                  reject(
                    new Error(
                      label(
                        "boosts.purchase.canceled",
                        "Payment was canceled. Please try again.",
                      ),
                    ),
                  );
                }
              },
            },
          });
          razorpay.on("payment.failed", (result: unknown) => {
            settled = true;
            const failure = result as {
              error?: { description?: string; reason?: string };
            };
            reject(
              new Error(
                failure.error?.description ||
                  failure.error?.reason ||
                  "Razorpay payment failed",
              ),
            );
          });
          razorpay.open();
        });

        const verify = await apiClient.post<{ paid: boolean }>(
          "/api/vendor/boosts/checkout/verify",
          {
            paymentId: response.paymentId,
            razorpayPaymentId: payload.razorpay_payment_id,
            razorpaySignature: payload.razorpay_signature,
          },
        );
        if (verify.paid) {
          toast.success(
            label("boosts.purchase.booked", "Your booking is confirmed."),
          );
          props.onOpenChange(false);
          router.refresh();
        } else {
          throw new Error(
            label(
              "boosts.purchase.verifyFailed",
              "Payment could not be verified",
            ),
          );
        }
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

      throw new Error(
        label("boosts.purchase.failed", "Failed to start the payment"),
      );
    } catch (error) {
      // A 409 from the insert names the days that were taken. Two unique
      // indexes can fire and they mean different things, so they repaint
      // differently: a position conflict is "buy another rung or other days",
      // a product conflict is "this product is already on screen that day".
      // The open-checkout cap. It carries a machine-readable reason precisely so
      // this branch does not have to match on the server's English sentence.
      if (error instanceof ApiClientError) {
        const details = error.details as
          | { reason?: string; limit?: number }
          | undefined;
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
                  { days: productDays.join(", ") },
                )
              : label(
                  "boosts.purchase.slotTaken",
                  "Someone just booked {days} at this position.",
                  { days: positionDays.join(", ") },
                ),
          );
          return;
        }
      }
      toast.error(
        error instanceof Error
          ? error.message
          : label("boosts.purchase.failed", "Failed to start the payment"),
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
    props,
    iotecChannel,
    iotecPhone,
    mtnMomoPhone,
    label,
    refreshAvailability,
    pollVerify,
    router,
  ]);

  const visibleSteps = useMemo(() => {
    const all: { key: Step; label: string }[] = [
      { key: "product", label: label("boosts.purchase.stepProduct", "Product") },
      { key: "slot", label: label("boosts.purchase.stepSlot", "Slot & dates") },
      { key: "payment", label: label("boosts.purchase.stepPayment", "Payment") },
    ];
    // A preselected product (products-table row action) skips the picker,
    // so there's no "Product" step to show progress against.
    return props.preselectedProduct
      ? all.filter((item) => item.key !== "product")
      : all;
  }, [props.preselectedProduct, label]);

  const stepTitle = useMemo(() => {
    if (isPolling)
      return label("boosts.purchase.waitingTitle", "Waiting for payment");
    if (step === "product")
      return label("boosts.purchase.pickProduct", "Choose a product");
    if (step === "slot")
      return label("boosts.purchase.pickSlot", "Choose a position and dates");
    return label("boosts.purchase.pickPayment", "Choose a payment method");
  }, [step, isPolling, label]);

  /** "Home (top 8) · Listings (top 3) · Product pages (top 8)", struck where it misses. */
  const reachLine = useCallback(
    (row: LadderRung) => {
      if (!catalog) return null;
      const parts: Array<{ text: string; on: boolean }> = [];
      if (catalog.placementsEnabled.home) {
        parts.push({
          text: label("boosts.positions.reachHome", "Home (top {n})", {
            n: catalog.placementDepth.home,
          }),
          on: row.reach.home,
        });
      }
      if (catalog.placementsEnabled.listing) {
        parts.push({
          text: label("boosts.positions.reachListing", "Listings (top {n})", {
            n: catalog.placementDepth.listing,
          }),
          on: row.reach.listing,
        });
      }
      if (catalog.placementsEnabled.productPage) {
        parts.push({
          text: label(
            "boosts.positions.reachProductPage",
            "Product pages (top {n})",
            { n: catalog.placementDepth.productPage },
          ),
          on: row.reach.productPage,
        });
      }
      return parts;
    },
    [catalog, label],
  );

  const holdClock = useMemo(() => {
    const totalSeconds = Math.floor(holdRemaining / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }, [holdRemaining]);

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (isPolling || isSubmitting) return;
        props.onOpenChange(open);
      }}
    >
      <DialogContent
        className={cn(
          "scrollbar-visible max-h-[85dvh] overflow-y-auto",
          step === "slot" && !isPolling ? "sm:max-w-3xl" : "sm:max-w-lg",
        )}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5 text-primary" />
            {stepTitle}
          </DialogTitle>
          <DialogDescription>
            {label(
              "boosts.purchase.subtitle",
              "Book a numbered slot on the sponsored ladder for the days you choose.",
            )}
          </DialogDescription>
        </DialogHeader>

        {!isPolling ? (
          <BoostStepper
            steps={visibleSteps}
            currentKey={step}
            onStepClick={(key) => {
              if (isSubmitting) return;
              setStep(key);
            }}
          />
        ) : null}

        {isPolling ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              {label(
                "boosts.purchase.checkPhone",
                "Check your phone and approve the payment request.",
              )}
            </p>
          </div>
        ) : step === "product" ? (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder={label(
                  "boosts.purchase.searchProducts",
                  "Search your products…",
                )}
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
              />
            </div>
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {productsLoading ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : products.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {label(
                    "boosts.purchase.noProducts",
                    "No active products found",
                  )}
                </p>
              ) : (
                products.map((row) => {
                  const booked = catalog?.bookingCountByProduct[row._id] ?? 0;
                  return (
                    <button
                      key={row._id}
                      type="button"
                      onClick={() => {
                        setProduct(row);
                        setStep("slot");
                      }}
                      className="flex w-full items-center gap-3 rounded-lg border p-2 text-left hover:bg-muted/50"
                    >
                      {row.image ? (
                        <Image
                          src={row.image}
                          alt=""
                          width={40}
                          height={40}
                          className="h-10 w-10 rounded-md object-cover"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-md bg-muted" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {row.name}
                        </span>
                        {booked > 0 ? (
                          <span className="block text-xs text-muted-foreground">
                            {label(
                              "boosts.purchase.alreadyBooked",
                              "{count} boosts booked",
                              { count: booked },
                            )}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        ) : step === "slot" ? (
          <div className="space-y-4">
            {product ? (
              <p className="text-sm text-muted-foreground">
                {label("boosts.purchase.boosting", "Boosting:")}{" "}
                <span className="font-medium text-foreground">
                  {product.name}
                </span>
              </p>
            ) : null}

            {!catalog ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : catalog.positions.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {label(
                  "boosts.purchase.noPositions",
                  "No sponsored positions are on sale yet",
                )}
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                {/* Left: the ladder. */}
                <div
                  role="radiogroup"
                  aria-label={label(
                    "boosts.purchase.pickSlot",
                    "Choose a position and dates",
                  )}
                  className="max-h-88 space-y-2 overflow-y-auto pr-1"
                >
                  {catalog.positions.map((row) => {
                    const active = row.position === position;
                    return (
                      <button
                        key={row.position}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        disabled={row.stale}
                        onClick={() => {
                          setPosition(row.position);
                          setConflictNote(null);
                        }}
                        className={cn(
                          "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                          active
                            ? "border-primary bg-primary/5"
                            : "hover:bg-muted/50",
                          row.stale && "cursor-not-allowed opacity-50",
                        )}
                      >
                        <span className="flex h-7 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-bold">
                          #{row.position}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                            <span className="font-medium">{row.label}</span>
                            <span className="text-sm font-semibold">
                              {formatPrice(row.pricePerDay)}
                              <span className="ml-0.5 text-xs font-normal text-muted-foreground">
                                {label("boosts.purchase.perDay", "/day")}
                              </span>
                            </span>
                          </span>
                          {row.description ? (
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              {row.description}
                            </span>
                          ) : null}
                          {/* Reach is shown BEFORE selection, not after
                              commitment: a rung that misses the listing depth
                              is a materially different product. */}
                          <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">
                            {reachLine(row)?.map((part, index) => (
                              <span key={part.text}>
                                {index > 0 ? " · " : ""}
                                <span
                                  className={cn(
                                    !part.on && "line-through opacity-60",
                                  )}
                                >
                                  {part.text}
                                </span>
                              </span>
                            ))}
                          </span>
                          {row.avgImpressionsPerDay !== null ? (
                            <span className="mt-0.5 block text-[11px] text-muted-foreground">
                              {label(
                                "boosts.purchase.observedReach",
                                "Averaged {n} impressions/day over the last 30 days",
                                {
                                  n: row.avgImpressionsPerDay.toLocaleString(
                                    props.locale,
                                  ),
                                },
                              )}
                            </span>
                          ) : null}
                          {row.stale ? (
                            <span className="mt-1 block text-[11px] font-medium text-destructive">
                              {label(
                                "boosts.purchase.positionStale",
                                "Priced in another currency — ask the marketplace to re-price it.",
                              )}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Right: the calendar, inline — it is the primary control. */}
                <div className="space-y-2">
                  {position === null ? (
                    <div className="flex h-full min-h-72 w-70.5 items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                      {label(
                        "boosts.purchase.pickPositionFirst",
                        "Pick a position to see which days are free.",
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="relative">
                        {availabilityLoading ? (
                          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/60">
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                          </div>
                        ) : null}
                        <Calendar
                          mode="range"
                          selected={range}
                          onSelect={(next) => {
                            setRange(next);
                            setConflictNote(null);
                          }}
                          numberOfMonths={1}
                          fixedWeeks
                          weekStartsOn={1}
                          // A drag can never span a booked day: without this a
                          // vendor selects across a gap and the server refuses
                          // a range the calendar appeared to allow.
                          excludeDisabled
                          min={1}
                          max={maxBookingDays}
                          startMonth={calendarDateFromUtcDay(today)}
                          endMonth={calendarDateFromUtcDay(horizonEnd)}
                          disabled={[
                            { before: calendarDateFromUtcDay(today) },
                            { after: calendarDateFromUtcDay(horizonEnd) },
                            ...[...dayGroups.blocked].map(
                              calendarDateFromUtcDay,
                            ),
                          ]}
                          modifiers={{
                            taken: [...dayGroups.taken].map(
                              calendarDateFromUtcDay,
                            ),
                            own: [...dayGroups.own].map(calendarDateFromUtcDay),
                          }}
                          modifiersClassNames={{
                            taken: "line-through",
                            own: "ring-1 ring-primary/40 rounded-full",
                          }}
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <span>{label("boosts.purchase.legendFree", "Free")}</span>
                        <span className="line-through">
                          {label("boosts.purchase.legendBooked", "Booked")}
                        </span>
                        <span className="rounded-full px-1 ring-1 ring-primary/40">
                          {label("boosts.purchase.legendYours", "Yours")}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {conflictNote ? (
              <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-2.5 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {conflictNote}
              </p>
            ) : null}

            {rung && selection && total !== null ? (
              <div className="sticky bottom-0 space-y-1 rounded-lg border bg-muted/50 p-3 text-sm">
                <div className="text-xs text-muted-foreground">
                  {label("boosts.purchase.summaryLine", "Position {position}", {
                    position: rung.position,
                  })}{" "}
                  ·{" "}
                  {label("boosts.purchase.days", "{days} days", {
                    days: selection.days,
                  })}{" "}
                  ·{" "}
                  {formatDayRange(
                    selection.startDay,
                    selection.endDay,
                    props.locale,
                  )}{" "}
                  (UTC)
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    {formatPrice(rung.pricePerDay)} × {selection.days}
                  </span>
                  <span className="text-base font-semibold">
                    {formatPrice(total)}
                  </span>
                </div>
                {overMax ? (
                  <p className="text-xs font-medium text-destructive">
                    {label(
                      "boosts.purchase.overMaxDays",
                      "A booking cannot exceed {days} days.",
                      { days: maxBookingDays },
                    )}
                  </p>
                ) : null}
              </div>
            ) : null}

            {/* The disclosures. All required: they are the difference between
                selling a visual slot and implying an audience. Reach is the
                sixth and is rendered per rung in the list above, so it is seen
                before selection rather than after commitment. */}
            {rung ? (
              <ul className="space-y-1.5 text-[11px] leading-relaxed text-muted-foreground">
                <li>
                  {label(
                    "boosts.purchase.strictIndexNote",
                    "You're buying visual slot {position}. If a position above yours is unsold that day, that slot shows a regular product — your slot does not move up.",
                    { position: rung.position },
                  )}
                </li>
                <li>
                  {label(
                    "boosts.purchase.reachDetail",
                    "On listing pages your product appears on the main shop page and on its own category page. Filtered and search results never show sponsored products.",
                  )}
                </li>
                <li>
                  {label(
                    "boosts.purchase.refundPolicy",
                    "Days already run are not refundable. Future days can be released — the marketplace credits them at the daily rate and refunds through your payment provider. If your product goes out of stock or is unpublished, that day is credited in proportion.",
                  )}
                </li>
                <li>
                  {label(
                    "boosts.purchase.utcNote",
                    "Days run midnight to midnight, UTC.",
                  )}
                </li>
                <li>
                  {label(
                    "boosts.purchase.oneCheckout",
                    "You can have one open checkout per product. Changing the position or dates moves your hold to the new selection.",
                  )}
                </li>
              </ul>
            ) : null}

            <div className="flex justify-between pt-1">
              {props.preselectedProduct ? (
                <span />
              ) : (
                <Button variant="outline" onClick={() => setStep("product")}>
                  {label("common.back", "Back")}
                </Button>
              )}
              <Button
                disabled={!rung || !selection || overMax}
                onClick={() => setStep("payment")}
              >
                {label("common.continue", "Continue")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {rung && selection && total !== null ? (
              <div className="space-y-1 rounded-lg bg-muted/50 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span>
                    {label(
                      "boosts.purchase.summaryLine",
                      "Position {position}",
                      { position: rung.position },
                    )}{" "}
                    ·{" "}
                    {formatDayRange(
                      selection.startDay,
                      selection.endDay,
                      props.locale,
                    )}
                  </span>
                  <span className="font-semibold">{formatPrice(total)}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatPrice(rung.pricePerDay)}
                  {label("boosts.purchase.perDay", "/day")} × {selection.days}{" "}
                  ({label("boosts.purchase.utcShort", "UTC days")})
                </div>
              </div>
            ) : null}

            {holdExpiresAt ? (
              <p className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 p-2.5 text-xs text-foreground">
                <Clock className="h-3.5 w-3.5 shrink-0 text-primary" />
                {label(
                  "boosts.purchase.holdExpires",
                  "These dates are held for you for {clock}",
                  { clock: holdClock },
                )}
              </p>
            ) : null}

            <PaymentMethodPicker
              methods={catalog?.paymentMethods ?? []}
              value={method}
              onChange={setMethod}
              iotecChannel={iotecChannel}
              onIotecChannelChange={setIotecChannel}
              iotecPhone={iotecPhone}
              onIotecPhoneChange={setIotecPhone}
              mtnMomoPhone={mtnMomoPhone}
              onMtnMomoPhoneChange={setMtnMomoPhone}
            />
            <div className="flex justify-between pt-2">
              <Button
                variant="outline"
                disabled={isSubmitting}
                onClick={() => setStep("slot")}
              >
                {label("common.back", "Back")}
              </Button>
              <Button
                disabled={
                  !method ||
                  isSubmitting ||
                  (method === "iotec" &&
                    iotecChannel === "mobile_money" &&
                    !iotecPhone.trim()) ||
                  (method === "mtn_momo" && !mtnMomoPhone.trim())
                }
                onClick={handleConfirm}
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {label("boosts.purchase.payNow", "Pay & book")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
