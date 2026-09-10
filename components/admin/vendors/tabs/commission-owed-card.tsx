"use client";

import { useCallback, useEffect, useState } from "react";
import { Banknote, Info } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast-notification";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { apiClient } from "@/lib/api/client";
import { useCurrency } from "@/providers/currency-provider";

/**
 * The other direction of the money.
 *
 * Every other figure on this tab is the platform owing the vendor. This one is
 * the vendor owing the platform, and it exists because a cash sale never
 * reaches the platform at all — the merchant took the notes at their own
 * counter, so there is no payout to deduct the commission from. Without a
 * surface an admin has no way to know the balance is there.
 */

interface CommissionInvoice {
  id: string;
  amount: number;
  currency: string;
  status: "open" | "paid" | "cancelled";
  paidAt: string | null;
  orderCount: number;
  note: string | null;
  createdAt: string;
}

interface CommissionResponse {
  currency: string;
  owed: {
    amount: number;
    grossSales: number;
    orderCount: number;
    /** Owed in a currency this card cannot bill — an invoice is raised in one. */
    otherCurrencies?: string[];
  };
  invoices: CommissionInvoice[];
}

const STATUS_VARIANT = {
  open: "outline",
  paid: "default",
  cancelled: "secondary",
} as const;

export function CommissionOwedCard({ vendorId }: { vendorId: string }) {
  const { formatPrice: format } = useCurrency();
  const { confirm } = useConfirmation();
  const [data, setData] = useState<CommissionResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);

  const load = useCallback(
    () =>
      apiClient
        .get<CommissionResponse>(`/api/admin/vendors/${vendorId}/commission`)
        .then((res) => setData(res))
        .catch((error) => {
          console.error("Failed to load commission balance:", error);
          toast.error("Failed to load the commission balance");
        })
        .finally(() => setIsLoading(false)),
    [vendorId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const raise = async () => {
    setIsBusy(true);
    try {
      await apiClient.post(`/api/admin/vendors/${vendorId}/commission`, {});
      toast.success("Invoice raised");
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not raise the invoice",
      );
    } finally {
      setIsBusy(false);
    }
  };

  const act = async (invoice: CommissionInvoice, action: "collect" | "cancel") => {
    if (action === "cancel") {
      const ok = await confirm({
        title: "Cancel this invoice?",
        description:
          "The sales it covers go back into the outstanding balance and can be invoiced again.",
        confirmText: "Cancel invoice",
        variant: "destructive",
      });
      if (!ok) return;
    }

    setIsBusy(true);
    try {
      await apiClient.patch(`/api/admin/vendors/${vendorId}/commission`, {
        invoiceId: invoice.id,
        action,
      });
      toast.success(
        action === "collect" ? "Recorded as collected" : "Invoice cancelled",
      );
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "That did not go through",
      );
    } finally {
      setIsBusy(false);
    }
  };

  const owed = data?.owed;
  const invoices = data?.invoices ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Banknote className="h-4 w-4" />
              Commission owed by this vendor
            </CardTitle>
            <CardDescription>
              Cash, COD and own-terminal sales the platform never received — so
              the commission could not be deducted from a payout
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={raise}
            disabled={isLoading || isBusy || !owed || owed.amount <= 0}
          >
            Raise invoice
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-9 w-40" />
        ) : (
          <>
            <p className="text-3xl font-semibold tabular-nums">
              {format(owed?.amount ?? 0)}
            </p>
            <p className="text-sm text-muted-foreground">
              {!owed?.orderCount ? (
                "Nothing outstanding — this vendor's sales all settled through the platform."
              ) : (
                <>
                  Across {owed.orderCount.toLocaleString()} order
                  {owed.orderCount === 1 ? "" : "s"} they collected themselves ·{" "}
                  {format(owed.grossSales)} gross. Refunds are already deducted;
                  anything on an open invoice below is excluded.
                </>
              )}
            </p>
            {/*
              An invoice is raised in ONE currency, so a debt in another cannot
              ride along in this figure. Named rather than dropped — a balance
              nobody is told about is a balance nobody collects.
            */}
            {owed?.otherCurrencies?.length ? (
              <p className="text-sm text-muted-foreground">
                Also owed in {owed.otherCurrencies.join(", ")}, which this
                invoice cannot bill — currencies are never added together.
              </p>
            ) : null}

            {invoices.length > 0 && (
              <div className="divide-y rounded-lg border">
                {invoices.map((invoice) => (
                  <div
                    key={invoice.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium tabular-nums">
                          {format(invoice.amount)}
                        </span>
                        <Badge
                          variant={STATUS_VARIANT[invoice.status]}
                          className="text-[10px] px-1.5 py-0"
                        >
                          {invoice.status}
                        </Badge>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {invoice.orderCount.toLocaleString()} order
                        {invoice.orderCount === 1 ? "" : "s"} ·{" "}
                        {new Date(invoice.createdAt).toLocaleDateString()}
                        {invoice.note ? ` · ${invoice.note}` : ""}
                      </p>
                    </div>

                    {invoice.status === "open" && (
                      <div className="flex shrink-0 gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={isBusy}
                          onClick={() => act(invoice, "cancel")}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          disabled={isBusy}
                          onClick={() => act(invoice, "collect")}
                        >
                          Mark collected
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                Marking an invoice collected records money received outside the
                platform — a bank transfer or cash. It does not charge the
                vendor.
              </AlertDescription>
            </Alert>
          </>
        )}
      </CardContent>
    </Card>
  );
}
