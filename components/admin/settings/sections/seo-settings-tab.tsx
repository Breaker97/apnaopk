"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import type { Settings } from "@/components/admin/settings/types";
import { SettingsTabHeader } from "./settings-tab-header";
import { StickySaveFooter } from "./sticky-save-footer";

export function SeoSettingsTab(props: {
  settings: Settings;
  isSaving: boolean;
  isDirty: boolean;
  updateNestedField: (path: string, value: unknown) => void;
  onSave: () => void | Promise<unknown>;
}) {
  const t = useTranslations();
  const { settings, isSaving, isDirty, updateNestedField, onSave } = props;

  return (
    <div className="space-y-4">
      <SettingsTabHeader
        title={t("admin.settings.seo.title")}
        description={t("admin.settings.seo.description")}
      />
      <Card>
        <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="metaTitle">
            {t("admin.settings.seo.metaTitle")}
          </Label>
          <Input
            id="metaTitle"
            value={settings.seo?.metaTitle || ""}
            onChange={(e) =>
              updateNestedField("seo.metaTitle", e.target.value)
            }
            placeholder={t("admin.settings.seo.metaTitlePlaceholder")}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="metaDescription">
            {t("admin.settings.seo.metaDescription")}
          </Label>
          <Textarea
            id="metaDescription"
            value={settings.seo?.metaDescription || ""}
            onChange={(e) =>
              updateNestedField("seo.metaDescription", e.target.value)
            }
            placeholder={t("admin.settings.seo.metaDescriptionPlaceholder")}
            rows={3}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="metaKeywords">
            {t("admin.settings.seo.metaKeywords")}
          </Label>
          <Input
            id="metaKeywords"
            value={settings.seo?.metaKeywords || ""}
            onChange={(e) =>
              updateNestedField("seo.metaKeywords", e.target.value)
            }
            placeholder={t("admin.settings.seo.metaKeywordsPlaceholder")}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ogImage">{t("admin.settings.seo.ogImage")}</Label>
          <Input
            id="ogImage"
            value={settings.seo?.ogImage || ""}
            onChange={(e) =>
              updateNestedField("seo.ogImage", e.target.value)
            }
            placeholder={t("admin.settings.seo.ogImagePlaceholder")}
          />
        </div>
          <StickySaveFooter
            label={t("admin.settings.seo.save")}
            isSaving={isSaving}
            isDirty={isDirty}
            onSave={onSave}
          />
        </CardContent>
      </Card>
    </div>
  );
}
