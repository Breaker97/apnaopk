"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/ui/confirmation-dialog";
import type { Settings } from "@/components/admin/settings/types";
import { SettingsTabHeader } from "./settings-tab-header";
import { useTranslations } from "next-intl";

export function MarketplaceSettingsTab(props: {
  settings: Settings;
  updateField: (path: string, value: unknown) => void;
}) {
  const t = useTranslations();
  const params = useParams();
  const locale = typeof params?.locale === "string" ? params.locale : "en";
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingValue, setPendingValue] = useState<boolean>(
    props.settings.multiVendorMode.enabled,
  );

  const currentValue = props.settings.multiVendorMode.enabled;

  return (
    <div className="space-y-4">
      <SettingsTabHeader
        title={t("admin.settings.security.multiVendor.label")}
        description={t("admin.settings.security.multiVendor.description")}
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">
                {t("admin.settings.security.multiVendor.label")}
              </p>
              <p className="text-sm text-muted-foreground">
                {t("admin.settings.security.multiVendor.description")}
              </p>
            </div>
            <Switch
              checked={currentValue}
              onCheckedChange={(v) => {
                setPendingValue(v);
                setConfirmOpen(true);
              }}
            />
          </div>

          {currentValue ? (
            <Link
              href={`/${locale}/admin/vendors/configuration`}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              Manage vendor registration, plans &amp; policy
              <ArrowRight className="h-4 w-4" />
            </Link>
          ) : null}
        </CardContent>
      </Card>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={() => {
          props.updateField("multiVendorMode.enabled", pendingValue);
          setConfirmOpen(false);
        }}
        title={
          pendingValue
            ? t("admin.settings.security.multiVendor.label")
            : t("admin.settings.security.multiVendor.label")
        }
        description={
          pendingValue
            ? t("admin.settings.security.multiVendor.description")
            : t("admin.settings.security.multiVendor.description")
        }
        confirmText={pendingValue ? t("common.confirm") : t("common.confirm")}
        cancelText={t("common.cancel")}
        type={pendingValue ? "question" : "warning"}
        confirmVariant={pendingValue ? "default" : "destructive"}
      />
    </div>
  );
}
