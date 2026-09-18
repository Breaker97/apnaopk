"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingSwitchRow } from "@/components/admin/settings/fields/setting-switch-row";
import {
  DEFAULT_RETURN_WINDOW_DAYS,
  MAX_RETURN_WINDOW_DAYS,
  MIN_RETURN_WINDOW_DAYS,
} from "@/lib/returns/return-policy";
import type { Settings } from "@/components/admin/settings/types";
import { SettingsTabHeader } from "./settings-tab-header";
import { StickySaveFooter } from "./sticky-save-footer";

export function OrdersSettingsTab(props: {
  settings: Settings;
  isSaving: boolean;
  isDirty: boolean;
  updateNestedField: (path: string, value: unknown) => void;
  onSave: () => void | Promise<unknown>;
}) {
  const t = useTranslations();
  const { settings, isSaving, isDirty, updateNestedField, onSave } = props;
  const currencyCode = settings.general.defaultCurrency || "USD";
  const withCurrency = (label: string) =>
    `${label.replace(/\s*\([^)]*\)\s*$/, "")} (${currencyCode})`;
  const taxPercent = Number((settings.orders.taxRate * 100).toFixed(4));
  // These two are read by `legacyShipping()` in lib/shipping.ts and nowhere
  // else, and that runs only while zone shipping is off. Left looking editable
  // once zones are live, an admin sets a free-shipping threshold here and it
  // never reaches a single order.
  const zoneShippingEnabled = Boolean(settings.shipping?.enabled);
  // Every field below reads through a default rather than off the document: a
  // store saved before these settings existed carries none of them, and the
  // defaults are the behaviour it already has.
  const returns = settings.orders.returns ?? {};

  return (
    <div className="space-y-4">
      <SettingsTabHeader
        title={t("admin.settings.orders.title")}
        description={t("admin.settings.orders.description")}
      />
      <Card>
        <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="orderPrefix">
              {t("admin.settings.orders.prefix")}
            </Label>
            <Input
              id="orderPrefix"
              value={settings.orders.prefix}
              onChange={(e) =>
                updateNestedField("orders.prefix", e.target.value.toUpperCase())
              }
              placeholder="ORD"
              minLength={2}
              maxLength={10}
              pattern="[A-Z0-9]{2,10}"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="taxRate">
              {t("admin.settings.orders.taxRate")}
            </Label>
            <NumberInput
              id="taxRate"
              min={0}
              max={100}
              step={0.01}
              value={taxPercent}
              whenEmpty={0}
              onValueChange={(next) =>
                updateNestedField("orders.taxRate", (next ?? 0) / 100)
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="defaultShippingCost">
              {withCurrency(t("admin.settings.orders.shippingCost"))}
            </Label>
            <NumberInput
              id="defaultShippingCost"
              min={0}
              step={0.01}
              disabled={zoneShippingEnabled}
              value={settings.orders.defaultShippingCost}
              whenEmpty={0}
              onValueChange={(next) => updateNestedField("orders.defaultShippingCost", next ?? 0)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="freeShippingThreshold">
              {withCurrency(t("admin.settings.orders.freeShippingThreshold"))}
            </Label>
            <NumberInput
              id="freeShippingThreshold"
              min={0}
              step={0.01}
              disabled={zoneShippingEnabled}
              value={settings.orders.freeShippingThreshold ?? 0}
              placeholder={t("admin.settings.orders.freeShippingPlaceholder")}
              whenEmpty={0}
              onValueChange={(next) =>
                updateNestedField("orders.freeShippingThreshold", next ?? 0)
              }
            />
          </div>
        </div>
        {zoneShippingEnabled ? (
          <p className="text-sm text-muted-foreground">
            {t("admin.settings.orders.shippingHandledByZones")}
          </p>
        ) : null}
        <Separator />
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="vendorCommissionRate">
              {t("admin.settings.orders.commissionRate")}
            </Label>
            <NumberInput
              id="vendorCommissionRate"
              min={0}
              max={100}
              step={0.01}
              value={settings.orders.commission?.vendorRate ?? 0}
              whenEmpty={0}
              onValueChange={(next) => updateNestedField("orders.commission.vendorRate", next ?? 0)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="minWithdrawalAmount">
              {withCurrency(t("admin.settings.orders.minWithdrawal"))}
            </Label>
            <NumberInput
              id="minWithdrawalAmount"
              min={0}
              step={0.01}
              value={settings.orders.commission?.minWithdrawalAmount ?? 0}
              whenEmpty={0}
              onValueChange={(next) => updateNestedField("orders.commission.minWithdrawalAmount", next ?? 0)}
            />
          </div>
        </div>

        <Separator />
        <div className="space-y-1">
          <h3 className="font-medium">
            {t("admin.settings.orders.returnsHeading")}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t("admin.settings.orders.returnsHint")}
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="returnWindowDays">
              {t("admin.settings.orders.returnWindowDays")}
            </Label>
            <NumberInput
              id="returnWindowDays"
              min={MIN_RETURN_WINDOW_DAYS}
              max={MAX_RETURN_WINDOW_DAYS}
              step={1}
              value={returns.windowDays ?? DEFAULT_RETURN_WINDOW_DAYS}
              whenEmpty={DEFAULT_RETURN_WINDOW_DAYS}
              onValueChange={(next) =>
                updateNestedField(
                  "orders.returns.windowDays",
                  next ?? DEFAULT_RETURN_WINDOW_DAYS,
                )
              }
            />
            <p className="text-sm text-muted-foreground">
              {t("admin.settings.orders.returnWindowDaysHint")}
            </p>
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="returnShippingRefund">
              {t("admin.settings.orders.shippingRefund")}
            </Label>
            <Select
              value={returns.shippingRefund ?? "never"}
              onValueChange={(value) =>
                updateNestedField("orders.returns.shippingRefund", value)
              }
            >
              <SelectTrigger id="returnShippingRefund">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="never">
                  {t("admin.settings.orders.shippingRefundNever")}
                </SelectItem>
                <SelectItem value="merchant_fault">
                  {t("admin.settings.orders.shippingRefundMerchantFault")}
                </SelectItem>
                <SelectItem value="always">
                  {t("admin.settings.orders.shippingRefundAlways")}
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              {t("admin.settings.orders.shippingRefundHint")}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="restockingFeePercent">
              {t("admin.settings.orders.restockingFee")}
            </Label>
            <NumberInput
              id="restockingFeePercent"
              min={0}
              max={100}
              step={0.01}
              value={returns.restockingFeePercent ?? 0}
              whenEmpty={0}
              onValueChange={(next) => updateNestedField("orders.returns.restockingFeePercent", next ?? 0)}
            />
            <p className="text-sm text-muted-foreground">
              {t("admin.settings.orders.restockingFeeHint")}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="returnShippingFee">
              {t("admin.settings.orders.returnShippingFee", {
                currency: currencyCode,
              })}
            </Label>
            <NumberInput
              id="returnShippingFee"
              min={0}
              step={0.01}
              value={returns.returnShippingFee ?? 0}
              whenEmpty={0}
              onValueChange={(next) => updateNestedField("orders.returns.returnShippingFee", next ?? 0)}
            />
            <p className="text-sm text-muted-foreground">
              {t("admin.settings.orders.returnShippingFeeHint")}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="refundAdminFeePercent">
              {t("admin.settings.orders.refundAdminFee")}
            </Label>
            <NumberInput
              id="refundAdminFeePercent"
              min={0}
              max={100}
              step={0.01}
              value={returns.refundAdminFeePercent ?? 0}
              whenEmpty={0}
              onValueChange={(next) => updateNestedField("orders.returns.refundAdminFeePercent", next ?? 0)}
            />
            <p className="text-sm text-muted-foreground">
              {t("admin.settings.orders.refundAdminFeeHint")}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="refundAdminFeeCap">
              {t("admin.settings.orders.refundAdminFeeCap", {
                currency: currencyCode,
              })}
            </Label>
            <NumberInput
              id="refundAdminFeeCap"
              min={0}
              step={0.01}
              value={returns.refundAdminFeeCap ?? 0}
              whenEmpty={0}
              onValueChange={(next) => updateNestedField("orders.returns.refundAdminFeeCap", next ?? 0)}
            />
            <p className="text-sm text-muted-foreground">
              {t("admin.settings.orders.refundAdminFeeCapHint")}
            </p>
          </div>
        </div>

        <SettingSwitchRow
          id="billVendorCodShipping"
          title={t("admin.settings.orders.billVendorCodShipping")}
          description={t("admin.settings.orders.billVendorCodShippingHint")}
          checked={returns.billVendorCodShipping ?? false}
          onCheckedChange={(checked) =>
            updateNestedField("orders.returns.billVendorCodShipping", checked)
          }
        />

          <StickySaveFooter
            label={t("admin.settings.general.save")}
            isSaving={isSaving}
            isDirty={isDirty}
            onSave={onSave}
          />
        </CardContent>
      </Card>
    </div>
  );
}
