"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Settings } from "@/components/admin/settings/types";
import { resolveAddressHoldSettings } from "@/lib/orders/address-hold-policy";

type AddressHoldSettings = NonNullable<Settings["shipping"]["addressHold"]>;
type TSafe = (key: string, fallback: string) => string;

/**
 * What happens when an order's delivery address can't be delivered to.
 *
 * Shipping pauses (an "address hold"), the customer is asked to correct it,
 * reminded, and at the deadline the store is told or the order is cancelled
 * and refunded. Checks at checkout and after the order catch it before a
 * courier ever refuses a label.
 */
export function AddressHoldCard(props: {
  addressHold?: AddressHoldSettings;
  tSafe: TSafe;
  updateField: (path: string, value: unknown) => void;
}) {
  const { tSafe, updateField } = props;
  const value = resolveAddressHoldSettings(props.addressHold);
  const set = (key: keyof AddressHoldSettings, next: unknown) =>
    updateField(`shipping.addressHold.${key}`, next);
  const [reminderDraft, setReminderDraft] = useState(value.reminderDays.join(", "));

  const toggle = (
    id: keyof AddressHoldSettings,
    label: string,
    hint: string,
    checked: boolean,
  ) => (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <Label htmlFor={`address-hold-${id}`}>{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch
        id={`address-hold-${id}`}
        checked={checked}
        onCheckedChange={(next) => set(id, next)}
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">
          {tSafe("admin.settings.shipping.addressHold.title", "Undeliverable addresses")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {tSafe(
            "admin.settings.shipping.addressHold.description",
            "When a courier can't deliver to an order's address, shipping pauses and the customer is asked to correct it.",
          )}
        </p>
      </div>

      <div className="space-y-5 rounded-lg border p-4">
        {toggle(
          "suggestAtCheckout",
          tSafe("admin.settings.shipping.addressHold.suggestAtCheckout", "Check the address at checkout"),
          tSafe(
            "admin.settings.shipping.addressHold.suggestAtCheckoutHint",
            "Suggest a correction before the order is placed. The shopper can still keep what they typed. Needs a connected Shippo account.",
          ),
          value.suggestAtCheckout,
        )}
        {toggle(
          "checkAfterOrder",
          tSafe("admin.settings.shipping.addressHold.checkAfterOrder", "Check new orders' addresses"),
          tSafe(
            "admin.settings.shipping.addressHold.checkAfterOrderHint",
            "Put an order on hold as soon as its address fails the check, instead of waiting for a courier to refuse the label.",
          ),
          value.checkAfterOrder,
        )}
        {toggle(
          "autoRequest",
          tSafe("admin.settings.shipping.addressHold.autoRequest", "Ask the customer automatically"),
          tSafe(
            "admin.settings.shipping.addressHold.autoRequestHint",
            "Email the customer a link to correct the address the moment an order goes on hold. Off leaves it to staff.",
          ),
          value.autoRequest,
        )}

        <Separator />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="address-hold-reminders">
              {tSafe("admin.settings.shipping.addressHold.reminderDays", "Remind after (days)")}
            </Label>
            <Input
              id="address-hold-reminders"
              value={reminderDraft}
              placeholder="1, 3"
              onChange={(event) => {
                setReminderDraft(event.target.value);
                const days = event.target.value
                  .split(",")
                  .map((part) => Number(part.trim()))
                  .filter((day) => Number.isInteger(day) && day >= 1);
                set("reminderDays", [...new Set(days)].sort((a, b) => a - b));
              }}
            />
            <p className="text-xs text-muted-foreground">
              {tSafe(
                "admin.settings.shipping.addressHold.reminderDaysHint",
                "Days after the first request, separated by commas. Leave empty for no reminders.",
              )}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="address-hold-deadline">
              {tSafe("admin.settings.shipping.addressHold.deadlineDays", "Deadline (days)")}
            </Label>
            <NumberInput
              id="address-hold-deadline"
              min={1}
              max={60}
              value={value.deadlineDays}
              onValueChange={(next) => set("deadlineDays", next)}
            />
            <p className="text-xs text-muted-foreground">
              {tSafe(
                "admin.settings.shipping.addressHold.deadlineDaysHint",
                "How long the customer has to answer, from the first request.",
              )}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="address-hold-on-deadline">
            {tSafe("admin.settings.shipping.addressHold.onDeadline", "When the deadline passes")}
          </Label>
          <Select value={value.onDeadline} onValueChange={(next) => set("onDeadline", next)}>
            <SelectTrigger id="address-hold-on-deadline">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="notify">
                {tSafe(
                  "admin.settings.shipping.addressHold.onDeadlineNotify",
                  "Tell the store and keep the order on hold",
                )}
              </SelectItem>
              <SelectItem value="cancel">
                {tSafe(
                  "admin.settings.shipping.addressHold.onDeadlineCancel",
                  "Cancel the order and refund it in full",
                )}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Separator />

        {toggle(
          "keepReturnShipping",
          tSafe(
            "admin.settings.shipping.addressHold.keepReturnShipping",
            "Keep return shipping when a parcel comes back",
          ),
          tSafe(
            "admin.settings.shipping.addressHold.keepReturnShippingHint",
            "When a parcel is returned to sender for a bad address, the refund offered deducts the label cost. Orders on hold never shipped, so they are always refunded in full.",
          ),
          value.keepReturnShipping,
        )}
      </div>
    </div>
  );
}
