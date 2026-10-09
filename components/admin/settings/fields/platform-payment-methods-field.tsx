"use client";

import { useLocale, useTranslations } from "next-intl";
import { Switch } from "@/components/ui/switch";
import { WarningBanner } from "@/components/ui/warning-banner";
import { formatList } from "@/lib/intl/list";
import type {
  PlatformPaymentMethodToggles,
  Settings,
} from "@/components/admin/settings/types";

const GATEWAYS: Array<{ key: keyof PlatformPaymentMethodToggles; label: string }> = [
  { key: "stripe", label: "Stripe" },
  { key: "paypal", label: "PayPal" },
  { key: "razorpay", label: "Razorpay" },
  { key: "paystack", label: "Paystack" },
  { key: "pesapal", label: "Pesapal" },
  { key: "iotec", label: "ioTec Pay" },
  { key: "orange_money", label: "Orange Money" },
  { key: "mtn_momo", label: "MTN Mobile Money" },
];

/**
 * Allowlist toggles for which gateways may collect vendor→platform money
 * (boost purchases, plan subscriptions). Shared by the Boosting and
 * Multi-Vendor settings tabs. The effective offer is always this allowlist ∩
 * the gateway's own enabled flag in Payments.
 *
 * Only the gateways that are on in Payments get a switch, two to a row where
 * the card is wide enough; the rest are named in one line under the list.
 * Eight full-width rows, some of them dead switches with a hint each, made
 * this the tallest block of a page it is set on once.
 */
export function PlatformPaymentMethodsField(props: {
  settings: Settings;
  value: Partial<PlatformPaymentMethodToggles> | undefined;
  onChange: (key: keyof PlatformPaymentMethodToggles, enabled: boolean) => void;
}) {
  const t = useTranslations("admin.settings.fields.platformPayments");
  const locale = useLocale();

  const offered = GATEWAYS.filter(({ key }) =>
    Boolean(props.settings.payment?.[key]?.enabled),
  );
  const notOffered = GATEWAYS.filter((gateway) => !offered.includes(gateway));
  const allowed = (key: keyof PlatformPaymentMethodToggles) =>
    props.value?.[key] ?? true;

  if (offered.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("noneOn")}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="@container">
        {/* Hairlines are the grid's own background showing through the gaps. */}
        <div className="bg-border grid gap-px overflow-hidden rounded-lg border @lg:grid-cols-2">
          {offered.map(({ key, label }) => (
            <label
              key={key}
              className="bg-card flex cursor-pointer items-center gap-3 px-4 py-3"
            >
              <span className="min-w-0 flex-1 text-sm font-medium">{label}</span>
              <Switch
                checked={allowed(key)}
                aria-label={t("allow", { name: label })}
                onCheckedChange={(checked) => props.onChange(key, checked)}
              />
            </label>
          ))}
          {/* An odd count leaves the last cell empty: filled, or it shows as a grey block. */}
          {offered.length % 2 === 1 ? (
            <div aria-hidden className="bg-card hidden @lg:block" />
          ) : null}
        </div>
      </div>

      {notOffered.length > 0 ? (
        <p className="text-muted-foreground text-sm">
          {t("offInPayments", {
            gateways: formatList(
              notOffered.map((gateway) => gateway.label),
              locale,
            ),
          })}
        </p>
      ) : null}

      {offered.every(({ key }) => !allowed(key)) ? (
        <WarningBanner>{t("noneAllowed")}</WarningBanner>
      ) : null}
    </div>
  );
}
