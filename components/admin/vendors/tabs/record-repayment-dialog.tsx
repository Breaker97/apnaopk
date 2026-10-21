"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useFinanceRequest, type FinanceOutcome } from "@/hooks/use-finance-request";
import { toast } from "@/components/ui/toast-notification";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiClient } from "@/lib/api/client";

const ACCOUNTS = ["bank", "cash", "gateway"] as const;

/**
 * Money a seller paid back by hand for sales refunded after their payout.
 * Capped server-side at what they owe back; the field starts at that amount.
 */
export function RecordRepaymentDialog({
  vendorId,
  currency,
  owedBack,
  open,
  onOpenChange,
  onRecorded,
}: {
  vendorId: string;
  currency: string;
  owedBack: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecorded: () => void;
}) {
  const t = useTranslations("admin.vendorPayoutsTab.repayment");
  const tPaidFrom = useTranslations("finance.paidFrom");
  const financeRequest = useFinanceRequest();
  const [amount, setAmount] = useState(String(owedBack));
  const [receivedInto, setReceivedInto] = useState<(typeof ACCOUNTS)[number]>("bank");
  const [reference, setReference] = useState("");
  const [receivedAt, setReceivedAt] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      const payload = {
        currency,
        amount: Number(amount),
        receivedInto,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        receivedAt: new Date(`${receivedAt}T12:00:00`).toISOString(),
      };
      const outcome = await apiClient.post<FinanceOutcome>(`/api/admin/vendors/${vendorId}/repayments`, {
        ...payload,
        requestKey: financeRequest.key(`repayment:${vendorId}`, payload),
      });
      financeRequest.completed(outcome, t("recorded"));
      onOpenChange(false);
      onRecorded();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid-cols-1 sm:max-w-md">
        <form
          className="min-w-0 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <div className="min-w-0 space-y-2">
              <Label htmlFor="repayment-amount">{t("amount", { currency })}</Label>
              <Input id="repayment-amount" type="number" inputMode="decimal" min="0" step="any" max={owedBack} value={amount} onChange={(event) => setAmount(event.target.value)} />
            </div>
            <div className="min-w-0 space-y-2">
              <Label htmlFor="repayment-into">{t("receivedInto")}</Label>
              <Select value={receivedInto} onValueChange={(value) => setReceivedInto(value as (typeof ACCOUNTS)[number])}>
                <SelectTrigger id="repayment-into">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACCOUNTS.map((account) => (
                    <SelectItem key={account} value={account}>
                      {tPaidFrom(account)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 space-y-2">
              <Label htmlFor="repayment-date">{t("receivedAt")}</Label>
              <Input id="repayment-date" type="date" value={receivedAt} max={new Date().toISOString().slice(0, 10)} onChange={(event) => setReceivedAt(event.target.value)} />
            </div>
            <div className="min-w-0 space-y-2">
              <Label htmlFor="repayment-reference">{t("reference")}</Label>
              <Input id="repayment-reference" value={reference} maxLength={120} onChange={(event) => setReference(event.target.value)} />
            </div>
            <div className="min-w-0 space-y-2 sm:col-span-2">
              <Label htmlFor="repayment-note">{t("note")}</Label>
              <Input id="repayment-note" value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={saving}>
                {t("cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={saving || !(Number(amount) > 0) || Number(amount) > owedBack}>
              {saving ? t("saving") : t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
