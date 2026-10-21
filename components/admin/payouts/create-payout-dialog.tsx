"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useFinanceRequest, type FinanceOutcome } from "@/hooks/use-finance-request";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
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
import { RemoteSelect, type RemoteOption } from "@/components/admin/store-pages/remote-select";
import { PayoutBreakdown } from "@/components/payouts/payout-breakdown";
import { SellerBankDetailsBlock, type SellerBankDetails } from "@/components/admin/payouts/seller-bank-details";
import { apiClient, ApiClientError } from "@/lib/api/client";
import { formatCurrency } from "@/lib/intl/money";

type VendorRow = { _id: string; storeName?: string; status?: string };

export interface PayoutPreview {
  currency: string;
  availableCurrencies: string[];
  calculationVersion: string;
  eligible: boolean;
  /** A payout can be drawn up: money to send, or earnings settled against commission. */
  canCreate?: boolean;
  settlesWithoutTransfer?: boolean;
  eligibilityReason: string | null;
  breakdown: Record<string, number>;
  netAmount: number;
  minimum: number;
  hasMore: boolean;
  orderCount: number;
  commissionOwedNotDeducted: number;
  frozen?: boolean;
  sellerConfirmedCount?: number;
  vendor?: { storeName?: string; status?: string; bankDetails?: SellerBankDetails | null };
}

const PAYOUT_ORDER_LIMIT = 500;

/** Today as a calendar day in UTC, which is how payout dates are read. */
const todayUtc = () => new Date().toISOString().slice(0, 10);

const emptyForm = () => ({ vendorId: "", currency: "", periodStart: "", periodEnd: todayUtc(), note: "" });

/**
 * Drawing up a payout: pick the seller (searched on the server — a list of the
 * newest hundred left older sellers out), see what it would pay and why, and
 * where the money goes. The start date may be left open, so a sale ordered in
 * one month and payable in the next is not missed.
 */
export function CreatePayoutDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const t = useTranslations();
  const label = useFallbackTranslator(t);
  const financeRequest = useFinanceRequest();
  const [form, setForm] = useState(emptyForm);
  // Kept with the inputs it was read for: a preview of another seller or
  // another date is never shown, without clearing it inside the effect.
  const [fetched, setFetched] = useState<{ key: string; preview: PayoutPreview } | null>(null);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [isCreating, setIsCreating] = useState(false);

  const previewKey = JSON.stringify([form.vendorId, form.currency, form.periodStart, form.periodEnd, previewRevision]);
  const preview = fetched?.key === previewKey ? fetched.preview : null;

  useEffect(() => {
    let active = true;
    if (!form.vendorId || !form.periodEnd) return;
    const key = JSON.stringify([form.vendorId, form.currency, form.periodStart, form.periodEnd, previewRevision]);
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({ vendorId: form.vendorId, periodEnd: form.periodEnd });
      if (form.currency) query.set("currency", form.currency);
      if (form.periodStart) query.set("periodStart", form.periodStart);
      apiClient
        .get<PayoutPreview>(`/api/admin/payouts/preview?${query}`)
        .then((value) => {
          if (!active || !value) return;
          // One currency to pay in is the quote's own; several, the admin
          // picks one below (the payout is made in `form.currency || preview.currency`).
          setFetched({ key, preview: value });
        })
        .catch((error) => {
          if (active) toast.error(error instanceof Error ? error.message : t("finance.reliability.readError"));
        });
    }, 200);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
    // `t` is stable for the dialog's life; the preview follows the form only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.vendorId, form.currency, form.periodStart, form.periodEnd, previewRevision]);

  const loadVendors = async (search: string): Promise<RemoteOption[]> => {
    const query = new URLSearchParams({ limit: "20", ...(search.trim() ? { search: search.trim() } : {}) });
    const page = await apiClient.get<{ data: VendorRow[] }>(`/api/admin/vendors?${query}`);
    return (page?.data || []).map((vendor) => ({
      value: vendor._id,
      label: vendor.storeName || vendor._id,
      ...(vendor.status === "suspended" ? { issue: t("admin.payoutsPage.createSection.suspended") } : {}),
    }));
  };

  const resolveVendor = async (id: string) => {
    const vendor = await apiClient.get<VendorRow>(`/api/admin/vendors/${id}`);
    return vendor ? { label: vendor.storeName || id } : null;
  };

  const close = (next: boolean) => {
    if (!next) {
      setForm(emptyForm());
      setFetched(null);
    }
    onOpenChange(next);
  };

  const createPayout = async () => {
    if (!form.vendorId || !form.periodEnd || !(preview?.canCreate ?? preview?.eligible)) {
      toast.error(t("admin.payoutsPage.toast.requiredFields"));
      return;
    }
    setIsCreating(true);
    try {
      const payload = {
        vendorId: form.vendorId,
        currency: form.currency || preview.currency,
        periodEnd: form.periodEnd,
        ...(form.periodStart ? { periodStart: form.periodStart } : {}),
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
        expectedCalculationVersion: preview.calculationVersion,
      };
      const outcome = await apiClient.post<FinanceOutcome>("/api/admin/payouts", {
        ...payload,
        requestKey: financeRequest.key("payout:create", payload),
      });
      financeRequest.completed(outcome, t("admin.payoutsPage.toast.createSuccess"));
      close(false);
      onCreated();
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 409) setPreviewRevision((value) => value + 1);
      toast.error(error instanceof Error ? error.message : t("admin.payoutsPage.toast.createError"));
    } finally {
      setIsCreating(false);
    }
  };

  const currency = preview?.currency || form.currency;
  const money = (amount: number) => formatCurrency(amount, currency || "USD");
  const reason = !preview?.eligibilityReason || preview.settlesWithoutTransfer
    ? null
    : preview.frozen
      ? t("admin.payoutsPage.createSection.frozen")
      : preview.eligibilityReason === "Below minimum withdrawal"
        ? t("admin.payoutsPage.createSection.belowMinimum", { amount: money(preview.netAmount), minimum: money(preview.minimum) })
        : t("finance.reliability.noPayable");

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="grid-cols-1 sm:max-w-2xl">
        <form
          className="min-w-0 space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void createPayout();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("admin.payoutsPage.createSection.title")}</DialogTitle>
            <DialogDescription>{t("admin.payoutsPage.createSection.description")}</DialogDescription>
          </DialogHeader>

          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <div className="min-w-0 space-y-2 md:col-span-2">
              <Label htmlFor="payout-vendor">{t("admin.payoutsPage.listSection.columns.vendor")}</Label>
              <RemoteSelect
                value={form.vendorId}
                onChange={(vendorId) =>
                  // A new seller: their currencies are not the last one's.
                  setForm((previous) => ({ ...previous, vendorId, currency: "" }))
                }
                load={loadVendors}
                resolve={resolveVendor}
                modal
                ariaLabel={t("admin.payoutsPage.listSection.columns.vendor")}
                placeholder={t("admin.payoutsPage.createSection.selectVendor")}
                searchPlaceholder={t("admin.payoutsPage.createSection.searchVendor")}
                emptyText={t("admin.payoutsPage.createSection.noVendor")}
                searchingText={t("admin.payoutsPage.createSection.searching")}
                missingLabel={t("admin.payoutsPage.createSection.vendorMissing")}
                missingIssue={t("admin.payoutsPage.createSection.vendorMissing")}
              />
            </div>

            <div className="min-w-0 space-y-2">
              <Label htmlFor="payout-period-start">{t("admin.payoutsPage.createSection.periodStart")}</Label>
              <Input
                id="payout-period-start"
                type="date"
                value={form.periodStart}
                max={form.periodEnd || undefined}
                disabled={isCreating}
                onChange={(event) => setForm((previous) => ({ ...previous, periodStart: event.target.value }))}
              />
              <p className="text-xs text-muted-foreground">{t("admin.payoutsPage.createSection.startHint")}</p>
            </div>

            <div className="min-w-0 space-y-2">
              <Label htmlFor="payout-period-end">{t("admin.payoutsPage.createSection.periodEnd")}</Label>
              <Input
                id="payout-period-end"
                type="date"
                value={form.periodEnd}
                disabled={isCreating}
                onChange={(event) => setForm((previous) => ({ ...previous, periodEnd: event.target.value }))}
              />
              <p className="text-xs text-muted-foreground">{t("finance.reliability.utcDays")}</p>
            </div>

            {preview && preview.availableCurrencies.length > 1 && (
              <div className="min-w-0 space-y-2 md:col-span-2">
                <Label htmlFor="payout-currency">{t("finance.reliability.currency")}</Label>
                <Select
                  value={form.currency || preview.currency}
                  disabled={isCreating}
                  onValueChange={(value) => setForm((previous) => ({ ...previous, currency: value }))}
                >
                  <SelectTrigger id="payout-currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {preview.availableCurrencies.map((code) => (
                      <SelectItem key={code} value={code}>
                        {code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="min-w-0 space-y-2 md:col-span-2">
              <Label htmlFor="payout-note">{t("admin.payoutsPage.createSection.optionalNote")}</Label>
              <Input
                id="payout-note"
                value={form.note}
                maxLength={2000}
                disabled={isCreating}
                onChange={(event) => setForm((previous) => ({ ...previous, note: event.target.value }))}
              />
            </div>
          </div>

          {preview && (
            <div className="grid min-w-0 gap-3 md:grid-cols-2">
              <PayoutBreakdown breakdown={preview.breakdown} currency={preview.currency} />
              <SellerBankDetailsBlock details={preview.vendor?.bankDetails} />
              <ul className="space-y-1 text-sm text-muted-foreground md:col-span-2">
                {preview.orderCount > 0 && (
                  <li>{t("admin.payoutsPage.createSection.orderCount", { count: preview.orderCount })}</li>
                )}
                {preview.hasMore && (
                  <li>{t("admin.payoutsPage.createSection.moreThanMax", { count: PAYOUT_ORDER_LIMIT })}</li>
                )}
                {(preview.sellerConfirmedCount ?? 0) > 0 && (
                  <li>{t("admin.payoutsPage.createSection.sellerConfirmed", { count: preview.sellerConfirmedCount ?? 0 })}</li>
                )}
                {preview.settlesWithoutTransfer && (
                  <li>{label("finance.payout.noTransferHint", "Nothing is sent: the seller's earnings are fully settled against the commission they owe.")}</li>
                )}
                {preview.commissionOwedNotDeducted > 0 && (
                  <li>{t("admin.payoutsPage.createSection.commissionLeft", { amount: money(preview.commissionOwedNotDeducted) })}</li>
                )}
              </ul>
              {reason && (
                <p role="alert" className="text-sm text-destructive md:col-span-2">
                  {reason}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={isCreating}>
                {t("common.cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={isCreating || !(preview?.canCreate ?? preview?.eligible)}>
              {isCreating ? t("admin.payoutsPage.createSection.creating") : t("admin.payoutsPage.createSection.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
