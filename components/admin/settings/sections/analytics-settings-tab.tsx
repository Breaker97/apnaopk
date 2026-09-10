"use client";

import { SecretInput } from "@/components/admin/settings/fields/secret-input";
import { credentialMeta } from "@/components/admin/settings/fields/use-credential-meta";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import type { Settings } from "@/components/admin/settings/types";
import { EnvSourceHint } from "@/components/admin/settings/fields/env-source-hint";
import { SettingsTabHeader } from "./settings-tab-header";
import { StickySaveFooter } from "./sticky-save-footer";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

export function AnalyticsSettingsTab(props: {
  settings: Settings;
  isSaving: boolean;
  isDirty: boolean;
  updateNestedField: (path: string, value: unknown) => void;
  onSave: () => void | Promise<unknown>;
}) {
  const t = useTranslations();
  const { settings, isSaving, isDirty, updateNestedField, onSave } = props;
  const envAnalytics = settings._meta?.envSources?.analytics;

  const tSafe = useFallbackTranslator(t);

  return (
    <div className="space-y-4">
      <SettingsTabHeader
        title={tSafe("admin.settings.analytics.title", "Analytics")}
        description={tSafe(
          "admin.settings.analytics.description",
          "Configure tracking and analytics codes",
        )}
      />
      <Card>
        <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <SecretInput
              id="googleAnalyticsId"
              label={t("admin.settings.analytics.googleAnalyticsId")}
              value={settings.analytics?.googleAnalyticsId || ""}
              onChange={(v) => updateNestedField("analytics.googleAnalyticsId", v)}
              onClear={() => updateNestedField("analytics.googleAnalyticsId", null)}
              secretSet={credentialMeta(settings, "analytics.googleAnalyticsId").set}
              maskedHint={credentialMeta(settings, "analytics.googleAnalyticsId").hint}
              placeholderWhenSet="Saved (leave blank to keep)"
              placeholderWhenUnset={t("admin.settings.analytics.googleAnalyticsIdPlaceholder")}
              revealTyped
            />
            <EnvSourceHint show={Boolean(envAnalytics?.googleAnalyticsId)} />
          </div>
          <div className="space-y-2">
            <SecretInput
              id="googleTagManagerId"
              label={t("admin.settings.analytics.googleTagManagerId")}
              value={settings.analytics?.googleTagManagerId || ""}
              onChange={(v) => updateNestedField("analytics.googleTagManagerId", v)}
              onClear={() => updateNestedField("analytics.googleTagManagerId", null)}
              secretSet={credentialMeta(settings, "analytics.googleTagManagerId").set}
              maskedHint={credentialMeta(settings, "analytics.googleTagManagerId").hint}
              placeholderWhenSet="Saved (leave blank to keep)"
              placeholderWhenUnset={t("admin.settings.analytics.googleTagManagerIdPlaceholder")}
              revealTyped
            />
            <EnvSourceHint show={Boolean(envAnalytics?.googleTagManagerId)} />
          </div>
          <div className="space-y-2">
            <SecretInput
              id="facebookPixelId"
              label={t("admin.settings.analytics.facebookPixelId")}
              value={settings.analytics?.facebookPixelId || ""}
              onChange={(v) => updateNestedField("analytics.facebookPixelId", v)}
              onClear={() => updateNestedField("analytics.facebookPixelId", null)}
              secretSet={credentialMeta(settings, "analytics.facebookPixelId").set}
              maskedHint={credentialMeta(settings, "analytics.facebookPixelId").hint}
              placeholderWhenSet="Saved (leave blank to keep)"
              placeholderWhenUnset={t("admin.settings.analytics.facebookPixelIdPlaceholder")}
              revealTyped
            />
            <EnvSourceHint show={Boolean(envAnalytics?.facebookPixelId)} />
          </div>
          <div className="space-y-2">
            <SecretInput
              id="tiktokPixelId"
              label={t("admin.settings.analytics.tiktokPixelId")}
              value={settings.analytics?.tiktokPixelId || ""}
              onChange={(v) => updateNestedField("analytics.tiktokPixelId", v)}
              onClear={() => updateNestedField("analytics.tiktokPixelId", null)}
              secretSet={credentialMeta(settings, "analytics.tiktokPixelId").set}
              maskedHint={credentialMeta(settings, "analytics.tiktokPixelId").hint}
              placeholderWhenSet="Saved (leave blank to keep)"
              placeholderWhenUnset={t("admin.settings.analytics.tiktokPixelIdPlaceholder")}
              revealTyped
            />
            <EnvSourceHint show={Boolean(envAnalytics?.tiktokPixelId)} />
          </div>
        </div>

        <div className="border-t pt-4 mt-2">
          <h3 className="text-sm font-semibold mb-3">
            {tSafe(
              "admin.settings.analytics.plausibleTitle",
              "Plausible Analytics",
            )}
          </h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="plausibleDomain">
                {tSafe(
                  "admin.settings.analytics.plausibleDomain",
                  "Site Domain",
                )}
              </Label>
              <Input
                id="plausibleDomain"
                value={settings.analytics?.plausibleDomain || ""}
                onChange={(e) =>
                  updateNestedField(
                    "analytics.plausibleDomain",
                    e.target.value,
                  )
                }
                placeholder={tSafe(
                  "admin.settings.analytics.plausibleDomainPlaceholder",
                  "yourdomain.com",
                )}
              />
              <p className="text-xs text-muted-foreground">
                {tSafe(
                  "admin.settings.analytics.plausibleDomainHelp",
                  "Enter just the domain, e.g. yourdomain.com (no https://)",
                )}
              </p>
            </div>
            <div className="space-y-2">
              <SecretInput
                id="plausibleApiKey"
                label={tSafe(
                  "admin.settings.analytics.plausibleApiKey",
                  "API Key",
                )}
                value={settings.analytics?.plausibleApiKey || ""}
                onChange={(v) =>
                  updateNestedField("analytics.plausibleApiKey", v)
                }
                onClear={() => updateNestedField("analytics.plausibleApiKey", null)}
                secretSet={credentialMeta(settings, "analytics.plausibleApiKey").set}
                maskedHint={
                  credentialMeta(settings, "analytics.plausibleApiKey").hint
                }
                placeholderWhenSet="Saved (leave blank to keep)"
                placeholderWhenUnset={tSafe(
                  "admin.settings.analytics.plausibleApiKeyPlaceholder",
                  "Enter your Plausible API key",
                )}
              />
              <p className="text-xs text-muted-foreground">
                {tSafe(
                  "admin.settings.analytics.plausibleApiKeyHelp",
                  "Found in Plausible → Settings → API Keys",
                )}
              </p>
              <EnvSourceHint show={Boolean(envAnalytics?.plausibleApiKey)} />
            </div>
            <div className="space-y-2 flex items-center gap-3 pt-4">
              <input
                type="checkbox"
                id="plausibleSelfHosted"
                checked={settings.analytics?.plausibleSelfHosted || false}
                onChange={(e) =>
                  updateNestedField(
                    "analytics.plausibleSelfHosted",
                    e.target.checked,
                  )
                }
                className="h-4 w-4 rounded border-input"
              />
              <Label htmlFor="plausibleSelfHosted" className="cursor-pointer">
                {tSafe(
                  "admin.settings.analytics.plausibleSelfHosted",
                  "Self-hosted instance",
                )}
              </Label>
            </div>
            {settings.analytics?.plausibleSelfHosted && (
              <div className="space-y-2">
                <Label htmlFor="plausibleBaseUrl">
                  {tSafe(
                    "admin.settings.analytics.plausibleBaseUrl",
                    "Custom Instance URL",
                  )}
                </Label>
                <Input
                  id="plausibleBaseUrl"
                  value={settings.analytics?.plausibleBaseUrl || ""}
                  onChange={(e) =>
                    updateNestedField(
                      "analytics.plausibleBaseUrl",
                      e.target.value,
                    )
                  }
                  placeholder={tSafe(
                    "admin.settings.analytics.plausibleBaseUrlPlaceholder",
                    "https://plausible.yourdomain.com",
                  )}
                />
              </div>
            )}
          </div>
        </div>

          <StickySaveFooter
            label={t("admin.settings.analytics.save")}
            isSaving={isSaving}
            isDirty={isDirty}
            onSave={onSave}
          />
        </CardContent>
      </Card>
    </div>
  );
}
