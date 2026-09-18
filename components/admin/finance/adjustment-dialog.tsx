"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CurrencyInput } from "@/components/ui/currency-input";
import { toast } from "@/components/ui/toast-notification";
import { apiClient } from "@/lib/api/client";
import {
  LEDGER_ACCOUNT,
  LEDGER_ACCOUNTS,
  type LedgerAccount,
} from "@/lib/finance/accounts";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

const API = "/api/admin/finance/adjustments";

/** English fallbacks; the UI prefers `finance.account.<key>`, as the overview does. */
const ACCOUNT_LABELS: Record<LedgerAccount, string> = {
  [LEDGER_ACCOUNT.CASH_GATEWAY]: "Gateway balance",
  [LEDGER_ACCOUNT.CASH_BANK]: "Bank",
  [LEDGER_ACCOUNT.CASH_ON_HAND]: "Cash in hand",
  [LEDGER_ACCOUNT.INVENTORY]: "Inventory",
  [LEDGER_ACCOUNT.VENDOR_PAYABLE]: "Owed to vendors",
  [LEDGER_ACCOUNT.COMMISSION_RECEIVABLE]: "Commission owed to you",
  [LEDGER_ACCOUNT.CUSTOMER_RECEIVABLE]: "Owed by customers",
  [LEDGER_ACCOUNT.TAX_PAYABLE]: "Tax collected",
  [LEDGER_ACCOUNT.DUTY_PAYABLE]: "Duty collected",
  [LEDGER_ACCOUNT.ACCOUNTS_PAYABLE]: "Unpaid bills",
  [LEDGER_ACCOUNT.PRODUCT_REVENUE]: "Product sales",
  [LEDGER_ACCOUNT.COMMISSION_INCOME]: "Commission",
  [LEDGER_ACCOUNT.SHIPPING_INCOME]: "Shipping charged",
  [LEDGER_ACCOUNT.BOOST_INCOME]: "Boosts",
  [LEDGER_ACCOUNT.SUBSCRIPTION_INCOME]: "Subscriptions",
  [LEDGER_ACCOUNT.REFUNDS]: "Refunds",
  [LEDGER_ACCOUNT.PROCESSING_FEES]: "Payment fees",
  [LEDGER_ACCOUNT.SHIPPING_COST]: "Shipping labels",
  [LEDGER_ACCOUNT.COST_OF_GOODS]: "Cost of goods",
  [LEDGER_ACCOUNT.PROMOTIONS]: "Store-funded discounts",
  [LEDGER_ACCOUNT.CHARGEBACK_LOSSES]: "Chargeback losses",
  [LEDGER_ACCOUNT.OPERATING_EXPENSE]: "Operating expenses",
};

/**
 * The two shapes this is actually opened for, offered as presets.
 *
 * A blank pair of account pickers is a correct journal-entry form and a useless
 * one: the person reaching for this has a specific balance that is wrong, and
 * asking them to know which side of double entry fixes it is how a correction
 * gets posted backwards. Each preset fills both accounts; `custom` leaves them
 * alone for anyone who does know.
 */
const PRESETS = {
  "gateway-to-bank": {
    debit: LEDGER_ACCOUNT.CASH_BANK,
    credit: LEDGER_ACCOUNT.CASH_GATEWAY,
  },
  "bank-to-gateway": {
    debit: LEDGER_ACCOUNT.CASH_GATEWAY,
    credit: LEDGER_ACCOUNT.CASH_BANK,
  },
  "cash-to-bank": {
    debit: LEDGER_ACCOUNT.CASH_BANK,
    credit: LEDGER_ACCOUNT.CASH_ON_HAND,
  },
  "write-off-vendor-payable": {
    debit: LEDGER_ACCOUNT.OPERATING_EXPENSE,
    credit: LEDGER_ACCOUNT.VENDOR_PAYABLE,
  },
} as const;

type PresetKey = keyof typeof PRESETS | "custom";

/**
 * Accounts whose balance is reported PER VENDOR as well as in total.
 *
 * Moving one without naming the vendor moves the overview's figure and leaves
 * the per-vendor row that is actually wrong untouched — so the two screens
 * start disagreeing about the same money. The API refuses it; this is what
 * makes the vendor askable rather than the refusal a surprise.
 */
const VENDOR_ACCOUNTS: readonly LedgerAccount[] = [
  LEDGER_ACCOUNT.VENDOR_PAYABLE,
  LEDGER_ACCOUNT.COMMISSION_RECEIVABLE,
];

interface VendorOption {
  _id: string;
  storeName?: string | null;
}

const emptyForm = () => ({
  date: new Date().toISOString().slice(0, 10),
  preset: "gateway-to-bank" as PresetKey,
  debit: PRESETS["gateway-to-bank"].debit as LedgerAccount,
  credit: PRESETS["gateway-to-bank"].credit as LedgerAccount,
  amount: "",
  reason: "",
  vendorId: "",
  book: "own" as "own" | "marketplace",
});

/**
 * Posting a correcting or transferring entry by hand.
 *
 * The finance screens are otherwise read-only groupings of the ledger, and that
 * was the gap: two money events have no source document in this system — the
 * bank settlement nothing webhooks about, and the balance that has already gone
 * impossible — so there was nowhere to record either. The books could report a
 * negative bank account and a negative liability and offer no way to say what
 * had actually happened.
 *
 * Nothing here edits an entry. The ledger stays append-only; a correction is a
 * new entry that moves the balance, which is what leaves both the imbalance and
 * the decision to fix it visible afterwards.
 */
export function AdjustmentDialog({
  storeCurrency,
  multiVendor,
  currencies,
}: {
  storeCurrency: string;
  multiVendor: boolean;
  /**
   * Every currency the ledger actually holds a balance in.
   *
   * Offered as a choice only when there is more than one. An adjustment posted
   * in the store's CURRENT currency cannot touch a balance recorded in another
   * — it opens a second balance in the wrong denomination and leaves the
   * impossible one untouched — so a store that has traded in two has to be able
   * to say which one it is correcting.
   */
  currencies: string[];
}) {
  const t = useTranslations();
  const router = useRouter();
  const label = useFallbackTranslator(t);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [isSaving, setIsSaving] = useState(false);
  const [vendors, setVendors] = useState<VendorOption[]>([]);

  // The store's own currency first: it is the one nearly every correction is
  // in, and on a single-currency store it is the only option there is.
  const currencyOptions = useMemo(() => {
    const all = new Set(
      [storeCurrency, ...currencies].map((c) => c.toUpperCase()).filter(Boolean),
    );
    return [...all];
  }, [storeCurrency, currencies]);
  const [currency, setCurrency] = useState(storeCurrency.toUpperCase());

  /** True when either side of the entry is a per-vendor balance. */
  const needsVendor =
    VENDOR_ACCOUNTS.includes(form.debit) ||
    VENDOR_ACCOUNTS.includes(form.credit);

  // Fetched only once the entry actually needs one — the overview should not
  // pay for a vendor list on every load to fill a picker nobody opened.
  useEffect(() => {
    if (!open || !needsVendor || vendors.length > 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await apiClient.get<{ data?: VendorOption[] } | VendorOption[]>(
          "/api/admin/vendors",
          { query: { page: 1, limit: 100 } },
        );
        const rows = Array.isArray(data) ? data : (data?.data ?? []);
        if (!cancelled) setVendors(rows);
      } catch {
        // Left empty: the field below says so, and the API refuses the post
        // rather than letting an unattributed entry through.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, needsVendor, vendors.length]);

  const accountLabel = useCallback(
    (account: LedgerAccount) =>
      label(`finance.account.${account}`, ACCOUNT_LABELS[account]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t],
  );

  const accountOptions = useMemo(
    () =>
      LEDGER_ACCOUNTS.map((account) => ({
        value: account,
        label: accountLabel(account),
      })).sort((a, b) => a.label.localeCompare(b.label)),
    [accountLabel],
  );

  const applyPreset = (preset: PresetKey) => {
    if (preset === "custom") {
      setForm((current) => ({ ...current, preset }));
      return;
    }
    const pair = PRESETS[preset];
    setForm((current) => ({
      ...current,
      preset,
      debit: pair.debit,
      credit: pair.credit,
    }));
  };

  const save = useCallback(async () => {
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error(
        label("finance.adjustments.amountRequired", "Enter an amount above zero"),
      );
      return;
    }
    if (form.debit === form.credit) {
      toast.error(
        label(
          "finance.adjustments.samePair",
          "An entry has to move between two different accounts",
        ),
      );
      return;
    }
    if (form.reason.trim().length < 4) {
      toast.error(
        label("finance.adjustments.reasonRequired", "Say what this corrects"),
      );
      return;
    }
    if (needsVendor && !form.vendorId) {
      toast.error(
        label(
          "finance.adjustments.vendorRequired",
          "Choose the vendor — this entry moves a balance reported per vendor",
        ),
      );
      return;
    }

    setIsSaving(true);
    try {
      await apiClient.post(API, {
        date: form.date,
        currency,
        debit: form.debit,
        credit: form.credit,
        amount,
        reason: form.reason.trim(),
        book: multiVendor ? form.book : "own",
        ...(needsVendor && form.vendorId ? { vendorId: form.vendorId } : {}),
      });
      toast.success(
        label("finance.adjustments.posted", "Adjustment posted"),
      );
      setOpen(false);
      setForm(emptyForm());
      // The balances on this page are server-rendered from the ledger, so the
      // entry only shows up once the page re-runs its own aggregation.
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : label(
              "finance.adjustments.failed",
              "Could not post the adjustment",
            ),
      );
    } finally {
      setIsSaving(false);
    }
  }, [form, currency, multiVendor, needsVendor, label, router]);

  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setForm(emptyForm());
          setCurrency(storeCurrency.toUpperCase());
          setOpen(true);
        }}
      >
        <Scale className="h-4 w-4" />
        {label("finance.adjustments.open", "Adjust balances")}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {label("finance.adjustments.title", "Adjust balances")}
            </DialogTitle>
            <DialogDescription>
              {label(
                "finance.adjustments.subtitle",
                "Record money moved between your own accounts, or correct a balance that cannot be right. Nothing is edited — this posts a new entry.",
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>
                {label("finance.adjustments.what", "What happened")}
              </Label>
              <Select
                value={form.preset}
                onValueChange={(value) => applyPreset(value as PresetKey)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gateway-to-bank">
                    {label(
                      "finance.adjustments.gatewayToBank",
                      "The gateway settled money into the bank",
                    )}
                  </SelectItem>
                  <SelectItem value="cash-to-bank">
                    {label(
                      "finance.adjustments.cashToBank",
                      "Cash from the registers was banked",
                    )}
                  </SelectItem>
                  <SelectItem value="bank-to-gateway">
                    {label(
                      "finance.adjustments.bankToGateway",
                      "The bank funded the gateway",
                    )}
                  </SelectItem>
                  <SelectItem value="write-off-vendor-payable">
                    {label(
                      "finance.adjustments.writeOffVendorPayable",
                      "Write off vendor money that was paid but never collected",
                    )}
                  </SelectItem>
                  <SelectItem value="custom">
                    {label(
                      "finance.adjustments.custom",
                      "Something else — choose the accounts myself",
                    )}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="adjustment-date">
                {label("finance.expenses.date", "Date")}
              </Label>
              <Input
                id="adjustment-date"
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adjustment-amount">
                {label("finance.expenses.amount", "Amount")}
              </Label>
              <CurrencyInput
                id="adjustment-amount"
                currencySymbol={currency}
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </div>

            {/* Always visible, even under a preset. The preset is a shortcut to
                the right pair, not a reason to hide which accounts move — an
                entry posted from a screen that would not show you its own two
                sides is one nobody can check. */}
            <div className="space-y-1.5">
              <Label>
                {label("finance.adjustments.into", "Into (debit)")}
              </Label>
              <Select
                value={form.debit}
                onValueChange={(value) =>
                  setForm({
                    ...form,
                    debit: value as LedgerAccount,
                    preset: "custom",
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {accountOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>
                {label("finance.adjustments.outOf", "Out of (credit)")}
              </Label>
              <Select
                value={form.credit}
                onValueChange={(value) =>
                  setForm({
                    ...form,
                    credit: value as LedgerAccount,
                    preset: "custom",
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {accountOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Only where it is a real choice. A single-currency store has one
                answer and a picker with one item is a question with no point. */}
            {currencyOptions.length > 1 ? (
              <div className="space-y-1.5 sm:col-span-2">
                <Label>
                  {label("finance.adjustments.currency", "Currency")}
                </Label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {currencyOptions.map((code) => (
                      <SelectItem key={code} value={code}>
                        {code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {label(
                    "finance.adjustments.currencyHint",
                    "The currency the balance was recorded in — a correction in another one opens a new balance instead of fixing this one.",
                  )}
                </p>
              </div>
            ) : null}

            {needsVendor ? (
              <div className="space-y-1.5 sm:col-span-2">
                <Label>{label("finance.receivables.vendor", "Vendor")}</Label>
                <Select
                  value={form.vendorId}
                  onValueChange={(value) =>
                    setForm({ ...form, vendorId: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={label(
                        "finance.adjustments.vendorPlaceholder",
                        "Choose a vendor",
                      )}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {vendors.map((vendor) => (
                      <SelectItem key={vendor._id} value={vendor._id}>
                        {vendor.storeName || vendor._id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {label(
                    "finance.adjustments.vendorHint",
                    "Required: this balance is reported per vendor as well as in total, and both have to move together.",
                  )}
                </p>
              </div>
            ) : null}

            {multiVendor ? (
              <div className="space-y-1.5 sm:col-span-2">
                <Label>{label("finance.expenses.book", "Book")}</Label>
                <Select
                  value={form.book}
                  onValueChange={(value) =>
                    setForm({ ...form, book: value as "own" | "marketplace" })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="own">
                      {label("finance.book.own", "Own store")}
                    </SelectItem>
                    <SelectItem value="marketplace">
                      {label("finance.book.marketplace", "Marketplace")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="adjustment-reason">
                {label("finance.adjustments.reason", "Why")}
              </Label>
              <Textarea
                id="adjustment-reason"
                rows={2}
                value={form.reason}
                placeholder={label(
                  "finance.adjustments.reasonPlaceholder",
                  "Stripe payout 12 Aug settled to the business account",
                )}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                {label(
                  "finance.adjustments.reasonHint",
                  "Required. Nothing else explains this entry — there is no order or bill behind it.",
                )}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isSaving}
            >
              {label("common.cancel", "Cancel")}
            </Button>
            <Button onClick={() => void save()} disabled={isSaving}>
              {label("finance.adjustments.post", "Post adjustment")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
