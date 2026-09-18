"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CalendarClock, Loader2, MapPin, XCircle } from "lucide-react";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
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
import { toast } from "@/components/ui/toast-notification";
import { useCurrency } from "@/providers/currency-provider";
import { PreorderBalanceCard } from "@/components/account/preorder-balance-card";
import { PreorderAddressEditor } from "@/components/store/preorder-address-editor";

/**
 * Everything a guest can do with their own pre-order, on one page.
 *
 * Reached from the manage link in a delay notice. The page's server half has
 * already verified the link and worked out what is allowed; this renders it and
 * sends each action to its own route with the right capability — the manage
 * token for cancel and address, the balance token for paying. Each route checks
 * again, so nothing here is trusted to decide anything.
 */

type Address = React.ComponentProps<typeof PreorderAddressEditor>["address"];
type BalanceOrder = React.ComponentProps<typeof PreorderBalanceCard>["order"];

export function PreorderManageView({
  locale,
  manageToken,
  balanceToken,
  order,
}: {
  locale: string;
  manageToken: string;
  balanceToken?: string;
  order: {
    _id: string;
    orderNumber: string;
    cancelled: boolean;
    canCancel: boolean;
    /** Why the address cannot change, or null when it can. */
    addressBlocker: string | null;
    releaseDateLabel?: string;
    originalReleaseDateLabel?: string;
    delayReason?: string;
    shippingAddress?: Address;
    /** Present only while a balance is still owed. */
    balance?: BalanceOrder;
  };
}) {
  const router = useRouter();
  const t = useTranslations();
  const tf = useFallbackTranslator(t);
  const { formatPrice } = useCurrency();
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const cancel = async () => {
    setCancelling(true);
    try {
      const res = await fetch(`/api/orders/${order._id}/preorder-cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: manageToken }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(
          json?.message ||
            tf("orders.orderCancelFailed", "The pre-order could not be cancelled"),
        );
      }
      const refund = json.data?.refund as
        | { refunded?: boolean; amount?: number; reason?: string; failed?: boolean }
        | undefined;
      if (refund?.refunded && typeof refund.amount === "number") {
        toast.success(
          tf(
            "orders.orderCancelledRefunded",
            "Order cancelled. {amount} is on its way back to you.",
            { amount: formatPrice(refund.amount) },
          ),
        );
      } else if (
        refund &&
        !refund.refunded &&
        (typeof refund.amount === "number" || refund.failed)
      ) {
        // Cancelled, but the money did not go back on its own: the gateway
        // refused an amount, or the refund never ran. Saying "cancelled" and
        // nothing else would hide that it is still owed. Every other refusal —
        // nothing was collected, already refunded — owes nothing, and gets the
        // plain message below.
        toast.warning(
          tf(
            "orders.preorderManage.cancelledRefundPending",
            "Pre-order cancelled. Your refund could not be sent automatically — we will return it to you.",
          ),
        );
      } else {
        toast.success(tf("orders.orderCancelled", "Order cancelled"));
      }
      setConfirming(false);
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : tf("orders.orderCancelFailed", "The pre-order could not be cancelled"),
      );
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="gap-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="h-4 w-4" />
            {tf("orders.preorderManage.expected", "Expected to ship")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {order.cancelled ? (
            <p className="text-muted-foreground">
              {tf(
                "orders.preorderManage.isCancelled",
                "This pre-order has been cancelled.",
              )}
            </p>
          ) : (
            <>
              <p className="font-medium">
                {order.releaseDateLabel ||
                  tf("orders.preorderManage.dateToBeConfirmed", "Date to be confirmed")}
              </p>
              {order.originalReleaseDateLabel ? (
                <p className="text-muted-foreground">
                  {tf(
                    "orders.preorderDetails.movedFrom",
                    "Originally expected {date}",
                    { date: order.originalReleaseDateLabel },
                  )}
                  {order.delayReason ? ` — ${order.delayReason}` : ""}
                </p>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      {order.balance && balanceToken ? (
        <PreorderBalanceCard
          order={order.balance}
          locale={locale}
          accessToken={balanceToken}
          onPaid={() => router.refresh()}
        />
      ) : null}

      {!order.cancelled && order.shippingAddress ? (
        <Card className="gap-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPin className="h-4 w-4" />
              {tf("checkout.shippingAddress", "Shipping address")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="space-y-0.5 text-muted-foreground">
              <p className="font-medium text-foreground">
                {order.shippingAddress.fullName ||
                  [order.shippingAddress.firstName, order.shippingAddress.lastName]
                    .filter(Boolean)
                    .join(" ")}
              </p>
              <p>{order.shippingAddress.street}</p>
              {order.shippingAddress.apartment ? (
                <p>{order.shippingAddress.apartment}</p>
              ) : null}
              <p>
                {[order.shippingAddress.city, order.shippingAddress.state]
                  .filter(Boolean)
                  .join(", ")}{" "}
                {order.shippingAddress.postalCode}
              </p>
              <p>{order.shippingAddress.country}</p>
            </div>
            {order.addressBlocker ? (
              <p className="text-xs text-muted-foreground">{order.addressBlocker}</p>
            ) : (
              <PreorderAddressEditor
                orderId={order._id}
                address={order.shippingAddress}
                accessToken={manageToken}
                onSaved={() => router.refresh()}
              />
            )}
          </CardContent>
        </Card>
      ) : null}

      {order.canCancel ? (
        <Card className="gap-2">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-muted-foreground">
              {tf(
                "orders.preorderManage.cancelHint",
                "Changed your mind? Cancel before it ships for a full refund of anything you have paid.",
              )}
            </p>
            <Button variant="outline" onClick={() => setConfirming(true)}>
              <XCircle className="mr-2 h-4 w-4" />
              {tf("orders.preorderManage.cancel", "Cancel pre-order")}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Dialog open={confirming} onOpenChange={(next) => !cancelling && setConfirming(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {tf("orders.preorderManage.confirmTitle", "Cancel this pre-order?")}
            </DialogTitle>
            <DialogDescription>
              {tf(
                "orders.preorderManage.confirmBody",
                "Anything you have paid is refunded to the way you paid. This can't be undone.",
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirming(false)}
              disabled={cancelling}
            >
              {tf("orders.keepOrder", "Keep my pre-order")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void cancel()}
              disabled={cancelling}
            >
              {cancelling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {tf("orders.preorderManage.confirmCancel", "Cancel and refund")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
