"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { DateRange } from "react-day-picker";
import {
  Ban,
  Loader2,
  Pause,
  Play,
  Plus,
  Receipt,
  Rocket,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { CurrencyInput } from "@/components/ui/currency-input";
import {
  DataTable,
  type DataTableAction,
  type DataTableColumn,
  type DataTableTab,
} from "@/components/ui/data-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { toast } from "@/components/ui/toast-notification";
import { ApiClientError, apiClient } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { useCurrency, useCurrencyFormatter } from "@/providers/currency-provider";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { buildAdminCommerceTableHeader } from "@/components/admin/admin-commerce-table-header";
import {
  BoostProductCell,
  BoostStatusBadge,
  BoostWindowCell,
  RowAmount,
  boostCtr,
} from "@/components/vendor/boosts-content";
import {
  addDays,
  calendarDateFromUtcDay,
  daysBetweenInclusive,
  enumerateDays,
  utcDayFromCalendarDate,
} from "@/lib/boosts/boost-days";
import { quantizeToCurrency } from "@/lib/intl/money";
import type { BoostCampaignListRow } from "@/lib/boosts/boost-campaign-list";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

const API_BASE = "/api/admin/boosts/campaigns";
/** The manual form books inside the same window the admin strip shows. */
const MANUAL_HORIZON_DAYS = 90;

/**
 * The admin list endpoints answer with the paginated envelope, so `apiClient`
 * unwraps `{ success, data }` down to `{ data: rows, pagination }` — the rows
 * are one level deeper than a plain `successResponse`.
 */
interface PagedRows<T> {
  data?: T[];
}

interface VendorOption {
  _id: string;
  storeName?: string;
}

interface ProductOption {
  _id: string;
  name?: string;
  images?: string[];
}

interface PositionOption {
  _id: string;
  position: number;
  label?: string;
  pricePerDay: number;
  currency?: string;
  status?: string;
}

interface AdminAvailability {
  from: string;
  to: string;
  today: string;
  positions: Array<{
    position: number;
    days: Array<{ day: string; store: string; product: string }>;
  }>;
}

/**
 * Admin moderation view over every vendor's boost campaigns, plus the manual
 * (offline-payment) booking flow — the admin recording a booking IS the payment
 * verification, so it is paid the moment it is created.
 */
export function BoostCampaignsContent(props: {
  locale: string;
  data: BoostCampaignListRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}) {
  const t = useTranslations();
  const router = useRouter();
  const { confirm } = useConfirmation();
  const label = useFallbackTranslator(t);

  const list = useListNavigation<BoostCampaignListRow>({
    items: props.data,
    pagination: props.pagination,
  });

  const [actioningId, setActioningId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const runAction = useCallback(
    async (
      row: BoostCampaignListRow,
      action: "pause" | "resume" | "cancel" | "mark_refunded",
    ) => {
      if (action === "cancel") {
        const confirmed = await confirm({
          title: label("boosts.admin.cancelTitle", "Cancel booking"),
          description: label(
            "boosts.admin.cancelDescription",
            // Materially different from the flat-fee model: the days are
            // inventory, and they go straight back on sale. An admin who
            // cancels expecting a reversible pause would find the rung resold.
            "Every booked day from tomorrow onward is released back to the calendar immediately and can be resold. Days already run stay billed; anything released is added to the vendor's credit for you to refund at the gateway.",
          ),
          confirmText: label("common.confirm", "Confirm"),
          cancelText: label("common.cancel", "Cancel"),
          variant: "destructive",
        });
        if (!confirmed) return;
      }
      if (action === "mark_refunded") {
        const confirmed = await confirm({
          title: label("boosts.admin.markRefundedTitle", "Mark as refunded"),
          description: label(
            "boosts.admin.markRefundedDescription",
            "Records that you have already refunded the outstanding credit at the payment provider. This only updates the ledger — it does not move any money.",
          ),
          confirmText: label("common.confirm", "Confirm"),
          cancelText: label("common.cancel", "Cancel"),
        });
        if (!confirmed) return;
      }
      setActioningId(row._id);
      try {
        await apiClient.patch(`${API_BASE}/${row._id}`, { action });
        toast.success(label("boosts.admin.updated", "Campaign updated"));
        router.refresh();
      } catch (error) {
        // A resume can lose the days it is trying to take back; the route
        // answers with them, and the admin has to tell the vendor which.
        const days =
          error instanceof ApiClientError
            ? ((error.details as { conflictDays?: string[] } | undefined)
                ?.conflictDays ?? [])
            : [];
        toast.error(
          days.length > 0
            ? `${error instanceof Error ? error.message : ""}`.trim() ||
                days.join(", ")
            : error instanceof Error
              ? error.message
              : label("boosts.admin.updateFailed", "Failed to update campaign"),
        );
      } finally {
        setActioningId(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [confirm, router, t],
  );

  const columns = useMemo<DataTableColumn<BoostCampaignListRow>[]>(
    () => [
      {
        id: "product",
        header: label("boosts.table.product", "Product"),
        cell: (row) => <BoostProductCell row={row} />,
        className: "w-[240px]",
      },
      {
        id: "position",
        header: label("boosts.table.position", "Slot"),
        cell: (row) => (
          <span className="font-semibold">
            #{row.positionSnapshot.position}
          </span>
        ),
        className: "w-[70px]",
      },
      {
        id: "vendor",
        header: label("boosts.table.vendor", "Vendor"),
        cell: (row) => (
          <span className="truncate">{row.vendor?.storeName || "—"}</span>
        ),
        className: "w-[150px]",
      },
      {
        id: "amount",
        header: label("boosts.table.price", "Price"),
        cell: (row) => <RowAmount row={row} />,
        className: "w-[130px]",
      },
      {
        id: "status",
        header: label("boosts.table.status", "Status"),
        cell: (row) => <BoostStatusBadge status={row.status} />,
        className: "w-[130px]",
      },
      {
        id: "window",
        header: label("boosts.table.window", "Runs"),
        cell: (row) => <BoostWindowCell row={row} locale={props.locale} />,
        className: "w-[160px]",
      },
      {
        id: "impressions",
        header: label("boosts.table.impressions", "Impressions"),
        cell: (row) => row.totalImpressions.toLocaleString(),
        className: "w-[110px]",
      },
      {
        id: "ctr",
        header: label("boosts.table.ctr", "CTR"),
        cell: (row) => boostCtr(row),
        className: "w-[80px]",
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.locale, t],
  );

  const rowActions = useCallback(
    (row: BoostCampaignListRow): DataTableAction[] => {
      const actions: DataTableAction[] = [];
      // Pause is an ACTIVE-only verb: a scheduled booking has nothing to stop,
      // and pausing it would release days the vendor has already paid for.
      if (row.status === "active") {
        actions.push({
          id: "pause",
          label: label("boosts.admin.pause", "Pause"),
          icon: <Pause className="h-4 w-4" />,
          onClick: () => runAction(row, "pause"),
          disabled: actioningId === row._id,
        });
      }
      if (row.status === "paused") {
        actions.push({
          id: "resume",
          label: label("boosts.admin.resume", "Resume"),
          icon: <Play className="h-4 w-4" />,
          onClick: () => runAction(row, "resume"),
          disabled: actioningId === row._id,
        });
      }
      // The only path that clears an outstanding obligation. For a manual
      // booking it is the ONLY path — there is no gateway webhook behind it.
      if (row.refundableAmount > 0) {
        actions.push({
          id: "mark-refunded",
          label: label("boosts.admin.markRefunded", "Mark refunded"),
          icon: <Receipt className="h-4 w-4" />,
          onClick: () => runAction(row, "mark_refunded"),
          disabled: actioningId === row._id,
        });
      }
      if (
        ["scheduled", "active", "paused", "pending_payment"].includes(
          row.status,
        )
      ) {
        actions.push({
          id: "cancel",
          label: label("boosts.admin.cancel", "Cancel"),
          icon: <Ban className="h-4 w-4 text-destructive" />,
          onClick: () => runAction(row, "cancel"),
          variant: "destructive",
          disabled: actioningId === row._id,
        });
      }
      return actions;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [actioningId, runAction, t],
  );

  const tabs = useMemo<DataTableTab[]>(
    () => [
      { id: "all", label: label("boosts.tabs.all", "All") },
      { id: "scheduled", label: label("boosts.tabs.scheduled", "Upcoming") },
      { id: "active", label: label("boosts.tabs.active", "Active") },
      { id: "paused", label: label("boosts.tabs.paused", "Paused") },
      {
        id: "pending_payment",
        label: label("boosts.tabs.pending", "Pending payment"),
      },
      { id: "expired", label: label("boosts.tabs.expired", "Expired") },
      { id: "canceled", label: label("boosts.tabs.canceled", "Canceled") },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t],
  );

  const tableHeader = useMemo(
    () =>
      buildAdminCommerceTableHeader({
        title: label("boosts.admin.title", "Boost campaigns"),
        addAction: {
          id: "create-boost",
          label: label("boosts.admin.create", "Create booking"),
          icon: <Plus className="h-4 w-4" />,
          variant: "default",
          onClick: () => setCreateOpen(true),
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t],
  );

  return (
    <>
      <DataTable
        data={list.items}
        columns={columns}
        keyField="_id"
        isLoading={list.isLoading}
        loadingMode="rows"
        title={tableHeader.title}
        tabs={tabs}
        activeTab={list.activeTab}
        onTabChange={list.handleTabChange}
        actions={tableHeader.actions}
        searchable
        searchPlaceholder={label(
          "boosts.searchPlaceholder",
          "Search by position or label",
        )}
        searchValue={list.search}
        onSearchChange={list.handleSearchChange}
        toolbarActions={tableHeader.toolbarActions}
        toolbarLayout={tableHeader.toolbarLayout}
        tabsVariant={tableHeader.tabsVariant}
        filtersVariant={tableHeader.filtersVariant}
        appearance={tableHeader.appearance}
        stackedTopControls={tableHeader.stackedTopControls}
        showToolbarSortButton={tableHeader.showToolbarSortButton}
        pagination={list.pagination}
        onPageChange={list.handlePageChange}
        onPageSizeChange={list.handlePageSizeChange}
        rowActions={rowActions}
        rowActionsHeader={label("boosts.table.actions", "Actions")}
        rowActionsVariant="inline"
        emptyMessage={label("boosts.admin.empty", "No boost campaigns yet")}
        emptyIcon={<Rocket className="h-8 w-8" />}
      />
      <ManualBoostDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          setCreateOpen(false);
          router.refresh();
        }}
      />
    </>
  );
}

/**
 * Offline-payment booking: vendor → product → rung → dates.
 *
 * The admin is recording money collected outside the gateways (bank transfer,
 * cash) or comping a placement outright, so the footer spells out the amount
 * being marked as paid. It goes through the same insert-or-409 as a vendor
 * checkout — there is no admin bypass of the {position, day} index, because a
 * bypass is a double-sell.
 */
function ManualBoostDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const t = useTranslations();
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
  const formatPrice = useCurrencyFormatter();
  const { currency } = useCurrency();

  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [positions, setPositions] = useState<PositionOption[]>([]);
  const [availability, setAvailability] = useState<AdminAvailability | null>(
    null,
  );
  const [vendorId, setVendorId] = useState("");
  const [productId, setProductId] = useState("");
  const [position, setPosition] = useState<number | null>(null);
  const [range, setRange] = useState<DateRange | undefined>();
  const [override, setOverride] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isProductsLoading, setIsProductsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [conflictNote, setConflictNote] = useState<string | null>(null);

  const selectedPosition = useMemo(
    () => positions.find((row) => row.position === position) ?? null,
    [positions, position],
  );

  const today = availability?.today ?? new Date().toISOString().slice(0, 10);
  const horizonEnd = addDays(today, MANUAL_HORIZON_DAYS);

  const takenDays = useMemo(() => {
    const forPosition = availability?.positions.find(
      (row) => row.position === position,
    );
    return new Set((forPosition?.days ?? []).map((d) => d.day));
  }, [availability, position]);

  const holderByDay = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of availability?.positions ?? []) {
      if (row.position !== position) continue;
      for (const d of row.days) {
        map.set(d.day, [d.store, d.product].filter(Boolean).join(" — "));
      }
    }
    return map;
  }, [availability, position]);

  const selection = useMemo(() => {
    if (!range?.from || !range.to) return null;
    const a = utcDayFromCalendarDate(range.from);
    const b = utcDayFromCalendarDate(range.to);
    const startDay = a <= b ? a : b;
    const endDay = a <= b ? b : a;
    return { startDay, endDay, days: daysBetweenInclusive(startDay, endDay) };
  }, [range]);

  const listAmount = useMemo(() => {
    if (!selection || !selectedPosition) return null;
    return quantizeToCurrency(
      selectedPosition.pricePerDay * selection.days,
      currency.code,
    );
  }, [selection, selectedPosition, currency.code]);

  const overrideAmount = override.trim() === "" ? null : Number(override);
  const chargedAmount =
    overrideAmount !== null && Number.isFinite(overrideAmount)
      ? Math.min(overrideAmount, listAmount ?? 0)
      : listAmount;

  useApplyOnChange([props.open], () => {
    if (!props.open) return;
    setVendorId("");
    setProductId("");
    setPosition(null);
    setRange(undefined);
    setOverride("");
    setProductSearch("");
    setConflictNote(null);
    setIsLoading(true);
  });

  useEffect(() => {
    if (!props.open) return;
    let cancelled = false;
    Promise.all([
      apiClient.get<PagedRows<VendorOption>>(
        "/api/admin/vendors?status=approved&limit=100",
      ),
      apiClient.get<PositionOption[]>("/api/admin/boosts/positions"),
      apiClient.get<AdminAvailability>("/api/admin/boosts/availability", {
        query: {
          from: new Date().toISOString().slice(0, 10),
          to: addDays(new Date().toISOString().slice(0, 10), MANUAL_HORIZON_DAYS),
        },
      }),
    ])
      .then(([vendorsResult, positionsResult, availabilityResult]) => {
        if (cancelled) return;
        setVendors(vendorsResult?.data ?? []);
        setPositions(
          (positionsResult ?? []).filter((row) => row.status !== "archived"),
        );
        setAvailability(availabilityResult);
      })
      .catch((error) => {
        if (cancelled) return;
        toast.error(
          error instanceof Error
            ? error.message
            : label(
                "boosts.admin.loadFailed",
                "Failed to load vendors and positions",
              ),
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

  // A product picked under the previous vendor would fail the server's
  // "product belongs to this vendor" check, so switching vendor clears the step.
  const handleVendorChange = (nextVendorId: string) => {
    setVendorId(nextVendorId);
    setProducts([]);
    setProductId("");
    setProductSearch("");
  };

  useApplyOnChange([props.open, vendorId, productSearch], () => {
    if (props.open && vendorId) setIsProductsLoading(true);
  });

  useEffect(() => {
    if (!props.open || !vendorId) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        vendor: vendorId,
        status: "active",
        limit: "10",
      });
      if (productSearch.trim()) params.set("search", productSearch.trim());
      apiClient
        .get<PagedRows<ProductOption>>(
          `/api/admin/products?${params.toString()}`,
        )
        .then((result) => {
          if (!cancelled) setProducts(result?.data ?? []);
        })
        .catch((error) => {
          if (cancelled) return;
          setProducts([]);
          toast.error(
            error instanceof Error
              ? error.message
              : label(
                  "boosts.admin.loadProductsFailed",
                  "Failed to load products",
                ),
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
  }, [props.open, vendorId, productSearch]);

  // Switching rungs re-derives the taken set from the loaded payload, so a
  // draft that now overlaps a sold day is dropped rather than refused on save.
  useApplyOnChange([takenDays, selection, label], () => {
    if (!selection) return;
    const clash = enumerateDays(selection.startDay, selection.endDay).some(
      (day) => takenDays.has(day),
    );
    if (!clash) return;
    setRange(undefined);
    setConflictNote(
      label(
        "boosts.purchase.conflictInline",
        "Those dates aren't free at this position — pick again.",
      ),
    );
  });

  const handleCreate = async () => {
    if (!vendorId || !productId || !selectedPosition || !selection) return;
    setIsSaving(true);
    try {
      await apiClient.post(API_BASE, {
        vendorId,
        productId,
        position: selectedPosition.position,
        startDay: selection.startDay,
        endDay: selection.endDay,
        ...(overrideAmount !== null && Number.isFinite(overrideAmount)
          ? { amountOverride: overrideAmount }
          : {}),
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
      const days = [
        ...(details?.conflictDays ?? []),
        ...(details?.productConflictDays ?? []),
      ];
      if (days.length > 0) {
        setRange(undefined);
        setConflictNote(
          label(
            "boosts.purchase.slotTaken",
            "Someone just booked {days} at this position.",
            { days: days.join(", ") },
          ),
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

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="scrollbar-visible max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5 shrink-0 text-primary" />
            {label(
              "boosts.admin.createTitle",
              "Create booking (offline payment)",
            )}
          </DialogTitle>
          <DialogDescription>
            {label(
              "boosts.admin.createDescription",
              "For payments collected outside the gateways, or to comp a placement. The days are booked immediately and cannot be sold to anyone else.",
            )}
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          // `min-w-0`: DialogContent is a grid, so this item's auto min-width
          // would otherwise grow to the longest product name and push the
          // controls out through the dialog's right edge.
          <div className="min-w-0 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="manual-boost-vendor">
                {label("boosts.admin.vendor", "Vendor")}
              </Label>
              <NativeSelect
                id="manual-boost-vendor"
                className="w-full"
                value={vendorId}
                onChange={(e) => handleVendorChange(e.target.value)}
              >
                <option value="">
                  {label("boosts.admin.selectVendor", "Select a vendor…")}
                </option>
                {vendors.map((vendor) => (
                  <option key={vendor._id} value={vendor._id}>
                    {vendor.storeName || vendor._id}
                  </option>
                ))}
              </NativeSelect>
            </div>

            <div className="space-y-2">
              <Label>{label("boosts.admin.product", "Product")}</Label>
              {!vendorId ? (
                <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
                  {label(
                    "boosts.admin.selectVendorFirst",
                    "Pick a vendor to see their products",
                  )}
                </p>
              ) : (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="pl-9"
                      placeholder={label(
                        "boosts.admin.searchProducts",
                        "Search products…",
                      )}
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                    />
                  </div>
                  {/* Stable gutter: searching shrinks the list past the scroll
                      threshold, and the rows would jog sideways without it. */}
                  <div className="scrollbar-visible max-h-56 space-y-1 overflow-y-auto scrollbar-gutter-stable rounded-lg border p-1">
                    {isProductsLoading ? (
                      <div className="flex justify-center py-8">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : products.length === 0 ? (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        {label(
                          "boosts.purchase.noProducts",
                          "No active products found",
                        )}
                      </p>
                    ) : (
                      products.map((product) => (
                        <button
                          key={product._id}
                          type="button"
                          onClick={() => setProductId(product._id)}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-md p-2 text-left transition-colors",
                            productId === product._id
                              ? "bg-primary/5 ring-1 ring-primary"
                              : "hover:bg-muted/50",
                          )}
                        >
                          {product.images?.[0] ? (
                            <Image
                              src={product.images[0]}
                              alt=""
                              width={36}
                              height={36}
                              className="h-9 w-9 shrink-0 rounded-md object-cover"
                            />
                          ) : (
                            <div className="h-9 w-9 shrink-0 rounded-md bg-muted" />
                          )}
                          <span className="min-w-0 truncate text-sm font-medium">
                            {product.name}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div className="space-y-2">
                <Label>{label("boosts.admin.position", "Position")}</Label>
                {positions.length === 0 ? (
                  <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
                    {label(
                      "boosts.purchase.noPositions",
                      "No sponsored positions are on sale yet",
                    )}
                  </p>
                ) : (
                  <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
                    {positions.map((row) => (
                      <button
                        key={row._id}
                        type="button"
                        onClick={() => {
                          setPosition(row.position);
                          setConflictNote(null);
                        }}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg border p-2.5 text-left transition-colors",
                          position === row.position
                            ? "border-primary bg-primary/5"
                            : "hover:bg-muted/50",
                        )}
                      >
                        <span className="flex h-6 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-bold">
                          #{row.position}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {row.label}
                        </span>
                        <span className="shrink-0 text-xs font-semibold">
                          {formatPrice(row.pricePerDay)}
                          <span className="font-normal text-muted-foreground">
                            {label("boosts.purchase.perDay", "/day")}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label>{label("boosts.admin.dates", "Dates (UTC)")}</Label>
                {position === null ? (
                  <div className="flex min-h-72 w-70.5 items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                    {label(
                      "boosts.purchase.pickPositionFirst",
                      "Pick a position to see which days are free.",
                    )}
                  </div>
                ) : (
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
                    excludeDisabled
                    min={1}
                    startMonth={calendarDateFromUtcDay(today)}
                    endMonth={calendarDateFromUtcDay(horizonEnd)}
                    disabled={[
                      { before: calendarDateFromUtcDay(today) },
                      { after: calendarDateFromUtcDay(horizonEnd) },
                      ...[...takenDays].map(calendarDateFromUtcDay),
                    ]}
                    modifiers={{
                      taken: [...takenDays].map(calendarDateFromUtcDay),
                    }}
                    modifiersClassNames={{ taken: "line-through" }}
                  />
                )}
              </div>
            </div>

            {conflictNote ? (
              <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2.5 text-xs text-destructive">
                {conflictNote}
              </p>
            ) : null}

            {/* Who holds the rung right now — the admin twin of the vendor
                calendar carries identity, which is the reason it exists. */}
            {position !== null && holderByDay.size > 0 ? (
              <p className="text-xs text-muted-foreground">
                {label("boosts.admin.heldBy", "Booked on this position:")}{" "}
                {[...holderByDay.entries()]
                  .slice(0, 4)
                  .map(([day, holder]) => `${day} (${holder})`)
                  .join(" · ")}
                {holderByDay.size > 4 ? " …" : ""}
              </p>
            ) : null}

            {listAmount !== null ? (
              <div className="space-y-2">
                <Label htmlFor="manual-boost-amount">
                  {label("boosts.admin.amountOverride", "Amount to record")}
                </Label>
                <CurrencyInput
                  id="manual-boost-amount"
                  currencySymbol={currency.symbol}
                  value={override}
                  onChange={(e) => setOverride(e.target.value)}
                  placeholder={String(listAmount)}
                  min={0}
                  max={listAmount}
                />
                <p className="text-xs text-muted-foreground">
                  {label(
                    "boosts.admin.amountOverrideHint",
                    "Leave blank to charge the list price of {amount}. A lower figure comps the difference; 0 makes it free. It cannot exceed the list price.",
                    { amount: formatPrice(listAmount) },
                  )}
                </p>
              </div>
            ) : null}
          </div>
        )}
        <DialogFooter className="flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {selection && selectedPosition && chargedAmount !== null ? (
            <p className="text-sm text-muted-foreground">
              {label(
                "boosts.admin.recordingBooking",
                "Position {position} · {days} days · recording {amount} as paid",
                {
                  position: selectedPosition.position,
                  days: selection.days,
                  amount: formatPrice(chargedAmount),
                },
              )}
            </p>
          ) : (
            <span className="hidden sm:block" />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              variant="outline"
              onClick={() => props.onOpenChange(false)}
              disabled={isSaving}
            >
              {label("common.cancel", "Cancel")}
            </Button>
            <Button
              onClick={handleCreate}
              disabled={
                isSaving ||
                !vendorId ||
                !productId ||
                !selectedPosition ||
                !selection
              }
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {label("boosts.admin.createConfirm", "Create booking")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
