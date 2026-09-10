"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { NumberInput } from "@/components/ui/number-input";
import { Button } from "@/components/ui/button";
import type { Settings } from "@/components/admin/settings/types";
import { PlatformPaymentMethodsField } from "@/components/admin/settings/fields/platform-payment-methods-field";
import { SettingsTabHeader } from "./settings-tab-header";
import { StickySaveFooter } from "./sticky-save-footer";
import { useLocale, useTranslations } from "next-intl";

function ToggleRow(props: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{props.label}</p>
        {props.description ? (
          <p className="text-sm text-muted-foreground">{props.description}</p>
        ) : null}
      </div>
      <Switch
        checked={props.checked}
        disabled={props.disabled}
        onCheckedChange={props.onChange}
      />
    </div>
  );
}

export function VendorConfigSettingsTab(props: {
  settings: Settings;
  disabled?: boolean;
  isSaving: boolean;
  /** vendorConfig section is dirty */
  isDirty: boolean;
  /** surfaced orders.commission section is dirty */
  commissionDirty: boolean;
  updateField: (path: string, value: unknown) => void;
  updateCommissionField: (path: string, value: unknown) => void;
  /** Saves whichever of vendorConfig / orders is dirty. */
  onSave: () => void | Promise<unknown>;
}) {
  const anyDirty = props.isDirty || props.commissionDirty;
  const t = useTranslations();
  const locale = useLocale();
  const cfg = props.settings.vendorConfig;
  const commission = props.settings.orders.commission;
  const disabled = Boolean(props.disabled);
  const plansOn = Boolean(cfg.plansEnabled);

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <SettingsTabHeader
          title={t("admin.settings.vendorConfig.title")}
          description={t("admin.settings.vendorConfig.description")}
        />

        {disabled ? (
          <Card>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {t("admin.settings.vendorConfig.marketplaceOff")}
              </p>
            </CardContent>
          </Card>
        ) : null}

        {/* Registration & approval */}
        <Card>
          <CardContent className="space-y-4">
            <p className="text-sm font-semibold">
              {t("admin.settings.vendorConfig.registration.title")}
            </p>
            <ToggleRow
              label={t("admin.settings.vendorConfig.allowRegistration.label")}
              description={t(
                "admin.settings.vendorConfig.allowRegistration.description",
              )}
              checked={Boolean(cfg.allowRegistration)}
              disabled={disabled}
              onChange={(v) =>
                props.updateField("vendorConfig.allowRegistration", v)
              }
            />
            <ToggleRow
              label={t("admin.settings.vendorConfig.autoApprove.label")}
              description={t(
                "admin.settings.vendorConfig.autoApprove.description",
              )}
              checked={Boolean(cfg.autoApprove)}
              disabled={disabled}
              onChange={(v) => props.updateField("vendorConfig.autoApprove", v)}
            />
          </CardContent>
        </Card>

        {/* Plans & subscriptions */}
        <Card>
          <CardContent className="space-y-4">
            <p className="text-sm font-semibold">
              {t("admin.settings.vendorConfig.plans.title")}
            </p>
            <ToggleRow
              label={t("admin.settings.vendorConfig.plansEnabled.label")}
              description={t(
                "admin.settings.vendorConfig.plansEnabled.description",
              )}
              checked={plansOn}
              disabled={disabled}
              onChange={(v) => props.updateField("vendorConfig.plansEnabled", v)}
            />
            <ToggleRow
              label={t("admin.settings.vendorConfig.requirePlanSelection.label")}
              description={t(
                "admin.settings.vendorConfig.requirePlanSelection.description",
              )}
              checked={Boolean(cfg.requirePlanSelection)}
              disabled={disabled || !plansOn}
              onChange={(v) =>
                props.updateField("vendorConfig.requirePlanSelection", v)
              }
            />
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {t("admin.settings.vendorConfig.freeTrialDays.label")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("admin.settings.vendorConfig.freeTrialDays.description")}
                </p>
              </div>
              <NumberInput
                min={0}
                max={365}
                step={1}
                className="h-9 w-24"
                value={Number(cfg.freeTrialDays ?? 0)}
                disabled={disabled || !plansOn}
                whenEmpty={0}
                normalize={Math.floor}
                onValueChange={(next) =>
                  props.updateField("vendorConfig.freeTrialDays", next ?? 0)
                }
              />
            </div>
          </CardContent>
        </Card>

        {/* Subscription payment methods — which gateways may collect plan
            payments. Stripe keeps native recurring; every other gateway is
            one-shot pay-per-period with renewal reminders. */}
        {plansOn ? (
          <Card>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm font-semibold">
                  {t.has("admin.settings.vendorConfig.paymentMethods.title")
                    ? t("admin.settings.vendorConfig.paymentMethods.title")
                    : "Subscription payment methods"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t.has(
                    "admin.settings.vendorConfig.paymentMethods.description",
                  )
                    ? t(
                        "admin.settings.vendorConfig.paymentMethods.description",
                      )
                    : "Which gateways vendors may pay plan subscriptions through. Stripe renews automatically; other gateways bill one period at a time with renewal reminders. Credentials are configured in Payment Settings."}
                </p>
              </div>
              <PlatformPaymentMethodsField
                settings={props.settings}
                value={cfg.paymentMethods}
                onChange={(key, v) =>
                  props.updateField(`vendorConfig.paymentMethods.${key}`, v)
                }
              />
            </CardContent>
          </Card>
        ) : null}

        {/* Required documents & fields — now owned by the Onboarding Flow
            builder (single source), so this only points there. */}
        <Card>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold">
                {t("admin.settings.vendorConfig.documents.title")}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {t("admin.settings.vendorConfig.documents.movedDescription")}
              </p>
            </div>
            <Button asChild variant="outline" className="shrink-0">
              <Link href={`/${locale}/admin/vendors/onboarding`}>
                {t("admin.settings.vendorConfig.documents.manageLink")}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Default commission — surfaced from Order Settings (single source) */}
      <div className="space-y-4">
        <SettingsTabHeader
          title={t("admin.settings.vendorConfig.commission.title")}
          description={t("admin.settings.vendorConfig.commission.description")}
        />
        <Card>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {t("admin.settings.vendorConfig.commission.rateLabel")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("admin.settings.vendorConfig.commission.rateDescription")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <NumberInput
                  min={0}
                  max={100}
                  className="h-9 w-24"
                  value={Number(commission.vendorRate ?? 0)}
                  disabled={disabled}
                  whenEmpty={0}
                  onValueChange={(next) =>
                    props.updateCommissionField(
                      "orders.commission.vendorRate",
                      next ?? 0,
                    )
                  }
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {t("admin.settings.vendorConfig.commission.minWithdrawalLabel")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t(
                    "admin.settings.vendorConfig.commission.minWithdrawalDescription",
                  )}
                </p>
              </div>
              <NumberInput
                min={0}
                className="h-9 w-28"
                value={Number(commission.minWithdrawalAmount ?? 0)}
                disabled={disabled}
                whenEmpty={0}
                onValueChange={(next) =>
                  props.updateCommissionField(
                    "orders.commission.minWithdrawalAmount",
                    next ?? 0,
                  )
                }
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* One save footer persists whichever section changed. */}
      <StickySaveFooter
        label={t("common.save")}
        isSaving={props.isSaving}
        isDirty={anyDirty}
        disabled={props.isSaving || !anyDirty}
        onSave={props.onSave}
      />
    </div>
  );
}
