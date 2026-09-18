"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Loader2, Plus, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTablePagination } from "@/components/ui/data-table";
import { toast } from "@/components/ui/toast-notification";
import { AdminFormStickyHeader } from "@/components/admin/admin-form-sticky-header";
import { useDebounce } from "@/hooks/use-debounce";
import { apiClient } from "@/lib/api/client";
import { createRequestAbort } from "@/lib/request-abort";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";
import { TransferCreateSkeleton } from "@/components/admin/transfers/transfer-create-skeleton";
import {
  TRANSFER_TABLE_CLASS,
  TRANSFER_TD_CLASS,
  TRANSFER_TH_CLASS,
  transferPaths,
  type TransferArea,
} from "@/components/admin/transfers/transfer-paths";

interface LocationItem {
  _id: string;
  name: string;
}

interface CatalogItem {
  productId: string;
  variantId: string;
  productTitle: string;
  variantTitle: string;
  sku: string;
  availableAtSource: number;
  availableAtDestination?: number;
}

interface SelectedLine {
  row: CatalogItem;
  qty: number;
  /** The destination `row.availableAtDestination` was read for. */
  destinationId: string;
}

interface DraftTransfer {
  _id: string;
  status: string;
  fromLocationId: string;
  toLocationId: string;
  reference?: string;
  note?: string;
  items: Array<{
    productId: string;
    variantId: string;
    productTitle: string;
    variantTitle?: string;
    sku?: string;
    quantity: number;
    availableAtSource?: number;
  }>;
}

type ItemsView = "all" | "selected";

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

const lineKey = (line: { productId: string; variantId: string }) =>
  `${line.productId}:${line.variantId}`;

/**
 * Creates a transfer, or — given `transferId` — edits a draft one. Both save the
 * same fields; only a draft can be edited, because once a transfer is ready to
 * ship its lines are what the warehouse is picking.
 */
export function TransferCreateForm({
  locale,
  transferId,
  area = "admin",
}: {
  locale: string;
  transferId?: string;
  area?: TransferArea;
}) {
  const isEdit = Boolean(transferId);
  const paths = transferPaths(area, locale);
  const t = useTranslations();
  const router = useRouter();
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [fromLocationId, setFromLocationId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<ItemsView>("all");
  const [pageSize, setPageSize] = useState(20);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [selectedPage, setSelectedPage] = useState(1);
  // Chosen lines live apart from the catalog page on screen, so paging or
  // searching never drops a quantity already entered for another product.
  const [selected, setSelected] = useState<Record<string, SelectedLine>>({});
  const [loadingDraft, setLoadingDraft] = useState(isEdit);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [locationTarget, setLocationTarget] = useState<"from" | "to">("from");
  const [newLocationName, setNewLocationName] = useState("");
  const [newLocationAddress, setNewLocationAddress] = useState("");
  const [creatingLocation, setCreatingLocation] = useState(false);

  const loadLocations = useCallback(
    () =>
      fetch(paths.locations)
        .then((res) => res.json())
        .then((json) => {
          if (!json.success) return;
          const rows = Array.isArray(json.data) ? json.data : [];
          setLocations(
            rows.map((row: { _id: string; name: string }) => ({
              _id: String(row._id),
              name: row.name,
            })),
          );
        })
        .catch(() => {
          toast.error(t("admin.transfers.create.toasts.loadLocationsError"));
        }),
    [paths.locations, t],
  );

  useEffect(() => {
    void loadLocations();
  }, [loadLocations]);

  useEffect(() => {
    if (!transferId) return;
    apiClient
      .get<{ transfer: DraftTransfer | null }>(
        `${paths.api}/${transferId}`,
      )
      .then((data) => {
        const draft = data?.transfer;
        if (!draft || draft.status !== "draft") {
          toast.error(t("admin.transfers.edit.toasts.notDraft"));
          router.replace(`${paths.page}/${transferId}`);
          return;
        }
        setFromLocationId(draft.fromLocationId);
        setToLocationId(draft.toLocationId);
        setReference(draft.reference || "");
        setNote(draft.note || "");
        setSelected(
          Object.fromEntries(
            draft.items.map((item) => [
              lineKey(item),
              {
                qty: item.quantity,
                // Destination stock is unknown until the catalog page that
                // holds this line is loaded.
                destinationId: "",
                row: {
                  productId: item.productId,
                  variantId: item.variantId,
                  productTitle: item.productTitle,
                  variantTitle: item.variantTitle || "",
                  sku: item.sku || "",
                  availableAtSource: item.availableAtSource ?? 0,
                },
              },
            ]),
          ),
        );
        setLoadingDraft(false);
      })
      .catch((error) => {
        toast.error(
          error instanceof Error
            ? error.message
            : t("admin.transfers.details.toasts.loadError"),
        );
        router.replace(paths.page);
      });
  }, [transferId, paths.api, paths.page, router, t]);

  const changeSourceLocation = (locationId: string) => {
    setFromLocationId(locationId);
    // Quantities were checked against the old source's stock.
    setSelected({});
  };

  const swapLocations = () => {
    const previousSource = fromLocationId;
    changeSourceLocation(toLocationId);
    setToLocationId(previousSource);
  };

  // Each lookup runs an unindexed regex scan over the catalog, so wait for the
  // typing to settle first — 400ms is what the admin list tables use.
  const debouncedSearch = useDebounce(search, 400);

  useApplyOnChange([fromLocationId, debouncedSearch, pageSize], () => {
    setCatalogPage(1);
    setSelectedPage(1);
    if (!fromLocationId) {
      setCatalog([]);
      setCatalogTotal(0);
    }
  });

  useApplyOnChange(
    [fromLocationId, toLocationId, debouncedSearch, pageSize, catalogPage],
    () => {
      setLoadingCatalog(Boolean(fromLocationId));
    },
  );

  useEffect(() => {
    if (!fromLocationId) return;

    const request = createRequestAbort("Transfer catalog lookup");
    const run = async () => {
      try {
        const data = await apiClient.get<{ items?: CatalogItem[]; total?: number }>(
          paths.catalog,
          {
            query: {
              fromLocationId,
              toLocationId,
              search: debouncedSearch.trim(),
              page: String(catalogPage),
              limit: String(pageSize),
            },
            signal: request.signal,
          },
        );
        if (request.signal.aborted) return;
        const rows = Array.isArray(data?.items) ? data.items : [];
        setCatalog(rows);
        setCatalogTotal(Number(data?.total) || 0);
        // Chosen lines on this page pick up the fresh stock figures, so the
        // Selected view shows the same numbers as the row it came from.
        const fresh = new Map(rows.map((row) => [lineKey(row), row]));
        setSelected((prev) => {
          if (!Object.keys(prev).some((key) => fresh.has(key))) return prev;
          const next = { ...prev };
          for (const [key, line] of Object.entries(prev)) {
            const row = fresh.get(key);
            if (row) next[key] = { ...line, row, destinationId: toLocationId };
          }
          return next;
        });
      } catch {
        // Aborted (superseded) or failed lookups leave the rows that are on
        // screen alone; a newer run owns the state by then.
      } finally {
        if (!request.signal.aborted) setLoadingCatalog(false);
      }
    };

    void run().finally(request.settle);
    return request.cancel;
  }, [
    fromLocationId,
    toLocationId,
    debouncedSearch,
    catalogPage,
    pageSize,
    paths.catalog,
  ]);

  const setLineQty = (row: CatalogItem, qty: number) => {
    const key = lineKey(row);
    setSelected((prev) => {
      const next = { ...prev };
      if (qty > 0) {
        next[key] = {
          row,
          qty,
          destinationId:
            row.availableAtDestination === undefined
              ? prev[key]?.destinationId ?? ""
              : toLocationId,
        };
      } else {
        delete next[key];
      }
      return next;
    });
  };

  const selectedItems = useMemo(
    () =>
      Object.entries(selected)
        .map(([key, entry]) => ({
          key,
          item: entry.row,
          destinationId: entry.destinationId,
          qty: Math.max(0, Number(entry.qty || 0)),
        }))
        .filter((entry) => entry.qty > 0),
    [selected],
  );

  const selectedUnits = selectedItems.reduce((sum, entry) => sum + entry.qty, 0);
  const overStockCount = selectedItems.filter(
    (entry) => entry.qty > entry.item.availableAtSource,
  ).length;

  // The Selected view pages through the chosen lines on the client, filtered
  // by the same search box, in the catalog's product order.
  const selectedRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return selectedItems
      .filter(
        ({ item }) =>
          !term ||
          item.productTitle.toLowerCase().includes(term) ||
          item.variantTitle.toLowerCase().includes(term) ||
          item.sku.toLowerCase().includes(term),
      )
      .sort(
        (a, b) =>
          a.item.productTitle.localeCompare(b.item.productTitle) ||
          a.key.localeCompare(b.key),
      );
  }, [selectedItems, search]);

  const total = view === "all" ? catalogTotal : selectedRows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(view === "all" ? catalogPage : selectedPage, totalPages);

  const tableRows: Array<{ row: CatalogItem; destination?: number }> =
    view === "all"
      ? catalog.map((row) => ({ row, destination: row.availableAtDestination }))
      : selectedRows
          .slice((page - 1) * pageSize, page * pageSize)
          .map((entry) => ({
            row: entry.item,
            destination:
              toLocationId && entry.destinationId === toLocationId
                ? entry.item.availableAtDestination
                : undefined,
          }));

  const locationName = (id: string) =>
    locations.find((location) => location._id === id)?.name;
  const fromName = locationName(fromLocationId);
  const toName = locationName(toLocationId);

  const handleCreate = async () => {
    if (!fromLocationId || !toLocationId) {
      toast.error(t("admin.transfers.create.toasts.selectBothLocations"));
      return;
    }

    if (fromLocationId === toLocationId) {
      toast.error(t("admin.transfers.create.toasts.locationsMustDiffer"));
      return;
    }

    if (!selectedItems.length) {
      toast.error(t("admin.transfers.create.toasts.selectItems"));
      return;
    }

    setSaving(true);
    try {
      const payload = {
        fromLocationId,
        toLocationId,
        reference,
        note,
        items: selectedItems.map((entry) => ({
          productId: entry.item.productId,
          variantId: entry.item.variantId,
          quantity: entry.qty,
          productTitle: entry.item.productTitle,
          variantTitle: entry.item.variantTitle,
          sku: entry.item.sku,
        })),
      };

      if (transferId) {
        await apiClient.patch(`${paths.api}/${transferId}`, {
          action: "update_details",
          ...payload,
        });
        toast.success(t("admin.transfers.edit.toasts.saveSuccess"));
        router.push(`${paths.page}/${transferId}`);
        return;
      }

      const res = await fetch(paths.api, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();

      if (!json.success) {
        throw new Error(
          json.message || t("admin.transfers.create.toasts.createError"),
        );
      }

      toast.success(t("admin.transfers.create.toasts.createSuccess"));
      const createdId = json.data?.transferId;
      if (createdId) {
        router.push(`${paths.page}/${createdId}`);
      } else {
        router.push(paths.page);
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t(
              isEdit
                ? "admin.transfers.edit.toasts.saveError"
                : "admin.transfers.create.toasts.createError",
            ),
      );
    } finally {
      setSaving(false);
    }
  };

  const openLocationDialog = (target: "from" | "to") => {
    setLocationTarget(target);
    setNewLocationName("");
    setNewLocationAddress("");
    setLocationDialogOpen(true);
  };

  const handleCreateLocation = async () => {
    if (!newLocationName.trim()) {
      toast.error(t("admin.transfers.create.toasts.locationNameRequired"));
      return;
    }

    setCreatingLocation(true);
    try {
      // The POST answers with the created document, so the dropdown options can
      // be extended from it instead of re-reading the whole list.
      const created = await apiClient.post<LocationItem>(
        paths.locations,
        {
          name: newLocationName.trim(),
          address: newLocationAddress.trim(),
        },
      );

      const createdId = String(created?._id || "");
      if (createdId) {
        setLocations((prev) => [
          ...prev,
          { _id: createdId, name: created.name || newLocationName.trim() },
        ]);
        if (locationTarget === "from") {
          changeSourceLocation(createdId);
        } else {
          setToLocationId(createdId);
        }
      }
      setLocationDialogOpen(false);
      toast.success(t("admin.transfers.create.toasts.createLocationSuccess"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("admin.transfers.create.toasts.createLocationError"),
      );
    } finally {
      setCreatingLocation(false);
    }
  };

  if (loadingDraft) {
    return <TransferCreateSkeleton />;
  }

  const title = t(
    isEdit ? "admin.transfers.edit.title" : "admin.transfers.create.title",
  );
  const backHref = transferId ? `${paths.page}/${transferId}` : paths.page;
  const selectClass =
    "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
  const emptyCellClass = "px-4 py-12 text-center text-muted-foreground";

  const locationField = (target: "from" | "to") => {
    const id = target === "from" ? "from-location" : "to-location";
    return (
      <div className="min-w-0 space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor={id}>
            {t(
              target === "from"
                ? "admin.transfers.create.fromLocation"
                : "admin.transfers.create.toLocation",
            )}
          </Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => openLocationDialog(target)}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            {t("admin.transfers.create.addLocation")}
          </Button>
        </div>
        <select
          id={id}
          value={target === "from" ? fromLocationId : toLocationId}
          onChange={(event) =>
            target === "from"
              ? changeSourceLocation(event.target.value)
              : setToLocationId(event.target.value)
          }
          className={selectClass}
        >
          <option value="">
            {t(
              target === "from"
                ? "admin.transfers.create.selectSourceLocation"
                : "admin.transfers.create.selectDestinationLocation",
            )}
          </option>
          {locations.map((location) => (
            <option key={location._id} value={location._id}>
              {location.name}
            </option>
          ))}
        </select>
      </div>
    );
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <AdminFormStickyHeader
        className="!mx-0 -mt-2 border-b-0 px-0 shadow-none md:px-0"
        title={title}
        description={
          fromName && toName
            ? t("admin.transfers.details.routeSummary", {
                from: fromName,
                to: toName,
              })
            : undefined
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(backHref)}
            >
              {t("admin.transfers.create.cancel")}
            </Button>
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={saving || overStockCount > 0}
              title={
                overStockCount > 0
                  ? t("admin.transfers.create.fixOverStock")
                  : undefined
              }
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              {t(
                isEdit
                  ? "admin.transfers.edit.saveChanges"
                  : "admin.transfers.create.createTransfer",
              )}
              {selectedItems.length > 0 ? (
                <span className="rounded-full bg-primary-foreground/20 px-1.5 text-xs tabular-nums">
                  {selectedItems.length}
                </span>
              ) : null}
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
            {locationField("from")}
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-10 w-10 justify-self-center"
              onClick={swapLocations}
              disabled={!fromLocationId && !toLocationId}
              aria-label={t("admin.transfers.create.swapLocations")}
              title={t("admin.transfers.create.swapLocations")}
            >
              <ArrowLeftRight className="h-4 w-4 rotate-90 md:rotate-0" />
            </Button>
            {locationField("to")}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="reference">
                {t("admin.transfers.create.reference")}
              </Label>
              <Input
                id="reference"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder={t("admin.transfers.create.referencePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="note">
                {t("admin.transfers.create.internalNote")}
              </Label>
              <Textarea
                id="note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={t(
                  "admin.transfers.create.internalNotePlaceholder",
                )}
                className="min-h-10"
                rows={1}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative w-full sm:w-72">
              <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("admin.transfers.create.searchPlaceholder")}
                aria-label={t("admin.transfers.create.searchPlaceholder")}
                className="pl-9"
                disabled={!fromLocationId}
              />
            </div>
            <Tabs
              value={view}
              onValueChange={(next) => {
                setView(next as ItemsView);
                setSelectedPage(1);
              }}
            >
              <TabsList>
                <TabsTrigger value="all" className="px-3">
                  {t("admin.transfers.create.views.all")}
                </TabsTrigger>
                <TabsTrigger value="selected" className="px-3">
                  {t("admin.transfers.create.views.selected", {
                    count: selectedItems.length,
                  })}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            {selectedItems.length > 0 ? (
              <>
                {overStockCount > 0 ? (
                  <span className="text-destructive">
                    {t("admin.transfers.create.overStockCount", {
                      count: overStockCount,
                    })}
                  </span>
                ) : null}
                <span className="tabular-nums">
                  {t("admin.transfers.create.selectionInline", {
                    lines: selectedItems.length,
                    units: selectedUnits,
                  })}
                </span>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0"
                  onClick={() => setSelected({})}
                >
                  {t("admin.transfers.create.clearSelection")}
                </Button>
              </>
            ) : (
              <span>{t("admin.transfers.create.noneSelected")}</span>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className={cn(TRANSFER_TABLE_CLASS, "min-w-[760px]")}>
            <thead className="bg-muted/40">
              <tr className="text-left">
                <th className={cn(TRANSFER_TH_CLASS, "min-w-72")}>
                  {t("admin.transfers.create.columns.product")}
                </th>
                <th className={TRANSFER_TH_CLASS}>
                  {t("admin.transfers.create.columns.sku")}
                </th>
                <th className={cn(TRANSFER_TH_CLASS, "w-36 whitespace-normal text-right")}>
                  {fromName
                    ? t("admin.transfers.create.columns.availableAt", {
                        location: fromName,
                      })
                    : t("admin.transfers.create.columns.available")}
                </th>
                <th className={cn(TRANSFER_TH_CLASS, "w-36 whitespace-normal text-right")}>
                  {toName
                    ? t("admin.transfers.create.columns.onHandAt", {
                        location: toName,
                      })
                    : t("admin.transfers.create.columns.onHand")}
                </th>
                <th className={cn(TRANSFER_TH_CLASS, "text-right")}>
                  {t("admin.transfers.create.columns.transferQty")}
                </th>
              </tr>
            </thead>
            <tbody
              className={cn(
                loadingCatalog && tableRows.length > 0 && "opacity-60",
              )}
            >
              {!fromLocationId ? (
                <tr>
                  <td colSpan={5} className={emptyCellClass}>
                    {t("admin.transfers.create.selectSourceToLoad")}
                  </td>
                </tr>
              ) : loadingCatalog && view === "all" && tableRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className={emptyCellClass}>
                    <Loader2 className="h-5 w-5 animate-spin inline mr-2" />
                    {t("admin.transfers.create.loadingInventory")}
                  </td>
                </tr>
              ) : tableRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className={emptyCellClass}>
                    {t(
                      view === "selected"
                        ? "admin.transfers.create.noSelectedItems"
                        : "admin.transfers.create.noVariants",
                    )}
                  </td>
                </tr>
              ) : (
                tableRows.map(({ row, destination }, index) => {
                  const key = lineKey(row);
                  const qty = selected[key]?.qty ?? 0;
                  const overStock = qty > row.availableAtSource;
                  const showAfter = qty > 0 && !overStock;
                  // Variants of one product sit together; the product name
                  // leads the first of them and the rest show only the variant.
                  const continues =
                    index > 0 && tableRows[index - 1].row.productId === row.productId;
                  return (
                    <tr
                      key={key}
                      className={cn(
                        "border-t",
                        continues && "border-border/40",
                        qty > 0 ? "bg-primary/5" : "hover:bg-muted/20",
                      )}
                    >
                      <td className={cn(TRANSFER_TD_CLASS, continues && "py-2")}>
                        {continues ? (
                          <span className="relative pl-4 text-foreground before:absolute before:left-1 before:-top-2.5 before:h-4 before:w-2 before:rounded-bl before:border-b before:border-l before:border-border before:content-['']">
                            {row.variantTitle}
                          </span>
                        ) : (
                          <>
                            <div className="font-medium text-foreground">
                              {row.productTitle}
                            </div>
                            {row.variantTitle ? (
                              <div className="mt-0.5 text-muted-foreground">
                                {row.variantTitle}
                              </div>
                            ) : null}
                          </>
                        )}
                      </td>
                      <td
                        className={cn(
                          TRANSFER_TD_CLASS,
                          "whitespace-nowrap font-mono text-muted-foreground",
                        )}
                      >
                        {row.sku || "-"}
                      </td>
                      <td className={cn(TRANSFER_TD_CLASS, "text-right tabular-nums")}>
                        <div className="font-medium">{row.availableAtSource}</div>
                        {showAfter ? (
                          <div className="text-muted-foreground">
                            → {row.availableAtSource - qty}
                          </div>
                        ) : null}
                      </td>
                      <td className={cn(TRANSFER_TD_CLASS, "text-right tabular-nums")}>
                        {destination === undefined ? (
                          <span className="text-muted-foreground">-</span>
                        ) : (
                          <>
                            <div
                              className={cn(
                                "font-medium",
                                destination === 0 && "text-muted-foreground",
                              )}
                            >
                              {destination}
                            </div>
                            {showAfter ? (
                              <div className="text-emerald-600 dark:text-emerald-400">
                                → {destination + qty}
                              </div>
                            ) : null}
                          </>
                        )}
                      </td>
                      <td className={cn(TRANSFER_TD_CLASS, "text-right")}>
                        <div className="flex flex-col items-end gap-1">
                          <div className="flex items-center gap-1">
                            <NumberInput
                              min={0}
                              max={row.availableAtSource}
                              step={1}
                              value={selected[key]?.qty}
                              whenEmpty={0}
                              normalize={Math.trunc}
                              onValueChange={(next) => setLineQty(row, next ?? 0)}
                              aria-label={t(
                                "admin.transfers.create.qtyFor",
                                { sku: row.sku || row.productTitle },
                              )}
                              aria-invalid={overStock || undefined}
                              className="h-8 w-20 text-right text-xs"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2 text-xs text-muted-foreground"
                              onClick={() =>
                                setLineQty(row, row.availableAtSource)
                              }
                            >
                              {t("admin.transfers.create.max")}
                            </Button>
                          </div>
                          {overStock ? (
                            <span className="text-[11px] text-destructive">
                              {t("admin.transfers.create.overStock", {
                                available: row.availableAtSource,
                              })}
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {fromLocationId && total > 0 ? (
          <div className="border-t px-4 pb-4">
            <DataTablePagination
              pagination={{ page, pageSize, total, totalPages }}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              onPageChange={(next) =>
                view === "all" ? setCatalogPage(next) : setSelectedPage(next)
              }
              onPageSizeChange={setPageSize}
            />
          </div>
        ) : null}
      </Card>

      <Dialog open={locationDialogOpen} onOpenChange={setLocationDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("admin.transfers.create.dialog.addLocationTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("admin.transfers.create.dialog.addLocationDescription", {
                target: locationTarget,
              })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="new-location-name">
                {t("admin.transfers.create.dialog.locationName")}
              </Label>
              <Input
                id="new-location-name"
                value={newLocationName}
                onChange={(event) => setNewLocationName(event.target.value)}
                placeholder={t(
                  "admin.transfers.create.dialog.locationNamePlaceholder",
                )}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-location-address">
                {t("admin.transfers.create.dialog.addressOptional")}
              </Label>
              <Textarea
                id="new-location-address"
                value={newLocationAddress}
                onChange={(event) => setNewLocationAddress(event.target.value)}
                placeholder={t(
                  "admin.transfers.create.dialog.addressPlaceholder",
                )}
                className="min-h-[90px]"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setLocationDialogOpen(false)}
            >
              {t("admin.transfers.create.cancel")}
            </Button>
            <Button
              type="button"
              onClick={handleCreateLocation}
              disabled={creatingLocation}
            >
              {creatingLocation ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              {t("admin.transfers.create.dialog.saveLocation")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
