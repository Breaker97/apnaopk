"use client";

import { useTranslations } from "next-intl";
import { CreditCard, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

export type PlatformGateway =
  | "stripe"
  | "paypal"
  | "razorpay"
  | "paystack"
  | "pesapal"
  | "iotec"
  | "orange_money"
  | "mtn_momo";

/** Shared so screens that only report a chosen gateway (the billing page's
 *  "paid with" column) name it exactly as the picker did. */
export const GATEWAY_LABELS: Record<PlatformGateway, string> = {
  stripe: "Card (Stripe)",
  paypal: "PayPal",
  razorpay: "Razorpay",
  paystack: "Paystack",
  pesapal: "Pesapal",
  iotec: "ioTec Pay",
  orange_money: "Orange Money",
  mtn_momo: "MTN Mobile Money",
};

/**
 * Gateway radio cards for vendor→platform payments (boost purchases,
 * subscription periods). The list arrives from the server (feature allowlist
 * ∩ enabled gateways); ioTec expands into its mobile-money/card channel
 * choice plus the MSISDN input the collection requires.
 */
export function PaymentMethodPicker(props: {
  methods: PlatformGateway[];
  value: PlatformGateway | null;
  onChange: (method: PlatformGateway) => void;
  iotecChannel: "mobile_money" | "card";
  onIotecChannelChange: (channel: "mobile_money" | "card") => void;
  iotecPhone: string;
  onIotecPhoneChange: (phone: string) => void;
  mtnMomoPhone: string;
  onMtnMomoPhoneChange: (phone: string) => void;
}) {
  const t = useTranslations();
  const label = useFallbackTranslator(t);

  if (props.methods.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {label(
          "boosts.purchase.noMethods",
          "No payment methods are available. Contact the marketplace admin.",
        )}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {props.methods.map((method) => (
        <button
          key={method}
          type="button"
          onClick={() => props.onChange(method)}
          className={cn(
            "flex w-full items-center justify-between rounded-lg border p-3 text-left transition-colors",
            props.value === method
              ? "border-primary bg-primary/5"
              : "hover:bg-muted/50",
          )}
        >
          <span className="flex items-center gap-2 font-medium">
            <CreditCard className="h-4 w-4 text-muted-foreground" />
            {GATEWAY_LABELS[method]}
          </span>
          <span
            className={cn(
              "h-4 w-4 rounded-full border-2",
              props.value === method
                ? "border-primary bg-primary"
                : "border-muted-foreground/40",
            )}
          />
        </button>
      ))}

      {props.value === "iotec" ? (
        <div className="space-y-3 rounded-lg border p-3">
          <div className="flex gap-2">
            {(["mobile_money", "card"] as const).map((channel) => (
              <button
                key={channel}
                type="button"
                onClick={() => props.onIotecChannelChange(channel)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm",
                  props.iotecChannel === channel
                    ? "border-primary bg-primary/5 font-medium"
                    : "hover:bg-muted/50",
                )}
              >
                {channel === "mobile_money" ? (
                  <Smartphone className="h-4 w-4" />
                ) : (
                  <CreditCard className="h-4 w-4" />
                )}
                {channel === "mobile_money"
                  ? label("boosts.purchase.mobileMoney", "Mobile money")
                  : label("boosts.purchase.card", "Card")}
              </button>
            ))}
          </div>
          {props.iotecChannel === "mobile_money" ? (
            <div className="space-y-1.5">
              <Label htmlFor="boost-iotec-phone">
                {label(
                  "boosts.purchase.iotecPhone",
                  "Mobile money number (Uganda)",
                )}
              </Label>
              <Input
                id="boost-iotec-phone"
                type="tel"
                placeholder="07XXXXXXXX"
                value={props.iotecPhone}
                onChange={(e) => props.onIotecPhoneChange(e.target.value)}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {props.value === "mtn_momo" ? (
        <div className="space-y-1.5 rounded-lg border p-3">
          <Label htmlFor="boost-mtn-momo-phone">
            {label("boosts.purchase.mtnMomoPhone", "MTN mobile money number")}
          </Label>
          <Input
            id="boost-mtn-momo-phone"
            type="tel"
            placeholder="07XXXXXXXX"
            value={props.mtnMomoPhone}
            onChange={(e) => props.onMtnMomoPhoneChange(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {label(
              "boosts.purchase.mtnMomoPhoneHint",
              "You'll get a prompt on that phone to approve the payment with your MoMo PIN.",
            )}
          </p>
        </div>
      ) : null}
    </div>
  );
}
