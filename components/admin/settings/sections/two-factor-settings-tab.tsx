"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import type { Settings } from "@/components/admin/settings/types";
import { SettingsTabHeader } from "./settings-tab-header";
import { StickySaveFooter } from "./sticky-save-footer";
import { useTranslations } from "next-intl";

export function TwoFactorSettingsTab(props: {
  settings: Settings;
  isSaving: boolean;
  isDirty: boolean;
  updateField: (path: string, value: unknown) => void;
  onSave: () => void | Promise<unknown>;
}) {
  const t = useTranslations();
  const security = props.settings.security;
  const masterEnabled = Boolean(security.twoFactorEnabled);

  return (
    <div className="space-y-4">
      <SettingsTabHeader
        title={t("admin.settings.twoFactor.title")}
        description={t("admin.settings.twoFactor.description")}
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="grid gap-3">
            <div className="flex items-center justify-between">
              <span className="text-sm">
                {t("admin.settings.twoFactor.enable")}
              </span>
              <Switch
                checked={masterEnabled}
                onCheckedChange={(v) =>
                  props.updateField("security.twoFactorEnabled", v)
                }
              />
            </div>
            <div className="flex items-center justify-between">
              <span
                className={
                  masterEnabled ? "text-sm" : "text-sm text-muted-foreground"
                }
              >
                {t("admin.settings.twoFactor.admin")}
              </span>
              <Switch
                checked={masterEnabled && Boolean(security.twoFactorRequiredForAdmin)}
                disabled={!masterEnabled}
                onCheckedChange={(v) =>
                  props.updateField("security.twoFactorRequiredForAdmin", v)
                }
              />
            </div>
            <div className="flex items-center justify-between">
              <span
                className={
                  masterEnabled ? "text-sm" : "text-sm text-muted-foreground"
                }
              >
                {t("admin.settings.twoFactor.vendor")}
              </span>
              <Switch
                checked={masterEnabled && Boolean(security.twoFactorRequiredForVendors)}
                disabled={!masterEnabled}
                onCheckedChange={(v) =>
                  props.updateField("security.twoFactorRequiredForVendors", v)
                }
              />
            </div>
            <div className="flex items-center justify-between">
              <span
                className={
                  masterEnabled ? "text-sm" : "text-sm text-muted-foreground"
                }
              >
                {t("admin.settings.twoFactor.staff")}
              </span>
              <Switch
                checked={masterEnabled && Boolean(security.twoFactorRequiredForStaff)}
                disabled={!masterEnabled}
                onCheckedChange={(v) =>
                  props.updateField("security.twoFactorRequiredForStaff", v)
                }
              />
            </div>
            {!masterEnabled && (
              <p className="text-xs text-muted-foreground">
                {t("admin.settings.twoFactor.enableFirstHint")}
              </p>
            )}
          </div>
          <StickySaveFooter
            label={t("admin.settings.twoFactor.save")}
            isSaving={props.isSaving}
            isDirty={props.isDirty}
            onSave={props.onSave}
          />
        </CardContent>
      </Card>
    </div>
  );
}
