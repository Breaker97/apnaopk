"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, MapPin } from "lucide-react";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { Button } from "@/components/ui/button";
import { WarningBanner } from "@/components/ui/warning-banner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast-notification";
import { apiClient } from "@/lib/api/client";
import {
  AddressCorrectionForm,
  type CorrectableAddress,
} from "@/components/orders/address-correction-form";

/**
 * "We can't deliver to your address" — the customer's side of an address hold.
 *
 * On the account order page for a signed-in shopper, and on the address-link
 * page for anyone (`accessToken` set). Two ways out: correct the address, or
 * say it is right as it is. The second does not release the hold — a courier
 * already refused the address — it tells the store to look.
 */

type CustomerHold = {
  state?: string;
  message?: string;
  deadlineAt?: string | Date;
  customerConfirmedAt?: string | Date;
};

function longDay(value?: string | Date) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en", { month: "long", day: "numeric" }).format(new Date(value));
}

export function CustomerAddressHoldNotice(props: {
  orderId: string;
  orderNumber: string;
  address: CorrectableAddress;
  hold?: CustomerHold | null;
  /** The signed address link, for a guest. */
  accessToken?: string;
  onChanged: () => void;
  /** Render the form inline rather than in a dialog — the address-link page. */
  inline?: boolean;
}) {
  const t = useTranslations();
  const tf = useFallbackTranslator(t);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (props.hold?.state !== "open") return null;
  const hold = props.hold;
  const extraBody = props.accessToken ? { accessToken: props.accessToken } : undefined;

  const confirm = async () => {
    setConfirming(true);
    try {
      await apiClient.post(`/api/orders/${props.orderId}/address/confirm`, extraBody || {});
      toast.success(
        tf("orders.addressHold.confirmedToast", "Thanks — the store will check your address"),
      );
      setOpen(false);
      props.onChanged();
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : tf("orders.addressHold.actionFailed", "That didn't work — try again"),
      );
    } finally {
      setConfirming(false);
    }
  };

  const confirmButton = hold.customerConfirmedAt ? (
    <span className="self-center text-sm text-muted-foreground">
      {tf("orders.addressHold.confirmedAlready", "You told us this address is correct — the store is checking it.")}
    </span>
  ) : (
    <Button type="button" variant="ghost" disabled={confirming} onClick={() => void confirm()}>
      {confirming ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {tf("orders.addressHold.addressIsCorrect", "My address is correct as it is")}
    </Button>
  );

  const form = (
    <AddressCorrectionForm
      endpoint={`/api/orders/${props.orderId}/address`}
      address={props.address}
      extraBody={extraBody}
      secondaryAction={confirmButton}
      onCancel={props.inline ? undefined : () => setOpen(false)}
      onSaved={({ released }) => {
        setOpen(false);
        toast.success(
          released
            ? tf("orders.addressHold.fixedToast", "Address updated — your order will ship")
            : tf("orders.addressHold.saved", "Address updated"),
        );
        props.onChanged();
      }}
    />
  );

  const title = tf("orders.addressHold.customerTitle", "Action needed: we can't deliver to your address");
  const body = (
    <p>
      {hold.message ? `${hold.message}. ` : ""}
      {hold.customerConfirmedAt
        ? tf("orders.addressHold.customerChecking", "Shipping is paused while the store checks your address.")
        : hold.deadlineAt
          ? tf(
              "orders.addressHold.customerDeadline",
              "Shipping is paused. Please correct it by {date}.",
              { date: longDay(hold.deadlineAt) },
            )
          : tf("orders.addressHold.customerPaused", "Shipping is paused until it's corrected.")}
    </p>
  );

  if (props.inline) {
    return (
      <div className="space-y-5">
        <WarningBanner icon={null} title={title}>
          {body}
        </WarningBanner>
        {form}
      </div>
    );
  }

  return (
    <>
      <WarningBanner
        icon={MapPin}
        title={title}
        action={
          <Button size="sm" onClick={() => setOpen(true)}>
            {tf("orders.addressHold.fixAddress", "Fix address")}
          </Button>
        }
      >
        {body}
      </WarningBanner>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{tf("orders.addressHold.fixTitle", "Fix your delivery address")}</DialogTitle>
            <DialogDescription>{props.orderNumber}</DialogDescription>
          </DialogHeader>
          {form}
        </DialogContent>
      </Dialog>
    </>
  );
}
