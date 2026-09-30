"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NumberInput } from "@/components/ui/number-input";
import { toast } from "@/components/ui/toast-notification";
import { apiClient, describeApiError } from "@/lib/api/client";
import type { HeldUnitAction, HeldUnitEntry } from "@/lib/returns/held-units";

export interface UnavailableStockTarget {
  productId: string;
  variantId: string | null;
  productName: string;
  variantName: string | null;
}

interface InventoryUnavailableDialogProps {
  target: UnavailableStockTarget | null;
  onOpenChange: (open: boolean) => void;
  /** The inventory endpoint the table writes to; the dialog uses its `/unavailable`. */
  apiEndpoint: string;
  readOnly?: boolean;
  /** Called after units moved, so the table can re-read its figures. */
  onChanged: () => void;
}

/**
 * The units behind an inventory row's "Unavailable" figure: what each return's
 * count found damaged, incomplete or unusable, and still in the shop. Each can
 * go back on sale (it goes to the branch it was sold from) or be written off.
 */
export function InventoryUnavailableDialog({
  target,
  onOpenChange,
  apiEndpoint,
  readOnly = false,
  onChanged,
}: InventoryUnavailableDialogProps) {
  const t = useTranslations("admin.inventory.unavailableDialog");

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {target
              ? [target.productName, target.variantName].filter(Boolean).join(" · ")
              : null}
          </DialogDescription>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">{t("description")}</p>

        {target ? (
          // Keyed by the row, so opening another row starts from a clean slate.
          <HeldUnitList
            key={`${target.productId}:${target.variantId ?? ""}`}
            target={target}
            apiEndpoint={apiEndpoint}
            readOnly={readOnly}
            onChanged={onChanged}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

const entryKey = (entry: HeldUnitEntry) => `${entry.returnId}:${entry.itemIndex}`;

function HeldUnitList({
  target,
  apiEndpoint,
  readOnly,
  onChanged,
}: {
  target: UnavailableStockTarget;
  apiEndpoint: string;
  readOnly: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("admin.inventory.unavailableDialog");
  const locale = useLocale();
  const [entries, setEntries] = useState<HeldUnitEntry[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);

  const fetchEntries = useCallback(() => {
    const params = new URLSearchParams({ productId: target.productId });
    if (target.variantId) params.set("variantId", target.variantId);
    return apiClient.get<{ entries: HeldUnitEntry[] }>(
      `${apiEndpoint}/unavailable?${params.toString()}`,
    );
  }, [apiEndpoint, target.productId, target.variantId]);

  const showEntries = useCallback((next: HeldUnitEntry[] | null) => {
    setLoadFailed(next === null);
    setEntries(next ?? []);
    setQuantities(
      Object.fromEntries((next ?? []).map((entry) => [entryKey(entry), entry.held])),
    );
  }, []);

  useEffect(() => {
    // A reply that lands after the list closed is dropped.
    let active = true;
    fetchEntries()
      .then((data) => active && showEntries(data.entries))
      .catch(() => active && showEntries(null));
    return () => {
      active = false;
    };
  }, [fetchEntries, showEntries]);

  const load = async () => {
    try {
      showEntries((await fetchEntries()).entries);
    } catch {
      showEntries(null);
    }
  };

  const settle = async (entry: HeldUnitEntry, action: HeldUnitAction) => {
    const key = entryKey(entry);
    const quantity = quantities[key] ?? entry.held;
    setBusyKey(key);
    try {
      await apiClient.post(`${apiEndpoint}/unavailable`, {
        returnId: entry.returnId,
        itemIndex: entry.itemIndex,
        quantity,
        action,
      });
      toast.success(
        action === "restocked"
          ? t("restocked", { count: quantity })
          : t("writtenOff", { count: quantity }),
      );
      setConfirmKey(null);
      onChanged();
      await load();
    } catch (error) {
      toast.error(describeApiError(error, t("actionError")));
    } finally {
      setBusyKey(null);
    }
  };

  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(value));

  const conditionLabel = (condition: string) =>
    condition === "damaged" || condition === "missing_parts" || condition === "unusable"
      ? t(`conditions.${condition}`)
      : condition;

  if (entries === null) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
        {loadFailed ? t("loadError") : t("empty")}
      </p>
    );
  }

  return (
    <ul className="max-h-[55vh] space-y-3 overflow-auto">
      {entries.map((entry) => {
        const key = entryKey(entry);
        const busy = busyKey === key;
        const quantity = quantities[key] ?? entry.held;
        return (
          <li key={key} className="rounded-lg border p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium">
                  {t("fromReturn", {
                    returnNumber: entry.returnNumber,
                    orderNumber: entry.orderNumber,
                  })}
                </p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">{conditionLabel(entry.condition)}</Badge>
                  {entry.countedAt ? (
                    <span>{t("countedOn", { date: formatDate(entry.countedAt) })}</span>
                  ) : null}
                </div>
              </div>
              <p className="shrink-0 text-sm font-semibold">
                {t("held", { count: entry.held })}
              </p>
            </div>

            {readOnly ? null : confirmKey === key ? (
              <div className="mt-3 flex flex-wrap items-center justify-end gap-2 rounded-md bg-destructive/5 p-2">
                <p className="mr-auto text-sm">{t("confirmWriteOff", { count: quantity })}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setConfirmKey(null)}
                >
                  {t("cancel")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => settle(entry, "written_off")}
                >
                  {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                  {t("writeOff")}
                </Button>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                <label className="mr-auto flex items-center gap-2 text-sm text-muted-foreground">
                  {t("quantity")}
                  <NumberInput
                    min={1}
                    max={entry.held}
                    step={1}
                    value={quantity}
                    whenEmpty={1}
                    normalize={Math.trunc}
                    disabled={busy}
                    onValueChange={(next) =>
                      setQuantities((current) => ({
                        ...current,
                        [key]: Math.min(entry.held, Math.max(1, next ?? 1)),
                      }))
                    }
                    className="h-8 w-20 text-center"
                  />
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setConfirmKey(key)}
                >
                  {t("writeOff")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={() => settle(entry, "restocked")}
                >
                  {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                  {t("restock")}
                </Button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
