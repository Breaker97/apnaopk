"use client";

import { useTranslations } from "next-intl";
import { CalendarClock, FileDown, MessageSquareQuote, Package } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { NumberInput } from "@/components/ui/number-input";
import { Switch } from "@/components/ui/switch";
import type { Settings } from "@/components/admin/settings/types";
import {
  FeatureGroup,
  FeatureRow,
} from "@/components/admin/settings/fields/feature-row";
import { SettingsTabHeader } from "./settings-tab-header";
import { StickySaveFooter } from "./sticky-save-footer";

/**
 * Settings → Products: what the product editor offers. The switches live in
 * two sections — the formats and "Price on request" in `catalog`, pre-orders
 * in `preorder` — and are enforced by lib/products/product-features.ts.
 *
 * Under the pre-order switch sit the two rules every pre-order follows, the
 * store's own included: asking for the balance on the release date, and
 * giving up on one left unpaid. What a vendor may promise stays under
 * Multi-Vendor Mode (preorder-rule-keys.ts).
 */
export function ProductsSettingsTab(props: {
  settings: Settings;
  isSaving: boolean;
  isDirty: boolean;
  updateField: (path: string, value: unknown) => void;
  onSave: () => void | Promise<unknown>;
  onDiscard?: () => void;
}) {
  const t = useTranslations();
  const catalog = props.settings.catalog;
  const preorder = props.settings.preorder;
  const physical = catalog?.physicalProducts !== false;
  const digital = catalog?.digitalProducts !== false;
  const preorders = preorder?.enabled !== false;
  const priceOnRequest = catalog?.priceOnRequest !== false;
  const autoRelease = preorder?.autoRelease ?? false;

  return (
    <div className="space-y-4">
      <SettingsTabHeader
        title={t("admin.settings.products.title")}
        description={t("admin.settings.products.description")}
      />

      <Card>
        <CardContent className="space-y-6">
          <FeatureGroup
            title={t("admin.settings.products.typesHeading")}
            hint={
              physical !== digital
                ? t("admin.settings.products.typesHint")
                : undefined
            }
          >
            <FeatureRow
              icon={Package}
              title={t("admin.settings.products.physical")}
              description={t("admin.settings.products.physicalDesc")}
              checked={physical}
              // The last format left on stays on: the API refuses a store
              // that could create no product at all.
              disabled={physical && !digital}
              onCheckedChange={(value) =>
                props.updateField("catalog.physicalProducts", value)
              }
            />
            <FeatureRow
              icon={FileDown}
              title={t("admin.settings.products.digital")}
              description={t("admin.settings.products.digitalDesc")}
              checked={digital}
              disabled={digital && !physical}
              onCheckedChange={(value) =>
                props.updateField("catalog.digitalProducts", value)
              }
            />
          </FeatureGroup>

          <FeatureGroup title={t("admin.settings.products.sellingHeading")}>
            <FeatureRow
              icon={CalendarClock}
              title={t("admin.settings.products.preorders")}
              description={t("admin.settings.products.preordersDesc")}
              checked={preorders}
              onCheckedChange={(value) =>
                props.updateField("preorder.enabled", value)
              }
            >
              {preorders ? (
                <div className="@container bg-muted/30 border-t px-4 sm:ps-16">
                  <label className="flex cursor-pointer items-start gap-4 py-3.5">
                    <span className="min-w-0 flex-1 space-y-0.5">
                      <span className="block text-sm font-medium">
                        {t("admin.settings.preorder.autoRelease.title")}
                      </span>
                      <span className="text-muted-foreground block text-sm">
                        {t("admin.settings.preorder.autoRelease.description")}
                      </span>
                    </span>
                    <Switch
                      className="mt-1"
                      checked={autoRelease}
                      aria-label={t("admin.settings.preorder.autoRelease.title")}
                      onCheckedChange={(value) =>
                        props.updateField("preorder.autoRelease", value)
                      }
                    />
                  </label>
                  {autoRelease ? (
                    <div className="space-y-1.5 pb-3.5">
                      <div className="flex items-center gap-2">
                        <NumberInput
                          min={0}
                          max={90}
                          step={1}
                          className="w-24"
                          aria-label={t("admin.settings.preorder.autoRelease.unit")}
                          value={preorder?.autoReleaseDelayDays ?? 0}
                          whenEmpty="keep"
                          normalize={Math.trunc}
                          onValueChange={(next) => {
                            if (next !== undefined)
                              props.updateField(
                                "preorder.autoReleaseDelayDays",
                                next,
                              );
                          }}
                        />
                        <span className="text-muted-foreground text-sm">
                          {t("admin.settings.preorder.autoRelease.unit")}
                        </span>
                      </div>
                      <p className="text-muted-foreground text-xs">
                        {t("admin.settings.preorder.autoRelease.hint")}
                      </p>
                    </div>
                  ) : null}
                  <div className="flex flex-col gap-3 border-t py-3.5 @xl:flex-row @xl:items-center @xl:gap-6">
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <label
                        htmlFor="preorder-expiry-grace"
                        className="block text-sm font-medium"
                      >
                        {t("admin.settings.preorder.expiry.label")}
                      </label>
                      <p className="text-muted-foreground text-sm">
                        {t("admin.settings.preorder.expiry.hint")}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <NumberInput
                        id="preorder-expiry-grace"
                        min={1}
                        max={365}
                        step={1}
                        className="w-24"
                        value={preorder?.expiryGraceDays ?? 14}
                        whenEmpty="keep"
                        normalize={Math.trunc}
                        onValueChange={(next) => {
                          if (next !== undefined)
                            props.updateField("preorder.expiryGraceDays", next);
                        }}
                      />
                      <span className="text-muted-foreground text-sm">
                        {t("admin.settings.preorder.expiry.unit")}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-3 border-t py-3.5 @xl:flex-row @xl:items-center @xl:gap-6">
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <label
                        htmlFor="preorder-charge-notice"
                        className="block text-sm font-medium"
                      >
                        {t("admin.settings.preorder.chargeNotice.label")}
                      </label>
                      <p className="text-muted-foreground text-sm">
                        {t("admin.settings.preorder.chargeNotice.hint")}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <NumberInput
                        id="preorder-charge-notice"
                        min={1}
                        max={168}
                        step={1}
                        className="w-24"
                        value={preorder?.balanceChargeNoticeHours ?? 24}
                        whenEmpty="keep"
                        normalize={Math.trunc}
                        onValueChange={(next) => {
                          if (next !== undefined)
                            props.updateField(
                              "preorder.balanceChargeNoticeHours",
                              next,
                            );
                        }}
                      />
                      <span className="text-muted-foreground text-sm">
                        {t("admin.settings.preorder.chargeNotice.unit")}
                      </span>
                    </div>
                  </div>
                </div>
              ) : null}
            </FeatureRow>
            <FeatureRow
              icon={MessageSquareQuote}
              title={t("admin.settings.products.priceOnRequest")}
              description={t("admin.settings.products.priceOnRequestDesc")}
              checked={priceOnRequest}
              onCheckedChange={(value) =>
                props.updateField("catalog.priceOnRequest", value)
              }
            />
          </FeatureGroup>

          <p className="text-muted-foreground text-xs">
            {t("admin.settings.products.existingNote")}
          </p>
        </CardContent>
      </Card>

      <StickySaveFooter
        label={t("admin.settings.saveChanges")}
        isSaving={props.isSaving}
        isDirty={props.isDirty}
        disabled={props.isSaving || !props.isDirty}
        onSave={props.onSave}
        onDiscard={props.onDiscard}
      />
    </div>
  );
}
