"use client";

/**
 * Where a cash-on-delivery refund should be sent.
 *
 * Asked at the moment the shopper requests the return, not chased afterwards.
 * A COD order has no payment instrument to reverse, so without this the shop
 * approves a refund and then has to email the shopper for bank details — and
 * the money sits unmoved in the meantime.
 *
 * Which fields matter is decided by `lib/refund-settlement.ts`, the same rules
 * the API validates against, so the form cannot ask for less than the server
 * requires.
 */

import { useTranslations } from "next-intl";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  REFUND_DESTINATION_METHODS,
  getRefundDestinationLabel,
  getRefundDestinationRequiredFields,
  type RefundDestinationInput,
} from "@/lib/returns/refund-settlement";

interface RefundDestinationFieldsProps {
  value: RefundDestinationInput;
  onChange: (next: RefundDestinationInput) => void;
  /** How the order was paid, so the form says why it is asking. */
  paymentMethod?: string;
  channel?: string;
}

export function RefundDestinationFields({
  value,
  onChange,
  paymentMethod,
  channel,
}: RefundDestinationFieldsProps) {
  const t = useTranslations();
  const tf = useFallbackTranslator(t);
  const method = value.method || "";
  const required = new Set(getRefundDestinationRequiredFields(method));
  const isMobileMoney = method === "mobile_money";
  // Why there is no card to give the money back to. "You paid on delivery"
  // was said to everyone — to a shopper who paid by bank transfer, mobile
  // money, or at the shop's own counter.
  const paidWith = String(paymentMethod || "").toLowerCase();
  const why =
    String(channel || "").toLowerCase() === "pos"
      ? tf(
          "orders.returns.destination.whyCounter",
          "You paid at the store's counter, so the refund is handed back the same way. Tell us where to send it.",
        )
      : paidWith === "cod" || paidWith === "cash_on_delivery"
        ? tf(
            "orders.returns.destination.whyCod",
            "You paid on delivery, so there is no card to refund. Tell us where to send the money.",
          )
        : paidWith === "bank_transfer"
          ? tf(
              "orders.returns.destination.whyBankTransfer",
              "You paid by bank transfer, so the refund is sent back by hand. Tell us where to send it.",
            )
          : tf(
              "orders.returns.destination.whyOther",
              "This payment cannot be refunded automatically, so the refund is sent back by hand. Tell us where to send it.",
            );

  const set = (field: keyof RefundDestinationInput, next: string) =>
    onChange({ ...value, [field]: next });

  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        <Label htmlFor="refund-destination-method">
          {tf("orders.returns.destination.where", "Where should we send the refund?")}
        </Label>
        <Select
          value={method}
          onValueChange={(next) =>
            // Fields belonging to the previous method would otherwise be sent
            // along with the new one and stored as a destination nobody asked
            // for.
            onChange({ method: next, note: value.note })
          }
        >
          <SelectTrigger id="refund-destination-method" className="w-full">
            <SelectValue
              placeholder={tf("orders.returns.destination.chooseMethod", "Choose a method")}
            />
          </SelectTrigger>
          <SelectContent>
            {REFUND_DESTINATION_METHODS.map((option) => (
              <SelectItem key={option} value={option}>
                {tf(
                  `orders.returns.destination.methods.${option}`,
                  getRefundDestinationLabel(option),
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{why}</p>
      </div>

      {required.has("provider") ? (
        <div className="grid gap-2">
          <Label htmlFor="refund-destination-provider">
            {isMobileMoney
              ? tf("orders.returns.destination.mobileProvider", "Mobile money provider")
              : tf("orders.returns.destination.bankName", "Bank name")}
          </Label>
          <Input
            id="refund-destination-provider"
            value={value.provider || ""}
            onChange={(event) => set("provider", event.target.value)}
            placeholder={
              isMobileMoney
                ? tf("orders.returns.destination.mobileProviderPlaceholder", "bKash, Nagad, …")
                : tf("orders.returns.destination.bankNamePlaceholder", "Your bank")
            }
            maxLength={120}
          />
        </div>
      ) : null}

      {required.has("accountNumber") ? (
        <div className="grid gap-2">
          <Label htmlFor="refund-destination-number">
            {isMobileMoney
              ? tf("orders.returns.destination.mobileNumber", "Mobile money number")
              : tf("orders.returns.destination.accountNumber", "Account number")}
          </Label>
          <Input
            id="refund-destination-number"
            value={value.accountNumber || ""}
            onChange={(event) => set("accountNumber", event.target.value)}
            inputMode={isMobileMoney ? "tel" : "numeric"}
            maxLength={64}
          />
        </div>
      ) : null}

      {required.has("accountName") ? (
        <div className="grid gap-2">
          <Label htmlFor="refund-destination-name">
            {tf("orders.returns.destination.accountName", "Account holder's name")}
          </Label>
          <Input
            id="refund-destination-name"
            value={value.accountName || ""}
            onChange={(event) => set("accountName", event.target.value)}
            placeholder={tf(
              "orders.returns.destination.accountNamePlaceholder",
              "Exactly as it appears on the account",
            )}
            maxLength={120}
          />
        </div>
      ) : null}

      {method === "cash" ? (
        <p className="text-xs text-muted-foreground">
          {tf(
            "orders.returns.destination.cashNote",
            "The store will arrange handing the refund to you in person.",
          )}
        </p>
      ) : null}
    </div>
  );
}
