"use client";

import { useTranslations } from "next-intl";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import type { Settings } from "@/components/admin/settings/types";
import { AutomationSection } from "./automation-card";
import { CarrierAccounts, type CarrierActions } from "./carriers-card";
import { CourierLinksSection } from "./courier-links-card";
import { PackagesSection } from "./packages-card";

/**
 * Settings → Shipping & Delivery → Carriers & labels: everything between an
 * order being packed and its tracking number reaching the customer. The
 * switch covers the carrier accounts and what only they use — the boxes a
 * quote is priced on and automatic shipping. Tracking links stay either way:
 * a store with no carrier account types every tracking number in by hand.
 */
export function CarriersLabelsCard(
  props: CarrierActions & {
    settings: Settings;
    updateField: (path: string, value: unknown) => void;
  },
) {
  const t = useTranslations("admin.settings.shipping.carriers");
  const shipping = props.settings.shipping;
  const enabled = Boolean(shipping.carriers?.enabled);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
        <CardAction>
          <Switch
            checked={enabled}
            aria-label={t("enable")}
            onCheckedChange={(checked) =>
              props.updateField("shipping.carriers.enabled", checked)
            }
          />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-6">
        {enabled ? (
          <>
            <CarrierAccounts {...props} />
            <PackagesSection
              packages={Array.isArray(shipping.packages) ? shipping.packages : []}
              weightUnit={shipping.weightUnit === "lb" ? "lb" : "kg"}
              updateField={props.updateField}
            />
            <AutomationSection
              automation={shipping.automation}
              currency={props.settings.general.defaultCurrency || "USD"}
              updateField={props.updateField}
            />
          </>
        ) : null}
        <CourierLinksSection
          links={
            Array.isArray(shipping.courierTrackingLinks)
              ? shipping.courierTrackingLinks
              : []
          }
          updateField={props.updateField}
        />
      </CardContent>
    </Card>
  );
}
