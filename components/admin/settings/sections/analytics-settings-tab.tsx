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
        {/* Tracking IDs print in every storefront page's HTML, so they are
            plain fields; only the Plausible API key below is a secret. */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="googleAnalyticsId">
              {t("admin.settings.analytics.googleAnalyticsId")}
            </Label>
            <Input
              id="googleAnalyticsId"
              value={settings.analytics?.googleAnalyticsId || ""}
              onChange={(e) =>
                updateNestedField("analytics.googleAnalyticsId", e.target.value)
              }
              placeholder={t("admin.settings.analytics.googleAnalyticsIdPlaceholder")}
              spellCheck={false}
            />
            <EnvSourceHint show={Boolean(envAnalytics?.googleAnalyticsId)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="googleTagManagerId">
              {t("admin.settings.analytics.googleTagManagerId")}
            </Label>
            <Input
              id="googleTagManagerId"
              value={settings.analytics?.googleTagManagerId || ""}
              onChange={(e) =>
                updateNestedField("analytics.googleTagManagerId", e.target.value)
              }
              placeholder={t("admin.settings.analytics.googleTagManagerIdPlaceholder")}
              spellCheck={false}
            />
            <EnvSourceHint show={Boolean(envAnalytics?.googleTagManagerId)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="facebookPixelId">
              {t("admin.settings.analytics.facebookPixelId")}
            </Label>
            <Input
              id="facebookPixelId"
              value={settings.analytics?.facebookPixelId || ""}
              onChange={(e) =>
                updateNestedField("analytics.facebookPixelId", e.target.value)
              }
              placeholder={t("admin.settings.analytics.facebookPixelIdPlaceholder")}
              spellCheck={false}
            />
            <EnvSourceHint show={Boolean(envAnalytics?.facebookPixelId)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tiktokPixelId">
              {t("admin.settings.analytics.tiktokPixelId")}
            </Label>
            <Input
              id="tiktokPixelId"
              value={settings.analytics?.tiktokPixelId || ""}
              onChange={(e) =>
                updateNestedField("analytics.tiktokPixelId", e.target.value)
              }
              placeholder={t("admin.settings.analytics.tiktokPixelIdPlaceholder")}
              spellCheck={false}
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
