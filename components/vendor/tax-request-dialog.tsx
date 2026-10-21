"use client";

import { useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast-notification";
import { TaxClassPicker } from "@/components/admin/settings/fields/tax-class-picker";
import type { TaxClass } from "@/lib/tax/tax-settings";
import { INHERITED_PRODUCT_TAX, type ProductTax } from "@/lib/tax/vendor-tax";

const MIN_REASON = 10;

/**
 * A vendor asks the store for one tax for some of their products
 * (POST /api/vendor/tax-requests). The products keep their tax until the
 * store approves.
 */
export function TaxRequestDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productIds: string[];
  classes?: TaxClass[];
  /** The one product's tax, to start the form from. */
  current?: ProductTax;
  onSent?: () => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* Remounted on every open, so a new request never starts from the last one's answers. */}
        {props.open ? <TaxRequestForm {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function TaxRequestForm(props: Parameters<typeof TaxRequestDialog>[0]) {
  const t = useTranslations("admin.settings.tax.request");
  const tPicker = useTranslations("admin.settings.tax.picker");
  const start = props.current ?? INHERITED_PRODUCT_TAX;
  const [chargeTax, setChargeTax] = useState(start.chargeTax);
  const [taxClass, setTaxClass] = useState(start.taxClass);
  const [taxRate, setTaxRate] = useState(start.taxRate);
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (reason.trim().length < MIN_REASON) {
      toast.error(t("reasonTooShort"));
      return;
    }
    setSending(true);
    try {
      const response = await fetch("/api/vendor/tax-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productIds: props.productIds,
          chargeTax,
          taxClass: chargeTax ? taxClass : null,
          taxRate: chargeTax ? taxRate : null,
          reason: reason.trim(),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.success === false) throw new Error(body?.message || t("sendFailed"));
      toast.success(t("sent"));
      props.onOpenChange(false);
      props.onSent?.();
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : t("sendFailed"));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("dialogTitle")}</DialogTitle>
        <DialogDescription>{t("dialogDescription", { count: props.productIds.length })}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
          <span className="font-medium">{t("chargeTax")}</span>
          <Switch checked={chargeTax} onCheckedChange={setChargeTax} aria-label={t("chargeTax")} />
        </label>
        {chargeTax ? (
          <TaxClassPicker
            id="taxRequestClass"
            classes={props.classes}
            taxClass={taxClass}
            taxRate={taxRate}
            inheritLabel={tPicker("inheritCategory")}
            onChange={(next) => {
              setTaxClass(next.taxClass);
              setTaxRate(next.taxRate);
            }}
          />
        ) : null}
        <div className="space-y-1.5">
          <label htmlFor="taxRequestReason" className="text-sm font-medium">
            {t("reason")}
          </label>
          <Textarea
            id="taxRequestReason"
            rows={3}
            maxLength={1000}
            value={reason}
            placeholder={t("reasonPlaceholder")}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
          {t("cancel")}
        </Button>
        <Button type="button" disabled={sending} onClick={() => void send()}>
          {t("send")}
        </Button>
      </DialogFooter>
    </>
  );
}
