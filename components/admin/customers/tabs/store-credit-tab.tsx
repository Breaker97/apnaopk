"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { NumberInput } from "@/components/ui/number-input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast-notification";
import { formatCurrency } from "@/lib/intl/money";
import { resolveCurrency } from "@/lib/intl/currencies";
import { useAppSettings } from "@/providers/app-settings-provider";

type Balance = {
  currency: string;
  balance: number;
  nextExpiry: { amount: number; expiresAt: string } | null;
};

type HistoryRow = {
  _id: string;
  type: "issue" | "redeem" | "expire";
  amount: number;
  currency: string;
  status?: "held" | "spent" | "released";
  source: string;
  remaining?: number;
  expiresAt?: string | null;
  note?: string;
  createdAt: string;
};

const SOURCE_LABELS: Record<string, string> = {
  return_refund: "Return refunded as credit",
  order_refund: "Refund given as credit",
  order_refund_restore: "Credit given back from a refunded order",
  goodwill: "Given by the store",
};

function money(amount: number, currencyCode: string) {
  const currency = resolveCurrency(String(currencyCode || "").toUpperCase() || "USD");
  return formatCurrency(Number(amount || 0), currency.code, currency.locale);
}

/**
 * A customer's store credit (R8): what they hold, and every change. Only an
 * admin gives credit (D3); staff who can see customers see it.
 */
export function StoreCreditTab({ customerId }: { customerId: string }) {
  const { defaultCurrency } = useAppSettings();
  const currency = String(defaultCurrency || "USD").toUpperCase();
  const [loading, setLoading] = useState(true);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [canIssue, setCanIssue] = useState(false);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<number | undefined>(undefined);
  const [expiresOn, setExpiresOn] = useState("");
  const [note, setNote] = useState("");
  const [requestId, setRequestId] = useState("");
  const [saving, setSaving] = useState(false);
  // Bumped to read the credit again after some is given.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/customers/${customerId}/store-credit`);
        const data = await res.json().catch(() => null);
        if (!cancelled && res.ok && data?.success) {
          setBalances(data.data?.balances || []);
          setHistory(data.data?.history || []);
          setCanIssue(Boolean(data.data?.canIssue));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customerId, reloadKey]);

  const openDialog = () => {
    setAmount(undefined);
    setExpiresOn("");
    setNote("");
    setRequestId(
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    setOpen(true);
  };

  const give = async () => {
    if (!amount || amount <= 0) {
      toast.error("Enter how much credit to give");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/store-credit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount,
          currency,
          ...(expiresOn ? { expiresOn } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
          requestId,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.message || data?.error || "");
      toast.success("Store credit given");
      setOpen(false);
      setReloadKey((key) => key + 1);
    } catch (error) {
      toast.error((error instanceof Error && error.message) || "Could not give store credit");
    } finally {
      setSaving(false);
    }
  };

  const date = (value: string) =>
    new Date(value).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  const describe = (row: HistoryRow) => {
    if (row.type === "expire") return "Expired";
    if (row.type === "redeem") {
      return row.status === "held" ? "Held for a checkout" : "Spent on an order";
    }
    return SOURCE_LABELS[row.source] || "Credit";
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle>Store credit</CardTitle>
        {canIssue ? (
          <Button type="button" size="sm" variant="outline" onClick={openDialog}>
            <Plus className="mr-1.5 h-4 w-4" />
            Give credit
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <Skeleton className="h-20 w-full" />
        ) : balances.length === 0 ? (
          <p className="text-sm text-muted-foreground">No store credit.</p>
        ) : (
          <div className="flex flex-wrap gap-8">
            {balances.map((entry) => (
              <div key={entry.currency}>
                <p className="text-2xl font-semibold">{money(entry.balance, entry.currency)}</p>
                {entry.nextExpiry ? (
                  <p className="text-sm text-muted-foreground">
                    {money(entry.nextExpiry.amount, entry.currency)} expires{" "}
                    {date(entry.nextExpiry.expiresAt)}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {!loading && history.length > 0 ? (
          <div className="divide-y rounded-md border">
            {history.map((row) => (
              <div
                key={row._id}
                className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate">{describe(row)}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {date(row.createdAt)}
                    {row.note ? ` · ${row.note}` : ""}
                    {row.type === "issue" && row.expiresAt
                      ? ` · expires ${date(row.expiresAt)}`
                      : ""}
                  </p>
                </div>
                <span
                  className={`shrink-0 font-medium ${row.type === "issue" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}
                >
                  {row.type === "issue" ? "+" : "−"}
                  {money(row.amount, row.currency)}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="grid-cols-1">
          <DialogHeader>
            <DialogTitle>Give store credit</DialogTitle>
            <DialogDescription>
              With no refund behind it. The customer is emailed, and spends it at
              checkout on orders in {currency}.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="store-credit-amount">Amount ({currency})</Label>
              <NumberInput
                id="store-credit-amount"
                min={0}
                step={0.01}
                value={amount}
                onValueChange={setAmount}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="store-credit-expiry">
                Expires <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="store-credit-expiry"
                type="date"
                value={expiresOn}
                onChange={(event) => setExpiresOn(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="store-credit-note">
                Note to the customer <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="store-credit-note"
                value={note}
                maxLength={500}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Sorry for the wait on your last order"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void give()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Give credit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
