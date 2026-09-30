"use client";

import type { ComponentType, ReactNode } from "react";
import { useTranslations } from "next-intl";
import { CalendarClock, FileDown, MessageSquareQuote, Package } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import type { Settings } from "@/components/admin/settings/types";
import { SettingsTabHeader } from "./settings-tab-header";
import { StickySaveFooter } from "./sticky-save-footer";

/**
 * Settings → Products: what the product editor offers. The switches live in
 * two sections — the formats and "Price on request" in `catalog`, pre-orders
 * in `preorder.enabled` (the vendor rules beside it stay under Multi-Vendor
 * Management) — and are enforced by lib/products/product-features.ts.
 */
export function ProductsSettingsTab(props: {
  settings: Settings;
  isSaving: boolean;
  isDirty: boolean;
  updateField: (path: string, value: unknown) => void;
  onSave: () => void | Promise<unknown>;
}) {
  const t = useTranslations();
  const catalog = props.settings.catalog;
  const physical = catalog?.physicalProducts !== false;
  const digital = catalog?.digitalProducts !== false;
  const preorders = props.settings.preorder?.enabled !== false;
  const priceOnRequest = catalog?.priceOnRequest !== false;

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
            />
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
      />
    </div>
  );
}

function FeatureGroup({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        {title}
      </h3>
      <div className="divide-y rounded-lg border">{children}</div>
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </section>
  );
}

function FeatureRow({
  icon: Icon,
  title,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 p-4 has-[button:disabled]:cursor-default">
      <span className="bg-muted text-muted-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-md">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="block text-sm font-medium">{title}</span>
        <span className="text-muted-foreground block text-sm">{description}</span>
      </span>
      <Switch
        className="mt-1"
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        aria-label={title}
      />
    </label>
  );
}
