"use client";

import { useState } from "react";
import { useRouter } from "@/hooks/use-locale-navigation";
import { useTranslations } from "next-intl";
import { Loader2, MapPin } from "lucide-react";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
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
import { toast } from "@/components/ui/toast-notification";
import { WarningBanner } from "@/components/ui/warning-banner";
import { apiClient } from "@/lib/api/client";
import {
  AddressCorrectionForm,
  type CorrectableAddress,
} from "@/components/orders/address-correction-form";
import type { AddressHold } from "@/lib/orders/address-hold-policy";

/**
 * The store's view of an address hold, above the order.
 *
 * Amber while shipping waits on the address; red once the customer's deadline
 * has passed; green for a few days after the hold was released, so whoever
 * opens the order next can see why a label suddenly appeared. The actions are
 * the four the store has: correct the address, ask the customer (again),
 * confirm the address and ship anyway, or cancel and refund.
 *
 * `apiBase` decides who is looking. A seller only re-sends the request — the
 * address belongs to the whole order, not to one seller's parcel.
 */

const RELEASED_BANNER_DAYS = 3;

function day(value?: Date | string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(value));
}

export function OrderAddressHoldBanner(props: {
  orderId: string;
  orderNumber: string;
  address: CorrectableAddress;
  hold?: AddressHold | null;
  apiBase: "/api/admin" | "/api/vendor";
  /** Staff without edit rights see the banner and nothing to press. */
  readOnly?: boolean;
  /** Cancelling is a separate permission from editing. */
  canCancel?: boolean;
  onChanged?: () => void;
}) {
  const t = useTranslations();
  const tf = useFallbackTranslator(t);
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [note, setNote] = useState("");
  // Read once: the green banner only needs to know whether the release is recent.
  const [now] = useState(() => Date.now());

  const hold = props.hold;
  if (!hold) return null;

  const isStore = props.apiBase === "/api/admin";
  const refresh = () => {
    props.onChanged?.();
    router.refresh();
  };

  if (hold.state === "released") {
    const releasedAt = hold.releasedAt ? new Date(hold.releasedAt).getTime() : 0;
    const recent = now - releasedAt < RELEASED_BANNER_DAYS * 24 * 60 * 60 * 1000;
    if (!recent || hold.releaseReason === "order_cancelled") return null;
    const why =
      hold.releaseReason === "address_changed"
        ? tf("orders.addressHold.releasedByCustomer", "The customer corrected the address and the courier accepts it.")
        : hold.releaseReason === "store_edited"
          ? tf("orders.addressHold.releasedByEdit", "Staff corrected the address and the courier accepts it.")
          : tf("orders.addressHold.releasedByConfirm", "Staff confirmed the address is correct.");
    return (
      <div role="status" className="rounded-md border-l-2 border-emerald-500 bg-emerald-500/5 px-4 py-3">
        <p className="text-sm font-medium">
          {tf("orders.addressHold.releasedTitle", "Address hold released — shipping resumed")}
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {why} {day(hold.releasedAt)}
        </p>
      </div>
    );
  }

  const expired = Boolean(hold.expiredAt);
  const act = async (key: string, body: Record<string, unknown>, success?: string) => {
    setBusy(key);
    try {
      await apiClient.post(`${props.apiBase}/orders/${props.orderId}/address-hold`, body);
      if (success) toast.success(success);
      refresh();
      return true;
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : tf("orders.addressHold.actionFailed", "That didn't work — try again"),
      );
      return false;
    } finally {
      setBusy(null);
    }
  };

  const cancelOrder = async () => {
    setBusy("cancel");
    try {
      await apiClient.put(`/api/admin/orders/${props.orderId}`, {
        status: "cancelled",
        cancelReason: "The delivery address couldn't be corrected",
      });
      toast.success(tf("orders.addressHold.cancelled", "Order cancelled"));
      setCancelOpen(false);
      refresh();
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : tf("orders.addressHold.cancelFailed", "The order could not be cancelled"),
      );
    } finally {
      setBusy(null);
    }
  };

  const requested = Boolean(hold.requestedAt);
  const facts = [
    requested
      ? `${tf("orders.addressHold.customerAsked", "Customer asked")} ${day(hold.requestedAt)}`
      : tf("orders.addressHold.notAsked", "Customer not asked yet"),
    Number(hold.requestsSent) > 1
      ? `${Number(hold.requestsSent) - 1} ${tf("orders.addressHold.reminders", "reminder(s) sent")}`
      : null,
    hold.deadlineAt
      ? `${expired ? tf("orders.addressHold.deadlinePassed", "deadline passed") : tf("orders.addressHold.deadline", "deadline")} ${day(hold.deadlineAt)}`
      : null,
  ].filter(Boolean);

  return (
    <>
      <WarningBanner
        icon={MapPin}
        tone={expired ? "danger" : "warning"}
        title={
          !expired
            ? tf("orders.addressHold.title", "Shipping is on hold — the delivery address can't be delivered to")
            : hold.customerConfirmedAt
              ? tf(
                  "orders.addressHold.expiredConfirmedTitle",
                  "The deadline passed — the customer says the address is correct",
                )
              : tf("orders.addressHold.expiredTitle", "The customer didn't correct their address in time")
        }
      >
        <div className="space-y-1">
          {hold.message ? <p>{hold.message}</p> : null}
          <p>{facts.join(" · ")}</p>
          {hold.customerConfirmedAt ? (
            <p className="font-medium">
              {tf(
                "orders.addressHold.customerConfirmed",
                "The customer says this address is correct as it is. Check it, then ship anyway or cancel.",
              )}
            </p>
          ) : null}
        </div>

        {/* Below the copy rather than in `action`: four buttons beside the
            text would squeeze it into a narrow column. */}
        {!props.readOnly ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {isStore ? (
              <Button size="sm" onClick={() => setEditOpen(true)}>
                {tf("orders.addressHold.editAddress", "Edit address")}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() =>
                void act(
                  "request",
                  { action: "request" },
                  tf("orders.addressHold.requestSent", "Request sent to the customer"),
                )
              }
            >
              {busy === "request" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {requested
                ? tf("orders.addressHold.resend", "Resend request to customer")
                : tf("orders.addressHold.ask", "Ask the customer")}
            </Button>
            {isStore && expired ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() =>
                  void act(
                    "extend",
                    { action: "extend", days: 7 },
                    tf("orders.addressHold.extended", "Deadline extended by 7 days"),
                  )
                }
              >
                {tf("orders.addressHold.extend", "Give 7 more days")}
              </Button>
            ) : null}
            {isStore ? (
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => setConfirmOpen(true)}>
                {tf("orders.addressHold.shipAnyway", "Address is correct — ship anyway")}
              </Button>
            ) : null}
            {isStore && props.canCancel ? (
              <Button
                size="sm"
                variant="outline"
                className="text-destructive"
                disabled={busy !== null}
                onClick={() => setCancelOpen(true)}
              >
                {tf("orders.addressHold.cancelRefund", "Cancel & refund")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </WarningBanner>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{tf("orders.addressHold.editTitle", "Correct the delivery address")}</DialogTitle>
            <DialogDescription>{props.orderNumber}</DialogDescription>
          </DialogHeader>
          <AddressCorrectionForm
            endpoint={`/api/admin/orders/${props.orderId}/address`}
            address={props.address}
            allowForce
            onCancel={() => setEditOpen(false)}
            onSaved={({ released }) => {
              setEditOpen(false);
              toast.success(
                released
                  ? tf("orders.addressHold.savedReleased", "Address updated — shipping resumed")
                  : tf("orders.addressHold.saved", "Address updated"),
              );
              refresh();
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{tf("orders.addressHold.shipAnywayTitle", "Ship to this address anyway?")}</DialogTitle>
            <DialogDescription>
              {tf(
                "orders.addressHold.shipAnywayBody",
                "A courier couldn't deliver to it. Release the hold only if you've confirmed it — with the customer, or because it's new and not yet in the courier's records.",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="address-hold-note">
              {tf("orders.addressHold.note", "How you confirmed it")}
            </Label>
            <Input
              id="address-hold-note"
              value={note}
              maxLength={300}
              placeholder={tf("orders.addressHold.notePlaceholder", "Called the customer — new building")}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              {tf("common.cancel", "Cancel")}
            </Button>
            <Button
              disabled={busy !== null}
              onClick={async () => {
                const ok = await act(
                  "release",
                  { action: "release", note: note.trim() || undefined },
                  tf("orders.addressHold.resumed", "Shipping resumed"),
                );
                if (ok) setConfirmOpen(false);
              }}
            >
              {busy === "release" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {tf("orders.addressHold.release", "Release hold")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{tf("orders.addressHold.cancelTitle", "Cancel and refund this order?")}</DialogTitle>
            <DialogDescription>
              {tf(
                "orders.addressHold.cancelBody",
                "Stock goes back, any payment is refunded including delivery — no label was bought — and the customer is told why.",
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              {tf("orders.addressHold.keep", "Keep the order")}
            </Button>
            <Button variant="destructive" disabled={busy !== null} onClick={() => void cancelOrder()}>
              {busy === "cancel" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {tf("orders.addressHold.cancelRefund", "Cancel & refund")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
