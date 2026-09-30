"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { SettingSwitchRow } from "@/components/admin/settings/fields/setting-switch-row";
import { FinalSaleCollectionsField } from "@/components/admin/settings/fields/final-sale-collections-field";
import { ReturnWindowOverridesField } from "@/components/admin/settings/fields/return-window-overrides-field";
import {
  DEFAULT_PAYOUT_HOLD_MAX_DAYS,
  DEFAULT_RETURN_WINDOW_DAYS,
  MAX_RETURN_WINDOW_DAYS,
  MIN_RETURN_WINDOW_DAYS,
} from "@/lib/returns/return-policy";
import {
  DEFAULT_LOYALTY_SPEND_PER_POINT,
  LOYALTY_THRESHOLDS,
  MAX_LOYALTY_SPEND_PER_POINT,
  MIN_LOYALTY_SPEND_PER_POINT,
} from "@/lib/customers/loyalty";
import type { Settings } from "@/components/admin/settings/types";
import {
  DEFAULT_RETURN_INSTRUCTIONS,
  RETURN_INSTRUCTIONS_MAX_LENGTH,
} from "@/lib/returns/return-shipping";
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
            {t("admin.settings.orders.loyaltyHeading")}
          </h3>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="loyaltySpendPerPoint">
              {withCurrency(t("admin.settings.orders.loyaltySpendPerPoint"))}
            </Label>
            <NumberInput
              id="loyaltySpendPerPoint"
              min={MIN_LOYALTY_SPEND_PER_POINT}
              max={MAX_LOYALTY_SPEND_PER_POINT}
              step={0.01}
              value={
                settings.orders.loyaltySpendPerPoint ??
                DEFAULT_LOYALTY_SPEND_PER_POINT
              }
              whenEmpty={DEFAULT_LOYALTY_SPEND_PER_POINT}
              onValueChange={(next) =>
                updateNestedField(
                  "orders.loyaltySpendPerPoint",
                  next ?? DEFAULT_LOYALTY_SPEND_PER_POINT,
                )
              }
            />
            <p className="text-sm text-muted-foreground">
              {t("admin.settings.orders.loyaltySpendPerPointHint", {
                silver: LOYALTY_THRESHOLDS.silver,
                gold: LOYALTY_THRESHOLDS.gold,
                platinum: LOYALTY_THRESHOLDS.platinum,
              })}
            </p>
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
              disabled={returns.windowUnlimited === true}
              value={returns.windowDays ?? DEFAULT_RETURN_WINDOW_DAYS}
              whenEmpty={DEFAULT_RETURN_WINDOW_DAYS}
              onValueChange={(next) =>
                updateNestedField(
                  "orders.returns.windowDays",
                  next ?? DEFAULT_RETURN_WINDOW_DAYS,
                )
              }
            />
            {/* The number is kept while this is on, for when it is off again. */}
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                id="returnWindowUnlimited"
                checked={returns.windowUnlimited === true}
                onCheckedChange={(checked) =>
                  updateNestedField("orders.returns.windowUnlimited", checked === true)
                }
              />
              {t("admin.settings.orders.windowUnlimited")}
            </label>
            <p className="text-sm text-muted-foreground">
              {t("admin.settings.orders.returnWindowDaysHint")}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="returnWindowStart">
              {t("admin.settings.orders.windowStart")}
            </Label>
            <Select
              value={returns.windowStart ?? "parcel_delivery"}
              onValueChange={(value) =>
                updateNestedField("orders.returns.windowStart", value)
              }
            >
              <SelectTrigger id="returnWindowStart">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="parcel_delivery">
                  {t("admin.settings.orders.windowStartParcel")}
                </SelectItem>
                <SelectItem value="last_delivery">
                  {t("admin.settings.orders.windowStartLast")}
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              {t("admin.settings.orders.windowStartHint")}
            </p>
          </div>

          {returns.windowUnlimited === true ? (
            <div className="space-y-2">
              <Label htmlFor="payoutHoldMaxDays">
                {t("admin.settings.orders.payoutHoldMaxDays")}
              </Label>
              <NumberInput
                id="payoutHoldMaxDays"
                min={MIN_RETURN_WINDOW_DAYS}
                max={MAX_RETURN_WINDOW_DAYS}
                step={1}
                value={returns.payoutHoldMaxDays ?? DEFAULT_PAYOUT_HOLD_MAX_DAYS}
                whenEmpty={DEFAULT_PAYOUT_HOLD_MAX_DAYS}
                onValueChange={(next) =>
                  updateNestedField(
                    "orders.returns.payoutHoldMaxDays",
                    next ?? DEFAULT_PAYOUT_HOLD_MAX_DAYS,
                  )
                }
              />
              <p className="text-sm text-muted-foreground">
                {t("admin.settings.orders.payoutHoldMaxDaysHint")}
              </p>
            </div>
          ) : null}

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

        <div className="space-y-2">
          <Label htmlFor="returnInstructions">
            {t("admin.settings.orders.returnInstructions")}
          </Label>
          <Textarea
            id="returnInstructions"
            rows={4}
            maxLength={RETURN_INSTRUCTIONS_MAX_LENGTH}
            value={returns.instructions ?? ""}
            placeholder={DEFAULT_RETURN_INSTRUCTIONS}
            onChange={(event) =>
              updateNestedField("orders.returns.instructions", event.target.value)
            }
          />
          <p className="text-sm text-muted-foreground">
            {/* The placeholder is shown as itself, for the admin to copy. */}
            {t("admin.settings.orders.returnInstructionsHint", {
              returnNumber: "{returnNumber}",
            })}
          </p>
        </div>

        <FinalSaleCollectionsField
          value={returns.finalSaleCollectionIds ?? []}
          onChange={(next) =>
            updateNestedField("orders.returns.finalSaleCollectionIds", next)
          }
        />

        <ReturnWindowOverridesField
          value={returns.windowOverrides ?? []}
          defaultDays={returns.windowDays ?? DEFAULT_RETURN_WINDOW_DAYS}
          onChange={(next) => updateNestedField("orders.returns.windowOverrides", next)}
        />

        <SettingSwitchRow
          id="returnsSelfServe"
          title={t("admin.settings.orders.selfServe")}
          description={t("admin.settings.orders.selfServeHint")}
          checked={returns.selfServe !== false}
          onCheckedChange={(checked) =>
            updateNestedField("orders.returns.selfServe", checked)
          }
        />

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
