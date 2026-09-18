"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast-notification";
import { apiClient } from "@/lib/api/client";
import { remainingTransferQuantity } from "@/lib/inventory/transfer-rules";

export interface ReceivableTransferItem {
  productId: string;
  variantId: string;
  productTitle: string;
  variantTitle?: string;
  sku?: string;
  quantity: number;
  receivedQuantity: number;
  rejectedQuantity: number;
}

type Counts = Record<string, { accepted: number; rejected: number }>;

const lineKey = (item: { productId: string; variantId: string }) =>
  `${item.productId}:${item.variantId}`;

function allRemainingAccepted(items: ReceivableTransferItem[]): Counts {
  return Object.fromEntries(
    items.map((item) => [
      lineKey(item),
      { accepted: remainingTransferQuantity(item), rejected: 0 },
    ]),
  );
}

/**
 * Record what arrived. Each outstanding line starts fully accepted; the
 * receiver lowers it and moves units to "rejected" for anything damaged or
 * missing. Units left in neither box stay outstanding for a later receipt.
 *
 * Mount it only while open: its counts start from the lines it was mounted
 * with, and a fresh mount is what picks up an earlier partial receipt.
 */
export function TransferReceiveDialog({
  open,
  onOpenChange,
  transferId,
  apiBase,
  destinationName,
  items,
  onReceived,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transferId: string;
  /** `/api/admin/transfers` or `/api/vendor/transfers`. */
  apiBase: string;
  destinationName: string;
  items: ReceivableTransferItem[];
  onReceived: (completed: boolean) => void;
}) {
  const t = useTranslations("admin.transfers.receive");
  const outstanding = items.filter(
    (item) => remainingTransferQuantity(item) > 0,
  );
  const [counts, setCounts] = useState<Counts>(() =>
    allRemainingAccepted(outstanding),
  );
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const setCount = (
    key: string,
    field: "accepted" | "rejected",
    value: number,
  ) =>
    setCounts((prev) => ({
      ...prev,
      [key]: { ...(prev[key] || { accepted: 0, rejected: 0 }), [field]: value },
    }));

  const overLines = outstanding.filter((item) => {
    const entry = counts[lineKey(item)];
    return (
      entry &&
      entry.accepted + entry.rejected > remainingTransferQuantity(item)
    );
  });
  const totals = outstanding.reduce(
    (sum, item) => {
      const entry = counts[lineKey(item)];
      return {
        accepted: sum.accepted + (entry?.accepted || 0),
        rejected: sum.rejected + (entry?.rejected || 0),
      };
    },
    { accepted: 0, rejected: 0 },
  );
  const nothingEntered = totals.accepted + totals.rejected === 0;

  const submit = async () => {
    setSaving(true);
    try {
      const result = await apiClient.patch<{ completed?: boolean }>(
        `${apiBase}/${transferId}`,
        {
          action: "receive",
          note: note.trim(),
          lines: outstanding.map((item) => ({
            productId: item.productId,
            variantId: item.variantId,
            accepted: counts[lineKey(item)]?.accepted || 0,
            rejected: counts[lineKey(item)]?.rejected || 0,
          })),
        },
      );
      onOpenChange(false);
      onReceived(Boolean(result?.completed));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("description", { destination: destinationName })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCounts(allRemainingAccepted(outstanding))}
          >
            {t("acceptAll")}
          </Button>
        </div>

        <div className="max-h-[50vh] overflow-auto rounded-lg border">
          <table className="w-full text-xs">
            <thead className="bg-muted/40">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium text-muted-foreground">{t("columns.item")}</th>
                <th className="px-3 py-2 font-medium text-muted-foreground">
                  {t("columns.outstanding")}
                </th>
                <th className="px-3 py-2 font-medium text-muted-foreground">
                  {t("columns.accept")}
                </th>
                <th className="px-3 py-2 font-medium text-muted-foreground">
                  {t("columns.reject")}
                </th>
              </tr>
            </thead>
            <tbody>
              {outstanding.map((item) => {
                const key = lineKey(item);
                const remaining = remainingTransferQuantity(item);
                const entry = counts[key] || { accepted: 0, rejected: 0 };
                const over = entry.accepted + entry.rejected > remaining;
                return (
                  <tr key={key} className="border-t align-top">
                    <td className="px-3 py-2">
                      <p>{item.productTitle}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {[item.variantId ? item.variantTitle : "", item.sku]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </td>
                    <td className="px-3 py-2">{remaining}</td>
                    <td className="px-3 py-2">
                      <NumberInput
                        min={0}
                        max={remaining}
                        step={1}
                        value={entry.accepted}
                        whenEmpty={0}
                        normalize={Math.trunc}
                        onValueChange={(next) =>
                          setCount(key, "accepted", next ?? 0)
                        }
                        className="h-8 w-20 text-xs"
                        aria-invalid={over || undefined}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <NumberInput
                        min={0}
                        max={remaining}
                        step={1}
                        value={entry.rejected}
                        whenEmpty={0}
                        normalize={Math.trunc}
                        onValueChange={(next) =>
                          setCount(key, "rejected", next ?? 0)
                        }
                        className="h-8 w-20 text-xs"
                        aria-invalid={over || undefined}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {overLines.length > 0 ? (
          <p className="text-sm text-destructive">{t("tooMany")}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("summary", totals)}
          </p>
        )}

        <div className="space-y-2">
          <Label htmlFor="transfer-receive-note">{t("note")}</Label>
          <Textarea
            id="transfer-receive-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t("notePlaceholder")}
            className="min-h-[70px]"
            maxLength={2000}
          />
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={saving || nothingEntered || overLines.length > 0}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
