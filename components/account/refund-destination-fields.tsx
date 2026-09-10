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
}

export function RefundDestinationFields({
  value,
  onChange,
}: RefundDestinationFieldsProps) {
  const method = value.method || "";
  const required = new Set(getRefundDestinationRequiredFields(method));
  const isMobileMoney = method === "mobile_money";

  const set = (field: keyof RefundDestinationInput, next: string) =>
    onChange({ ...value, [field]: next });

  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        <Label htmlFor="refund-destination-method">
          Where should we send the refund?
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
            <SelectValue placeholder="Choose a method" />
          </SelectTrigger>
          <SelectContent>
            {REFUND_DESTINATION_METHODS.map((option) => (
              <SelectItem key={option} value={option}>
                {getRefundDestinationLabel(option)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          You paid on delivery, so there is no card to refund. Tell us where to
          send the money.
        </p>
      </div>

      {required.has("provider") ? (
        <div className="grid gap-2">
          <Label htmlFor="refund-destination-provider">
            {isMobileMoney ? "Mobile money provider" : "Bank name"}
          </Label>
          <Input
            id="refund-destination-provider"
            value={value.provider || ""}
            onChange={(event) => set("provider", event.target.value)}
            placeholder={isMobileMoney ? "bKash, Nagad, …" : "Your bank"}
            maxLength={120}
          />
        </div>
      ) : null}

      {required.has("accountNumber") ? (
        <div className="grid gap-2">
          <Label htmlFor="refund-destination-number">
            {isMobileMoney ? "Mobile money number" : "Account number"}
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
          <Label htmlFor="refund-destination-name">Account holder&apos;s name</Label>
          <Input
            id="refund-destination-name"
            value={value.accountName || ""}
            onChange={(event) => set("accountName", event.target.value)}
            placeholder="Exactly as it appears on the account"
            maxLength={120}
          />
        </div>
      ) : null}

      {method === "cash" ? (
        <p className="text-xs text-muted-foreground">
          The store will arrange handing the refund to you in person.
        </p>
      ) : null}
    </div>
  );
}
