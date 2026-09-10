"use client";

import { SecretInput } from "@/components/admin/settings/fields/secret-input";
import { credentialMeta } from "@/components/admin/settings/fields/use-credential-meta";
import { useTranslations } from "next-intl";
import { Loader2, TestTube } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { Settings } from "@/components/admin/settings/types";
import { EnvSourceHint } from "@/components/admin/settings/fields/env-source-hint";
import { SettingsTabHeader } from "./settings-tab-header";
import { StickySaveFooter } from "./sticky-save-footer";
import { EmailDeliveryLogs } from "../email-delivery-logs";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

export function EmailSettingsTab(props: {
  settings: Settings;
  isSaving: boolean;
  isDirty: boolean;
  isTestingEmail: boolean;
  testEmail: string;
  setTestEmail: (v: string) => void;
  updateNestedField: (path: string, value: unknown) => void;
  updateFieldInSection: (
    section: string,
    path: string,
    value: unknown,
  ) => void;
  onSave: () => void | Promise<unknown>;
  onTestSmtp: () => void | Promise<unknown>;
}) {
  const t = useTranslations();
  const {
    settings,
    isSaving,
    isDirty,
    isTestingEmail,
    testEmail,
    setTestEmail,
    updateNestedField,
    updateFieldInSection,
    onSave,
    onTestSmtp,
  } = props;
  const envEmail = settings._meta?.envSources?.email;

  const tSafe = useFallbackTranslator(t);

  return (
    <div className="space-y-4">
      <SettingsTabHeader
        title={t("admin.settings.email.title")}
        description={t("admin.settings.email.description")}
      />
      <Card>
        <CardContent className="space-y-4">
        <div className="space-y-3 p-4 rounded-lg border bg-muted/50">
          <div>
            <p className="font-medium">
              {tSafe(
                "admin.settings.security.emailVerification.title",
                "Email verification",
              )}
            </p>
            <p className="text-sm text-muted-foreground">
              {tSafe(
                "admin.settings.security.emailVerification.requiredDesc",
                "Require verification before allowing account actions.",
              )}
            </p>
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="emailVerificationRequired">
              {tSafe(
                "admin.settings.security.emailVerification.required",
                "Require email verification",
              )}
            </Label>
            <Switch
              id="emailVerificationRequired"
              checked={settings.security?.emailVerificationRequired ?? false}
              onCheckedChange={(v) =>
                updateFieldInSection(
                  "emailVerification",
                  "security.emailVerificationRequired",
                  v,
                )
              }
            />
          </div>

          {Boolean(settings.multiVendorMode?.enabled) && (
            <div className="flex items-center justify-between">
              <Label htmlFor="emailVerificationForVendors">
                {tSafe(
                  "admin.settings.security.emailVerification.vendorRequired",
                  "Require for vendors",
                )}
              </Label>
              <Switch
                id="emailVerificationForVendors"
                checked={
                  settings.security?.emailVerificationForVendors ?? false
                }
                onCheckedChange={(v) =>
                  updateFieldInSection(
                    "emailVerification",
                    "security.emailVerificationForVendors",
                    v,
                  )
                }
              />
            </div>
          )}

        </div>

        <Separator />
        <div className="flex items-center justify-between">
          <Label htmlFor="smtpEnabled">
            {t("admin.settings.email.enable")}
          </Label>
          <Switch
            id="smtpEnabled"
            checked={settings.email.enabled}
            onCheckedChange={(v) => updateNestedField("email.enabled", v)}
          />
        </div>
        <EnvSourceHint
          show={
            !settings.email.enabled &&
            Boolean(envEmail?.user || envEmail?.password || envEmail?.host)
          }
        />
        {settings.email.enabled && (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="smtpHost">
                  {t("admin.settings.email.host")}
                </Label>
                <Input
                  id="smtpHost"
                  value={settings.email.smtp.host || ""}
                  onChange={(e) =>
                    updateNestedField("email.smtp.host", e.target.value)
                  }
                  placeholder="smtp.gmail.com"
                />
                <EnvSourceHint show={Boolean(envEmail?.host)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="smtpPort">
                  {t("admin.settings.email.port")}
                </Label>
                <NumberInput
                  id="smtpPort"
                  min={1}
                  max={65535}
                  step={1}
                  value={settings.email.smtp.port || 587}
                  whenEmpty="keep"
                  normalize={Math.trunc}
                  onValueChange={(next) => {
                    if (next !== undefined) updateNestedField("email.smtp.port", next);
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="smtpUser">
                  {t("admin.settings.email.username")}
                </Label>
                <Input
                  id="smtpUser"
                  value={settings.email.smtp.user || ""}
                  onChange={(e) =>
                    updateNestedField("email.smtp.user", e.target.value)
                  }
                  placeholder="your-email@gmail.com"
                />
                <EnvSourceHint show={Boolean(envEmail?.user)} />
              </div>
              <div className="space-y-2">
                <SecretInput
                  id="smtpPassword"
                  label={t("admin.settings.email.password")}
                  value={settings.email.smtp.password || ""}
                  onChange={(v) => updateNestedField("email.smtp.password", v)}
                  onClear={() => updateNestedField("email.smtp.password", null)}
                  secretSet={credentialMeta(settings, "email.smtp.password").set}
                  maskedHint={
                    credentialMeta(settings, "email.smtp.password").hint
                  }
                  placeholderWhenSet="Saved (leave blank to keep)"
                  placeholderWhenUnset="Enter password"
                  helperText="Saved passwords are not shown again for security."
                />
                <EnvSourceHint show={Boolean(envEmail?.password)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="smtpFromEmail">
                  {t("admin.settings.email.fromEmail")}
                </Label>
                <Input
                  id="smtpFromEmail"
                  value={settings.email.fromEmail || ""}
                  onChange={(e) =>
                    updateNestedField("email.fromEmail", e.target.value)
                  }
                  placeholder="noreply@yourstore.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="smtpFromName">
                  {t("admin.settings.email.fromName")}
                </Label>
                <Input
                  id="smtpFromName"
                  value={settings.email.fromName || ""}
                  onChange={(e) =>
                    updateNestedField("email.fromName", e.target.value)
                  }
                  placeholder="Your Store Name"
                />
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Encryption is automatic: port 465 uses implicit TLS and port 587
              requires STARTTLS.
            </p>
            <Separator />
            <div className="flex items-end gap-4">
              <div className="flex-1 space-y-2">
                <Label htmlFor="testEmail">
                  {t("admin.settings.email.test.label")}
                </Label>
                <Input
                  id="testEmail"
                  type="email"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  placeholder={t("admin.settings.email.test.placeholder")}
                />
              </div>
              <Button
                variant="outline"
                onClick={() => onTestSmtp()}
                disabled={isTestingEmail}
              >
                {isTestingEmail ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <TestTube className="h-4 w-4 mr-2" />
                )}
                {t("admin.settings.email.test.button")}
              </Button>
            </div>
          </>
        )}
          <StickySaveFooter
            label={t("admin.settings.email.save")}
            isSaving={isSaving}
            isDirty={isDirty}
            onSave={onSave}
          />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <EmailDeliveryLogs
            retentionDays={settings.email.logRetentionDays ?? 30}
            onRetentionDaysChange={(days) =>
              updateNestedField("email.logRetentionDays", days)
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
