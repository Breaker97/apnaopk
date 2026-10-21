"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface POSTaxExemptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: { reason: string; reference?: string } | null;
  onApply: (exemption: { reason: string; reference?: string } | null) => void;
}

/**
 * Sell this sale without tax: why (required — it is what an auditor reads)
 * and the customer's exemption certificate number, if they have one. The
 * server checks the seat may do it (lib/pos/sale-tax.ts).
 */
export function POSTaxExemptDialog({ open, onOpenChange, current, onApply }: POSTaxExemptDialogProps) {
  const t = useTranslations("pos.tax");
  const [reason, setReason] = React.useState("");
  const [reference, setReference] = React.useState("");

  const [wasOpen, setWasOpen] = React.useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setReason(current?.reason ?? "");
      setReference(current?.reference ?? "");
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("exemptTitle")}
        className="w-full max-w-sm overflow-hidden rounded-2xl border bg-background shadow-2xl"
      >
        <div className="flex items-center justify-between border-b px-5 py-3.5">
          <h2 className="text-base font-semibold">{t("exemptTitle")}</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            onClick={() => onOpenChange(false)}
            aria-label={t("close")}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="space-y-3 p-5">
          <p className="text-sm text-muted-foreground">{t("exemptIntro")}</p>
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t("exemptReason")}
            aria-label={t("exemptReason")}
            maxLength={200}
            className="h-11 rounded-xl"
            autoFocus
          />
          <Input
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            placeholder={t("exemptReference")}
            aria-label={t("exemptReference")}
            maxLength={120}
            className="h-11 rounded-xl"
          />
          <div className="flex gap-2 pt-1">
            {current ? (
              <Button
                type="button"
                variant="outline"
                className="h-11 flex-1 rounded-xl"
                onClick={() => {
                  onApply(null);
                  onOpenChange(false);
                }}
              >
                {t("exemptRemove")}
              </Button>
            ) : null}
            <Button
              type="button"
              className="h-11 flex-1 rounded-xl"
              disabled={!reason.trim()}
              onClick={() => {
                onApply({ reason: reason.trim(), ...(reference.trim() ? { reference: reference.trim() } : {}) });
                onOpenChange(false);
              }}
            >
              {t("exemptApply")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
