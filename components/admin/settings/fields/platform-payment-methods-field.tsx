"use client";

import { useTranslations } from "next-intl";
import { Switch } from "@/components/ui/switch";
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
 * the gateway's own enabled flag in Payments, so a gateway that is off in
 * Payments is shown disabled here with a hint instead of a dead toggle.
 */
export function PlatformPaymentMethodsField(props: {
  settings: Settings;
  value: Partial<PlatformPaymentMethodToggles> | undefined;
  onChange: (key: keyof PlatformPaymentMethodToggles, enabled: boolean) => void;
}) {
  const t = useTranslations();
  const notConfigured = t.has("admin.settings.boosting.gatewayDisabledHint")
    ? t("admin.settings.boosting.gatewayDisabledHint")
    : "Enable this gateway in Payment Settings first";

  return (
    <div className="space-y-3">
      {GATEWAYS.map(({ key, label }) => {
        const gatewayEnabled = Boolean(
          props.settings.payment?.[key]?.enabled,
        );
        const allowed = props.value?.[key] ?? true;
        return (
          <div key={key} className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{label}</p>
              {!gatewayEnabled ? (
                <p className="text-sm text-muted-foreground">{notConfigured}</p>
              ) : null}
            </div>
            <Switch
              checked={allowed}
              disabled={!gatewayEnabled}
              onCheckedChange={(v) => props.onChange(key, v)}
            />
          </div>
        );
      })}
    </div>
  );
}
