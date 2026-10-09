"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SettingList,
  SettingRow,
  SettingSwitchItem,
  SettingUnit,
} from "@/components/admin/settings/fields/setting-row";
import type { Settings } from "@/components/admin/settings/types";
import { resolveAddressHoldSettings } from "@/lib/orders/address-hold-policy";

type AddressHoldSettings = NonNullable<Settings["shipping"]["addressHold"]>;

/** "3, 1, 3" → [1, 3]: whole days from 1, each once, in order. */
export function parseReminderDays(text: string): number[] {
  const days = text
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((day) => Number.isInteger(day) && day >= 1);
  return [...new Set(days)].sort((a, b) => a - b);
}

/**
 * What happens when an order's delivery address can't be delivered to.
 *
 * Shipping pauses (an "address hold"), the customer is asked to correct it,
 * reminded, and at the deadline the store is told or the order is cancelled
 * and refunded. Checks at checkout and after the order catch it before a
 * courier ever refuses a label.
 *
 * The reminders and the deadline show whatever "Ask the customer
 * automatically" says: staff can send the request by hand from the order, and
 * it runs on the same clock.
 */
export function AddressHoldCard(props: {
  addressHold?: AddressHoldSettings;
  updateField: (path: string, value: unknown) => void;
}) {
  const t = useTranslations("admin.settings.shipping.addressHold");
  const tUnits = useTranslations("admin.settings.shipping.units");
  const value = resolveAddressHoldSettings(props.addressHold);
  const set = (key: keyof AddressHoldSettings, next: unknown) =>
    props.updateField(`shipping.addressHold.${key}`, next);
  const [reminderDraft, setReminderDraft] = useState(value.reminderDays.join(", "));
  // The text being typed shows only while it still says what the form holds,
  // so a Discard is not hidden behind old text. Compared with the days as
  // typed, not as resolved: a reminder past the deadline is dropped from
  // `value`, and the box must keep showing it for the admin to correct.
  const heldDays = props.addressHold?.reminderDays;
  const reminderText =
    Array.isArray(heldDays) && parseReminderDays(reminderDraft).join() === heldDays.join()
      ? reminderDraft
      : value.reminderDays.join(", ");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <SettingList>
          <SettingSwitchItem
            title={t("suggestAtCheckout")}
            description={t("suggestAtCheckoutHint")}
            checked={value.suggestAtCheckout}
            onCheckedChange={(next) => set("suggestAtCheckout", next)}
          />
          <SettingSwitchItem
            title={t("checkAfterOrder")}
            description={t("checkAfterOrderHint")}
            checked={value.checkAfterOrder}
            onCheckedChange={(next) => set("checkAfterOrder", next)}
          />
          <SettingSwitchItem
            title={t("autoRequest")}
            description={t("autoRequestHint")}
            checked={value.autoRequest}
            onCheckedChange={(next) => set("autoRequest", next)}
          />

          <SettingRow
            inputId="address-hold-reminders"
            label={t("reminderDays")}
            hint={t("reminderDaysHint")}
          >
            <Input
              id="address-hold-reminders"
              className="w-28"
              value={reminderText}
              placeholder="1, 3"
              onChange={(event) => {
                setReminderDraft(event.target.value);
                set("reminderDays", parseReminderDays(event.target.value));
              }}
            />
            <SettingUnit>{tUnits("days")}</SettingUnit>
          </SettingRow>
          <SettingRow
            inputId="address-hold-deadline"
            label={t("deadlineDays")}
            hint={t("deadlineDaysHint")}
          >
            <NumberInput
              id="address-hold-deadline"
              className="w-20"
              min={1}
              max={60}
              step={1}
              normalize={Math.trunc}
              whenEmpty="keep"
              value={value.deadlineDays}
              onValueChange={(next) => set("deadlineDays", next)}
            />
            <SettingUnit>{tUnits("days")}</SettingUnit>
          </SettingRow>
          <SettingRow inputId="address-hold-on-deadline" label={t("onDeadline")}>
            <Select value={value.onDeadline} onValueChange={(next) => set("onDeadline", next)}>
              <SelectTrigger id="address-hold-on-deadline" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="notify">{t("onDeadlineNotify")}</SelectItem>
                <SelectItem value="cancel">{t("onDeadlineCancel")}</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>

          <SettingSwitchItem
            title={t("keepReturnShipping")}
            description={t("keepReturnShippingHint")}
            checked={value.keepReturnShipping}
            onCheckedChange={(next) => set("keepReturnShipping", next)}
          />
        </SettingList>
      </CardContent>
    </Card>
  );
}
