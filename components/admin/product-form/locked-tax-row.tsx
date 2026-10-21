"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast-notification";
import { TaxRequestDialog } from "@/components/vendor/tax-request-dialog";
import { useProductTaxLabel } from "@/components/admin/settings/fields/use-product-tax-label";
import type { TaxClass } from "@/lib/tax/tax-settings";
import type { ProductTax } from "@/lib/tax/vendor-tax";

type PendingRequest = { _id: string; requested: ProductTax };

/**
 * A vendor's product tax when the store keeps tax changes for itself
 * (Settings → Tax Settings → Vendors): shown, not edited. Under "with
 * approval" the vendor asks for a change here and sees the open request.
 */
export function LockedTaxRow(props: {
  lock: "approval" | "never";
  /** Absent for a product not saved yet: there is nothing to ask about. */
  productId?: string;
  classes?: TaxClass[];
  current: ProductTax;
}) {
  const t = useTranslations("admin.settings.tax.request");
  const label = useProductTaxLabel(props.classes);
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const canAsk = props.lock === "approval" && Boolean(props.productId);

  const load = useCallback(async () => {
    if (!canAsk) return;
    try {
      const response = await fetch(
        `/api/vendor/tax-requests?productId=${props.productId}&status=pending`,
      );
      const body = await response.json().catch(() => null);
      const rows = (body?.data ?? []) as PendingRequest[];
      setPending(rows[0] ?? null);
    } catch {
      setPending(null);
    }
  }, [canAsk, props.productId]);

  useEffect(() => {
    void load();
  }, [load]);

  const withdraw = async () => {
    if (!pending) return;
    try {
      const response = await fetch(`/api/vendor/tax-requests/${pending._id}`, { method: "DELETE" });
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.success === false) throw new Error(body?.message || t("withdrawFailed"));
      toast.success(t("withdrawn"));
      setPending(null);
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : t("withdrawFailed"));
    }
  };

  const note = !props.productId && props.lock === "approval"
    ? t("newProductApproval")
    : props.lock === "approval"
      ? t("lockedApproval")
      : t("lockedNever");

  return (
    <div className="space-y-2 rounded-md border px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Lock className="text-muted-foreground size-3.5" aria-hidden />
        <span className="text-muted-foreground">{t("lockedLabel")}</span>
        <span className="font-medium">{label(props.current)}</span>
        {canAsk && !pending ? (
          <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={() => setDialogOpen(true)}>
            {t("requestChange")}
          </Button>
        ) : null}
      </div>
      {pending ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span>{t("pending", { tax: label(pending.requested) })}</span>
          <Button type="button" variant="link" size="sm" className="h-auto px-0 text-xs" onClick={() => void withdraw()}>
            {t("withdraw")}
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">{note}</p>
      )}
      {canAsk && props.productId ? (
        <TaxRequestDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          productIds={[props.productId]}
          classes={props.classes}
          current={props.current}
          onSent={() => void load()}
        />
      ) : null}
    </div>
  );
}
