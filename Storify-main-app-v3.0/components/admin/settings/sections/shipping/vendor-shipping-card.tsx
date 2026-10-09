"use client";

import { useTranslations } from "next-intl";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
} from "@/components/admin/settings/fields/setting-row";
import type { Settings } from "@/components/admin/settings/types";

/**
 * Settings → Shipping & Delivery → Vendors: how shipping works when an order
 * holds several vendors' items. The page shows it only with Multi-Vendor Mode
 * on; a store with no vendors has neither question to answer.
 */
export function VendorShippingCard(props: {
  settings: Settings;
  updateField: (path: string, value: unknown) => void;
}) {
  const t = useTranslations("admin.settings.shipping");
  const shipping = props.settings.shipping;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("vendors.title")}</CardTitle>
        <CardDescription>{t("vendors.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <SettingList>
          <SettingSwitchItem
            title={t("vendorShipping.title")}
            description={t("vendorShipping.description")}
            checked={Boolean(shipping.vendorShipping?.enabled)}
            onCheckedChange={(checked) =>
              props.updateField("shipping.vendorShipping.enabled", checked)
            }
          />
          {/* Which way money moves on a cash sale. Individual vendors can
              override it; the resolved answer is frozen onto each order at
              checkout, so changing this never rewrites past orders. */}
          <SettingRow
            inputId="codCollectedBy"
            label={t("codCollectedBy.title")}
            hint={t("codCollectedBy.description")}
            align="start"
          >
            <Select
              value={String(shipping.codCollectedBy || "vendor")}
              onValueChange={(value) => props.updateField("shipping.codCollectedBy", value)}
            >
              <SelectTrigger id="codCollectedBy" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vendor">{t("codCollectedBy.vendor")}</SelectItem>
                <SelectItem value="platform">{t("codCollectedBy.platform")}</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
        </SettingList>
      </CardContent>
    </Card>
  );
}
