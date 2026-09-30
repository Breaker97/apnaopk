"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { DateRange } from "react-day-picker";
import { Loader2 } from "lucide-react";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  type BookingProductItem,
  type BookingStepItem,
} from "@/components/boosts/boost-booking-dialog";
import { ApiClientError, apiClient } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { useCurrency, useCurrencyFormatter } from "@/providers/currency-provider";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { addDays } from "@/lib/boosts/boost-days";
import {
  clashingDays,
  fromAdminAvailability,
  type AdminAvailabilityPayload,
  type BookingRung,
  type BookingSurface,
} from "@/lib/boosts/boost-booking";
import { formatCurrency, quantizeToCurrency } from "@/lib/intl/money";

const API_BASE = "/api/admin/boosts/campaigns";
/** Widest window the availability read ever asks for; the store's own booking
 *  horizon narrows it further. */
const MAX_HORIZON_DAYS = 180;
const PRODUCT_PAGE_SIZE = 8;
const ALL_SURFACES: Record<BookingSurface, boolean> = {
  home: true,
  listing: true,
  productPage: true,
};

type Step = "product" | "slot" | "payment";
type AmountMode = "full" | "part" | "free";

interface ProductRow {
  _id: string;
  name?: string;
  images?: string[];
  vendorId?: { _id?: string; storeName?: string } | string | null;
}

/**
 * `apiClient` unwraps `{ success, data }`, so a paginated list arrives as
 * `{ data: rows, pagination }` — plus the store filter options this list adds.
 */
interface ProductPage {
  data?: ProductRow[];
  pagination?: { total?: number };
  filters?: { vendors?: Array<{ value: string; label: string }> };
}

interface PositionRow {
  _id: string;
  position: number;
  label?: string;
  pricePerDay: number;
  currency?: string;
  status?: string;
  /** Renders on no placement at the current depths — unsellable. */
  unreachable?: boolean;
  /** Priced in a currency the store no longer charges in — unsellable. */
  stale?: boolean;
  reach?: Partial<Record<BookingSurface, boolean>>;
}

interface LadderPayload {
  currency: string;
  bookingHorizonDays: number;
  maxBookingDays: number;
  placementsEnabled?: Record<BookingSurface, boolean>;
  positions: PositionRow[];
}

interface PickedProduct extends BookingProductItem {
  vendorId: string;
  storeName: string;
}

function toPickedProduct(row: ProductRow): PickedProduct {
  const vendor = row.vendorId && typeof row.vendorId === "object" ? row.vendorId : null;
  const storeName = vendor?.storeName ?? "";
  return {
    id: row._id,
    name: row.name || row._id,
    image: row.images?.[0] ?? null,
    subtitle: storeName || null,
    vendorId: vendor?._id
      ? String(vendor._id)
      : typeof row.vendorId === "string"
        ? row.vendorId
        : "",
    storeName,
  };
}

/**
 * Offline-payment booking: product → position and dates → amount received.
 *
 * The admin is recording money collected outside the gateways (bank transfer,
 * cash) or comping a placement outright, so the last step spells out the
 * amount being marked as paid. It goes through the same insert-or-409 as a
 * vendor checkout — there is no admin bypass of the {position, day} index,
 * because a bypass is a double-sell.
 */
export function ManualBoostDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const t = useTranslations();
  const label = useFallbackTranslator(t);
  const locale = useLocale();
  const formatPrice = useCurrencyFormatter();
  const { currency } = useCurrency();
  const amountLabelId = useId();

  const [step, setStep] = useState<Step>("product");
  const [query, setQuery] = useState("");
  const [storeFilter, setStoreFilter] = useState("all");
  const [storeOptions, setStoreOptions] = useState<Array<{ value: string; label: string }>>(
    [],
  );
  const [products, setProducts] = useState<PickedProduct[]>([]);
  const [productTotal, setProductTotal] = useState(0);
  const [isProductsLoading, setIsProductsLoading] = useState(false);
  const [product, setProduct] = useState<PickedProduct | null>(null);
  const [ladder, setLadder] = useState<LadderPayload | null>(null);
  const [availability, setAvailability] = useState<AdminAvailabilityPayload | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [position, setPosition] = useState<number | null>(null);
  const [range, setRange] = useState<DateRange | undefined>();
  const [amountMode, setAmountMode] = useState<AmountMode>("full");
  const [partAmount, setPartAmount] = useState("");
  const [note, setNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [serverNote, setServerNote] = useState<string | null>(null);

  useApplyOnChange([props.open], () => {
    if (!props.open) return;
    setStep("product");
    setQuery("");
    setStoreFilter("all");
    setProduct(null);
    setPosition(null);
    setRange(undefined);
    setAmountMode("full");
    setPartAmount("");
    setNote("");
    setServerNote(null);
    setIsLoading(true);
  });

  const loadAvailability = useCallback(() => {
    const from = new Date().toISOString().slice(0, 10);
    return apiClient.get<AdminAvailabilityPayload>("/api/admin/boosts/availability", {
      query: { from, to: addDays(from, MAX_HORIZON_DAYS) },
    });
  }, []);

  useEffect(() => {
    if (!props.open) return;
    let cancelled = false;
    Promise.all([
      apiClient.get<LadderPayload>("/api/admin/boosts/positions"),
      loadAvailability(),
    ])
      .then(([ladderResult, availabilityResult]) => {
        if (cancelled) return;
        setLadder(
          ladderResult
            ? {
                ...ladderResult,
                positions: (ladderResult.positions ?? []).filter(
                  (row) => row.status !== "archived",
                ),
              }
            : null,
        );
        setAvailability(availabilityResult);
      })
      .catch((error) => {
        if (cancelled) return;
        toast.error(
          error instanceof Error
            ? error.message
            : label("boosts.admin.loadFailed", "Failed to load vendors and positions"),
        );
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open]);

  const refreshAvailability = useCallback(async () => {
    setIsRefreshing(true);
    try {
      setAvailability(await loadAvailability());
    } catch {
      // The copy on screen stays; the insert is the authority anyway.
    } finally {
      setIsRefreshing(false);
    }
  }, [loadAvailability]);

  useApplyOnChange([props.open, query, storeFilter], () => {
    if (props.open) setIsProductsLoading(true);
  });

  // One search over every store: the product list already matches store
  // names too, so the old two-list vendor-then-product pick is gone.
  useEffect(() => {
    if (!props.open) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const search = query.trim();
      const params = new URLSearchParams({
        // Not just "active": the storefront pool also wants the online-store
        // channel, and offering a POS-only product here means the refusal
        // arrives on Save, after the dates are picked.
        boostable: "true",
        limit: String(PRODUCT_PAGE_SIZE),
      });
      if (search) params.set("search", search);
      if (storeFilter !== "all") params.set("vendor", storeFilter);
      apiClient
        .get<ProductPage>(`/api/admin/products?${params.toString()}`)
        .then((result) => {
          if (cancelled) return;
          setProducts((result?.data ?? []).map(toPickedProduct));
          setProductTotal(result?.pagination?.total ?? 0);
          // The unfiltered answer lists every store with something to boost;
          // a searched or filtered one only the stores of its matches.
          if (!search && storeFilter === "all") {
            setStoreOptions(result?.filters?.vendors ?? []);
          }
        })
        .catch((error) => {
          if (cancelled) return;
          setProducts([]);
          setProductTotal(0);
          toast.error(
            error instanceof Error
              ? error.message
              : label("boosts.admin.loadProductsFailed", "Failed to load products"),
          );
        })
        .finally(() => {
          if (!cancelled) setIsProductsLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, query, storeFilter]);

  // The store's own booking horizon, not a number baked into this dialog. An
  // offline booking is inventory off the same calendar as a vendor's.
  const horizonDays = Math.min(MAX_HORIZON_DAYS, ladder?.bookingHorizonDays ?? 60);
  const maxBookingDays = ladder?.maxBookingDays ?? 60;

  // Unsellable rungs are listed and locked, not hidden: the admin is the
  // person who can repair either condition, and a rung that silently vanished
  // from this list is a support ticket.
  const rungs = useMemo<BookingRung[]>(
    () =>
      (ladder?.positions ?? []).map((row) => ({
        position: row.position,
        label: row.label ?? "",
        pricePerDay: row.pricePerDay,
        currency: row.currency || currency.code,
        reach: {
          home: row.reach?.home !== false,
          listing: row.reach?.listing !== false,
          productPage: row.reach?.productPage !== false,
        },
        blocked: row.unreachable ? "unreachable" : row.stale ? "stale" : null,
      })),
    [ladder, currency.code],
  );

  const calendarData = useMemo(
    () =>
      availability
        ? fromAdminAvailability(
            availability,
            product?.id ?? null,
            addDays(availability.today, horizonDays),
          )
        : null,
    [availability, product?.id, horizonDays],
  );

  const selection = useMemo(() => selectionFromRange(range), [range]);
  const rung = rungs.find((row) => row.position === position) ?? null;
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
  const listAmount =
    rung && selection
      ? quantizeToCurrency(rung.pricePerDay * selection.days, currency.code)
      : null;

  // Discount only, never a markup: the server clamps to the list price too.
  const partText = partAmount.trim();
  const partNumber = partText === "" ? Number.NaN : Number(partText);
  const partValid =
    listAmount !== null &&
    Number.isFinite(partNumber) &&
    partNumber >= 0 &&
    partNumber <= listAmount;
  const recorded =
    listAmount === null
      ? null
      : amountMode === "free"
        ? 0
        : amountMode === "part"
          ? partValid
            ? quantizeToCurrency(partNumber, currency.code)
            : null
          : listAmount;

  const daysLabel = selection
    ? label("boosts.booking.dayCount", "{count} days", { count: selection.days })
    : "";

  const handleCreate = async () => {
    if (!product || !rung || !selection || recorded === null) return;
    setIsSaving(true);
    try {
      await apiClient.post(API_BASE, {
        vendorId: product.vendorId,
        productId: product.id,
        position: rung.position,
        startDay: selection.startDay,
        endDay: selection.endDay,
        ...(amountMode === "full" ? {} : { amountOverride: recorded }),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      toast.success(label("boosts.admin.created", "Booking created"));
      props.onCreated();
    } catch (error) {
      const details =
        error instanceof ApiClientError
          ? (error.details as
              | { conflictDays?: string[]; productConflictDays?: string[] }
              | undefined)
          : undefined;
      const productDays = details?.productConflictDays ?? [];
      const positionDays = details?.conflictDays ?? [];
      if (productDays.length > 0 || positionDays.length > 0) {
        setStep("slot");
        setRange(undefined);
        void refreshAvailability();
        setServerNote(
          productDays.length > 0
            ? label(
                "boosts.purchase.productBusy",
                "This product is already scheduled on {days}. Pick other dates, or a different product.",
                { days: formatBookingRuns(productDays, locale) },
              )
            : label("boosts.purchase.slotTaken", "Someone just booked {days} at this position.", {
                days: formatBookingRuns(positionDays, locale),
              }),
        );
      } else {
        toast.error(
          error instanceof Error
            ? error.message
            : label("boosts.admin.createFailed", "Failed to create booking"),
        );
      }
    } finally {
      setIsSaving(false);
    }
  };

  const steps: BookingStepItem[] = [
    {
      key: "product",
      label: label("boosts.purchase.stepProduct", "Product"),
      picked: product?.name,
    },
    {
      key: "slot",
      label: label("boosts.booking.stepPositionDates", "Position & dates"),
      picked:
        rung && selection
          ? `#${rung.position} · ${formatBookingRange(selection.startDay, selection.endDay, locale)}`
          : null,
    },
    { key: "payment", label: label("boosts.booking.stepRecordPayment", "Record payment") },
  ];

  const storeFilterControl =
    storeOptions.length > 1 ? (
      <Select value={storeFilter} onValueChange={setStoreFilter}>
        <SelectTrigger
          aria-label={label("boosts.booking.filterByStore", "Filter by store")}
          className="w-full bg-card data-[size=default]:h-10 sm:w-[210px]"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{label("boosts.booking.allStores", "All stores")}</SelectItem>
          {storeOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : undefined;

  let body;
  let footer;
  if (step === "product") {
    body = (
      <BookingProductStep
        query={query}
        onQueryChange={setQuery}
        placeholder={label("boosts.booking.searchAll", "Search by product or store name…")}
        filter={storeFilterControl}
        items={products}
        total={productTotal}
        loading={isProductsLoading}
        selectedId={product?.id ?? null}
        onSelect={(item) =>
          setProduct(products.find((row) => row.id === item.id) ?? null)
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
  } else if (isLoading) {
    body = (
      <div className="flex justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  } else if (step === "slot") {
    body = (
      <BookingSlotStep
        area="admin"
        rungs={rungs}
        placementsEnabled={ladder?.placementsEnabled ?? ALL_SURFACES}
        data={calendarData}
        refreshing={isRefreshing}
        horizonDays={horizonDays}
        maxBookingDays={maxBookingDays}
        position={position}
        onPositionChange={(next) => {
          setPosition(next);
          setServerNote(null);
        }}
        range={range}
        onRangeChange={(next) => {
          setRange(next);
          setServerNote(null);
        }}
        serverNote={serverNote}
        formatPrice={(amount, rowCurrency) => formatCurrency(amount, rowCurrency)}
      />
    );
    footer = (
      <BookingFooter
        secondary={{ label: label("common.back", "Back"), onClick: () => setStep("product") }}
        total={
          slotReady && listAmount !== null
            ? {
                label: `${label("boosts.booking.total", "Total")} · ${daysLabel}`,
                value: formatPrice(listAmount),
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
  } else if (product && rung && selection && listAmount !== null) {
    const options: Array<{ key: AmountMode; title: string; value?: string }> = [
      {
        key: "full",
        title: label("boosts.booking.fullPrice", "Full price"),
        value: formatPrice(listAmount),
      },
      { key: "part", title: label("boosts.booking.partPayment", "Part payment or discount") },
      { key: "free", title: label("boosts.booking.free", "Free"), value: formatPrice(0) },
    ];
    const partHint = !partValid
      ? label("boosts.booking.enterAmountRange", "Enter {min} to {max}", {
          min: formatPrice(0),
          max: formatPrice(listAmount),
        })
      : recorded !== null && recorded < listAmount
        ? label("boosts.booking.comped", "{amount} comped", {
            amount: formatPrice(listAmount - recorded),
          })
        : label("boosts.booking.sameAsFullPrice", "Same as the full price");
    body = (
      <div className="grid gap-6 md:grid-cols-[300px_minmax(0,1fr)] md:items-start">
        <BookingSummary
          productName={product.name}
          productImage={product.image}
          storeName={product.storeName}
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
              value: `${formatPrice(rung.pricePerDay)} × ${selection.days} = ${formatPrice(listAmount)}`,
            },
          ]}
        />
        <div className="min-w-0 space-y-5">
          <section aria-labelledby={amountLabelId} className="space-y-2">
            <h3 id={amountLabelId} className="text-sm font-medium">
              {label("boosts.booking.amountReceived", "Amount received")}
            </h3>
            <div
              role="radiogroup"
              aria-labelledby={amountLabelId}
              className="overflow-hidden rounded-2xl border bg-card"
            >
              {options.map((option, index) => {
                const active = amountMode === option.key;
                return (
                  <div
                    key={option.key}
                    className={cn(
                      index > 0 && "border-t border-border/60",
                      active && "bg-primary/5",
                    )}
                  >
                    <button
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setAmountMode(option.key)}
                      className={cn(
                        "flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors",
                        !active && "hover:bg-muted/50",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "size-[18px] shrink-0 rounded-full border-[1.5px] bg-card",
                          active ? "border-[5px] border-primary" : "border-muted-foreground/40",
                        )}
                      />
                      <span className="flex-1 text-sm font-medium">{option.title}</span>
                      {option.value ? (
                        <span className="text-sm font-semibold">{option.value}</span>
                      ) : null}
                    </button>
                    {option.key === "part" && active ? (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pr-3.5 pb-3 pl-11">
                        <CurrencyInput
                          autoFocus
                          aria-label={label("boosts.booking.amountYouReceived", "Amount you received")}
                          className="h-9 w-36 bg-card"
                          currencySymbol={currency.symbol}
                          value={partAmount}
                          onChange={(event) => setPartAmount(event.target.value)}
                          min={0}
                          max={listAmount}
                        />
                        <span
                          className={cn(
                            "text-xs",
                            !partValid && partText !== ""
                              ? "text-destructive"
                              : "text-muted-foreground",
                          )}
                        >
                          {partHint}
                        </span>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
          <div className="space-y-2">
            <Label htmlFor="manual-boost-note">
              {label("boosts.booking.note", "Note")}{" "}
              <span className="font-normal text-muted-foreground">
                ({label("boosts.booking.optional", "optional")})
              </span>
            </Label>
            <Input
              id="manual-boost-note"
              className="h-10 bg-card"
              maxLength={200}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={label("boosts.booking.notePlaceholder", "Bank transfer ID, receipt number…")}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {label(
              "boosts.booking.bookedAtOnce",
              "The days are booked as soon as you create it — nobody else can buy them.",
            )}
          </p>
        </div>
      </div>
    );
    footer = (
      <BookingFooter
        secondary={{
          label: label("common.back", "Back"),
          onClick: () => setStep("slot"),
          disabled: isSaving,
        }}
        total={{
          label: label("boosts.booking.recordedAsPaid", "Recorded as paid"),
          value: recorded !== null ? formatPrice(recorded) : "—",
        }}
        primary={{
          label: label("boosts.admin.createConfirm", "Create booking"),
          onClick: handleCreate,
          disabled: isSaving || !slotReady || recorded === null,
          busy: isSaving,
        }}
      />
    );
  }

  return (
    <BookingDialogFrame
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={label("boosts.admin.create", "Create booking")}
      badge={label("boosts.booking.offlinePayment", "Offline payment")}
      description={label(
        "boosts.admin.createDescription",
        "For payments collected outside the gateways, or to comp a placement. The days are booked immediately and cannot be sold to anyone else.",
      )}
      stepper={
        <BookingStepper
          steps={steps}
          current={step}
          onStepClick={(key) => setStep(key as Step)}
        />
      }
      footer={footer}
    >
      {body}
    </BookingDialogFrame>
  );
}
