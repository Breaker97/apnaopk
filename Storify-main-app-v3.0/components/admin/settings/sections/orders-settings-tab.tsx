"use client";

import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import Link from "@/components/language/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Textarea } from "@/components/ui/textarea";
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
import { Checkbox } from "@/components/ui/checkbox";
import { FeatureGroup } from "@/components/admin/settings/fields/feature-row";
import {
  SettingBlock,
  SettingList,
  SettingRow,
  SettingSwitchItem,
  SettingUnit,
} from "@/components/admin/settings/fields/setting-row";
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
  isLoyaltyEnabled,
} from "@/lib/customers/loyalty";
import { formatCurrency } from "@/lib/intl/money";
import type { Settings } from "@/components/admin/settings/types";
import {
  DEFAULT_RETURN_INSTRUCTIONS,
  RETURN_INSTRUCTIONS_MAX_LENGTH,
} from "@/lib/returns/return-shipping";
import { SettingsTabHeader } from "./settings-tab-header";
import { StickySaveFooter } from "./sticky-save-footer";

/** The number after the prefix in the example; lib/orders/order-number.ts pads to six digits. */
const EXAMPLE_ORDER_SEQUENCE = "000124";

/**
 * Settings → Order Settings, in three cards: what every order gets, how
 * returns work, and, with Multi-Vendor Mode on, how vendor sales settle.
 *
 * The vendor commission and minimum payout are edited in Vendors →
 * Configuration. This page only shows them and links there; they used to be
 * editable in both places. The vendor-only rules (the refund administration
 * fee, billing cash-on-delivery shipping, the payout hold) are hidden while
 * the store runs without vendors, and hints that name sellers say what they
 * mean for a single store instead.
 */
export function OrdersSettingsTab(props: {
  settings: Settings;
  isSaving: boolean;
  isDirty: boolean;
  updateNestedField: (path: string, value: unknown) => void;
  onSave: () => void | Promise<unknown>;
  onDiscard?: () => void;
}) {
  const t = useTranslations("admin.settings.orders");
  const tSettings = useTranslations("admin.settings");
  const locale = useLocale();
  const { settings, isSaving, isDirty, updateNestedField, onSave } = props;
  const orders = settings.orders;
  const currencyCode = settings.general.defaultCurrency || "USD";
  const taxPercent = Number((orders.taxRate * 100).toFixed(4));
  // These two are read by `legacyShipping()` in lib/shipping.ts and nowhere
  // else, and that runs only while zone shipping is off. Left looking editable
  // once zones are live, an admin sets a free-shipping threshold here and it
  // never reaches a single order — so with zones on they are not shown.
  const zoneShippingEnabled = Boolean(settings.shipping?.enabled);
  const vendorsOn = Boolean(settings.multiVendorMode?.enabled);
  // Every field below reads through a default rather than off the document: a
  // store saved before these settings existed carries none of them, and the
  // defaults are the behaviour it already has.
  const returns = orders.returns ?? {};
  const unlimited = returns.windowUnlimited === true;
  const daysUnit = t("windowOverrideDaysUnit");

  const shippingSettingsLink = (chunks: ReactNode) => (
    <Link
      href="/admin/settings/shipping"
      className="text-primary font-medium hover:underline"
    >
      {chunks}
    </Link>
  );

  return (
    <div className="space-y-4">
      <SettingsTabHeader title={t("title")} description={t("description")} />

      <Card>
        <CardHeader>
          <CardTitle>{t("ordersHeading")}</CardTitle>
        </CardHeader>
        <CardContent>
          <SettingList>
            <SettingRow
              inputId="orderPrefix"
              label={t("prefix")}
              hint={t.rich("prefixExample", {
                example: `${orders.prefix || "ORD"}${EXAMPLE_ORDER_SEQUENCE}`,
                strong: (chunks) => (
                  <strong className="text-foreground font-medium">{chunks}</strong>
                ),
              })}
            >
              <Input
                id="orderPrefix"
                className="w-28 uppercase"
                value={orders.prefix}
                onChange={(e) =>
                  updateNestedField("orders.prefix", e.target.value.toUpperCase())
                }
                placeholder="ORD"
                minLength={2}
                maxLength={10}
                pattern="[A-Z0-9]{2,10}"
              />
            </SettingRow>

            <SettingRow
              inputId="taxRate"
              label={t("taxRate")}
              hint={t("taxRateHint")}
            >
              <NumberInput
                id="taxRate"
                className="w-24"
                min={0}
                max={100}
                step={0.01}
                value={taxPercent}
                whenEmpty={0}
                onValueChange={(next) =>
                  updateNestedField("orders.taxRate", (next ?? 0) / 100)
                }
              />
              <SettingUnit>%</SettingUnit>
            </SettingRow>

            {zoneShippingEnabled ? (
              <SettingRow label={t("shipping")} hint={t("shippingHandledByZones")}>
                <Button asChild variant="outline">
                  <Link href="/admin/settings/shipping">
                    {t("shippingLink")}
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
              </SettingRow>
            ) : (
              <>
                <SettingRow
                  inputId="defaultShippingCost"
                  label={t("shippingCost")}
                  hint={t("shippingCostHint")}
                >
                  <NumberInput
                    id="defaultShippingCost"
                    className="w-24"
                    min={0}
                    step={0.01}
                    value={orders.defaultShippingCost}
                    whenEmpty={0}
                    onValueChange={(next) =>
                      updateNestedField("orders.defaultShippingCost", next ?? 0)
                    }
                  />
                  <SettingUnit>{currencyCode}</SettingUnit>
                </SettingRow>
                <SettingRow
                  inputId="freeShippingThreshold"
                  label={t("freeShippingThreshold")}
                  hint={t.rich("freeShippingHint", { link: shippingSettingsLink })}
                >
                  <NumberInput
                    id="freeShippingThreshold"
                    className="w-24"
                    min={0}
                    step={0.01}
                    value={orders.freeShippingThreshold ?? 0}
                    whenEmpty={0}
                    onValueChange={(next) =>
                      updateNestedField("orders.freeShippingThreshold", next ?? 0)
                    }
                  />
                  <SettingUnit>{currencyCode}</SettingUnit>
                </SettingRow>
              </>
            )}

            {/* Hidden with the rest of loyalty until the programme is finished
                (see `isLoyaltyEnabled`); the stored rate stays as it is. */}
            {isLoyaltyEnabled() && (
              <SettingRow
                inputId="loyaltySpendPerPoint"
                label={t("loyaltyHeading")}
                hint={t("loyaltySpendPerPointHint", {
                  silver: LOYALTY_THRESHOLDS.silver,
                  gold: LOYALTY_THRESHOLDS.gold,
                  platinum: LOYALTY_THRESHOLDS.platinum,
                })}
              >
                <NumberInput
                  id="loyaltySpendPerPoint"
                  className="w-24"
                  min={MIN_LOYALTY_SPEND_PER_POINT}
                  max={MAX_LOYALTY_SPEND_PER_POINT}
                  step={0.01}
                  value={orders.loyaltySpendPerPoint ?? DEFAULT_LOYALTY_SPEND_PER_POINT}
                  whenEmpty={DEFAULT_LOYALTY_SPEND_PER_POINT}
                  onValueChange={(next) =>
                    updateNestedField(
                      "orders.loyaltySpendPerPoint",
                      next ?? DEFAULT_LOYALTY_SPEND_PER_POINT,
                    )
                  }
                />
                <SettingUnit>{t("loyaltyUnit", { currency: currencyCode })}</SettingUnit>
              </SettingRow>
            )}
          </SettingList>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("returnsHeading")}</CardTitle>
          <CardDescription>{t("returnsDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <SettingList>
            <SettingSwitchItem
              title={t("selfServe")}
              description={t("selfServeHint")}
              checked={returns.selfServe !== false}
              onCheckedChange={(checked) =>
                updateNestedField("orders.returns.selfServe", checked)
              }
            />
          </SettingList>

          <FeatureGroup title={t("eligibilityHeading")}>
            <SettingRow
              inputId="returnWindowDays"
              label={t("returnWindowDays")}
              hint={t("returnWindowDaysHint")}
              align="start"
            >
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center gap-2">
                  <NumberInput
                    id="returnWindowDays"
                    className="w-24"
                    min={MIN_RETURN_WINDOW_DAYS}
                    max={MAX_RETURN_WINDOW_DAYS}
                    step={1}
                    disabled={unlimited}
                    value={returns.windowDays ?? DEFAULT_RETURN_WINDOW_DAYS}
                    whenEmpty={DEFAULT_RETURN_WINDOW_DAYS}
                    onValueChange={(next) =>
                      updateNestedField(
                        "orders.returns.windowDays",
                        next ?? DEFAULT_RETURN_WINDOW_DAYS,
                      )
                    }
                  />
                  <SettingUnit>{daysUnit}</SettingUnit>
                </div>
                {/* The number is kept while this is on, for when it is off again. */}
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    id="returnWindowUnlimited"
                    checked={unlimited}
                    onCheckedChange={(checked) =>
                      updateNestedField(
                        "orders.returns.windowUnlimited",
                        checked === true,
                      )
                    }
                  />
                  {t("windowUnlimited")}
                </label>
              </div>
            </SettingRow>

            {/* Only a vendor's payout waits on the window, so a store without
                vendors has nothing to hold. */}
            {unlimited && vendorsOn ? (
              <SettingRow
                inputId="payoutHoldMaxDays"
                label={t("payoutHoldMaxDays")}
                hint={t("payoutHoldMaxDaysHint")}
                className="bg-muted/30"
              >
                <NumberInput
                  id="payoutHoldMaxDays"
                  className="w-24"
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
                <SettingUnit>{daysUnit}</SettingUnit>
              </SettingRow>
            ) : null}

            <SettingRow
              inputId="returnWindowStart"
              label={t("windowStart")}
              hint={vendorsOn ? t("windowStartHint") : t("windowStartHintStore")}
            >
              <Select
                value={returns.windowStart ?? "parcel_delivery"}
                onValueChange={(value) =>
                  updateNestedField("orders.returns.windowStart", value)
                }
              >
                <SelectTrigger id="returnWindowStart" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="parcel_delivery">
                    {t("windowStartParcel")}
                  </SelectItem>
                  <SelectItem value="last_delivery">
                    {t("windowStartLast")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>

            <ReturnWindowOverridesField
              value={returns.windowOverrides ?? []}
              defaultDays={returns.windowDays ?? DEFAULT_RETURN_WINDOW_DAYS}
              onChange={(next) =>
                updateNestedField("orders.returns.windowOverrides", next)
              }
            />

            <FinalSaleCollectionsField
              value={returns.finalSaleCollectionIds ?? []}
              onChange={(next) =>
                updateNestedField("orders.returns.finalSaleCollectionIds", next)
              }
            />
          </FeatureGroup>

          <FeatureGroup title={t("refundsHeading")}>
            <SettingRow
              inputId="returnShippingRefund"
              label={t("shippingRefund")}
              hint={t("shippingRefundHint")}
            >
              <Select
                value={returns.shippingRefund ?? "never"}
                onValueChange={(value) =>
                  updateNestedField("orders.returns.shippingRefund", value)
                }
              >
                <SelectTrigger id="returnShippingRefund" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="never">{t("shippingRefundNever")}</SelectItem>
                  <SelectItem value="merchant_fault">
                    {t("shippingRefundMerchantFault")}
                  </SelectItem>
                  <SelectItem value="always">{t("shippingRefundAlways")}</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>

            <SettingRow
              inputId="restockingFeePercent"
              label={t("restockingFee")}
              hint={t("restockingFeeHint")}
            >
              <NumberInput
                id="restockingFeePercent"
                className="w-24"
                min={0}
                max={100}
                step={0.01}
                value={returns.restockingFeePercent ?? 0}
                whenEmpty={0}
                onValueChange={(next) =>
                  updateNestedField("orders.returns.restockingFeePercent", next ?? 0)
                }
              />
              <SettingUnit>%</SettingUnit>
            </SettingRow>

            <SettingRow
              inputId="returnShippingFee"
              label={t("returnShippingFee")}
              hint={
                vendorsOn
                  ? t("returnShippingFeeHint")
                  : t("returnShippingFeeHintStore")
              }
            >
              <NumberInput
                id="returnShippingFee"
                className="w-24"
                min={0}
                step={0.01}
                value={returns.returnShippingFee ?? 0}
                whenEmpty={0}
                onValueChange={(next) =>
                  updateNestedField("orders.returns.returnShippingFee", next ?? 0)
                }
              />
              <SettingUnit>{currencyCode}</SettingUnit>
            </SettingRow>

            <SettingBlock
              inputId="returnInstructions"
              label={t("returnInstructions")}
              // The placeholder is shown as itself, for the admin to copy.
              hint={t("returnInstructionsHint", { returnNumber: "{returnNumber}" })}
            >
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
            </SettingBlock>
          </FeatureGroup>
        </CardContent>
      </Card>

      {vendorsOn ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("vendorSalesHeading")}</CardTitle>
            <CardDescription>{t("vendorSalesDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <SettingList>
              <SettingRow
                label={t("commissionSummaryLabel")}
                hint={t("commissionSummary", {
                  rate: orders.commission?.vendorRate ?? 0,
                  amount: formatCurrency(
                    orders.commission?.minWithdrawalAmount ?? 0,
                    currencyCode,
                    locale,
                  ),
                })}
              >
                <Button asChild variant="outline">
                  <Link href="/admin/vendors/configuration">
                    {t("vendorConfigLink")}
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
              </SettingRow>

              <SettingRow
                inputId="refundAdminFeePercent"
                label={t("refundAdminFee")}
                hint={
                  <>
                    {t("refundAdminFeeHint")} {t("refundAdminFeeCapHint")}
                  </>
                }
              >
                <NumberInput
                  id="refundAdminFeePercent"
                  className="w-16 @xl:w-20"
                  min={0}
                  max={100}
                  step={0.01}
                  value={returns.refundAdminFeePercent ?? 0}
                  whenEmpty={0}
                  onValueChange={(next) =>
                    updateNestedField("orders.returns.refundAdminFeePercent", next ?? 0)
                  }
                />
                <SettingUnit>{t("refundAdminFeeUpTo")}</SettingUnit>
                <NumberInput
                  className="w-16 @xl:w-20"
                  aria-label={t("refundAdminFeeCap", { currency: currencyCode })}
                  min={0}
                  step={0.01}
                  value={returns.refundAdminFeeCap ?? 0}
                  whenEmpty={0}
                  onValueChange={(next) =>
                    updateNestedField("orders.returns.refundAdminFeeCap", next ?? 0)
                  }
                />
                <SettingUnit>{currencyCode}</SettingUnit>
              </SettingRow>

              <SettingSwitchItem
                title={t("billVendorCodShipping")}
                description={t("billVendorCodShippingHint")}
                checked={returns.billVendorCodShipping ?? false}
                onCheckedChange={(checked) =>
                  updateNestedField("orders.returns.billVendorCodShipping", checked)
                }
              />
            </SettingList>
          </CardContent>
        </Card>
      ) : null}

      <StickySaveFooter
        label={tSettings("general.save")}
        isSaving={isSaving}
        isDirty={isDirty}
        onSave={onSave}
        onDiscard={props.onDiscard}
      />
    </div>
  );
}
