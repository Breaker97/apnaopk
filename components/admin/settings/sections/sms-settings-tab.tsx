"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Info, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { CountrySelect } from "@/components/common/country-multi-select";
import { SecretInput } from "@/components/admin/settings/fields/secret-input";
import { EnvSourceHint } from "@/components/admin/settings/fields/env-source-hint";
import { useCredentialMeta } from "@/components/admin/settings/fields/use-credential-meta";
import type { Settings } from "@/components/admin/settings/types";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { DeliveryLogs } from "../delivery-logs";
import { SettingsTabHeader } from "./settings-tab-header";
import { StickySaveFooter } from "./sticky-save-footer";

export function SmsSettingsTab(props: {
  settings: Settings;
  isSaving: boolean;
  isDirty: boolean;
  isTestingSms: boolean;
  testSmsTo: string;
  setTestSmsTo: (value: string) => void;
  updateNestedField: (path: string, value: unknown) => void;
  onSave: () => void | Promise<unknown>;
  onTestSms: () => void | Promise<unknown>;
}) {
  const t = useTranslations();
  const tSafe = useFallbackTranslator(t);
  const locale = useLocale();
  const {
    settings,
    isSaving,
    isDirty,
    isTestingSms,
    testSmsTo,
    setTestSmsTo,
    updateNestedField,
    onSave,
    onTestSms,
  } = props;
  const sms = settings.sms ?? { enabled: false };
  const twilio = sms.twilio ?? {};
  const env = settings._meta?.envSources?.sms;
  const credential = useCredentialMeta(settings);

  return (
    <div className="space-y-4">
      <SettingsTabHeader
        title={tSafe("admin.settings.sms.title", "SMS (Twilio)")}
        description={tSafe(
          "admin.settings.sms.description",
          "Send order, return and payment updates as text messages through your Twilio account.",
        )}
      />
      <Card>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="smsEnabled">
                {tSafe("admin.settings.sms.enable", "Enable SMS notifications")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {tSafe(
                  "admin.settings.sms.enableHint",
                  "Twilio bills every message. Nothing is texted until you also pick events in Notification settings.",
                )}
              </p>
            </div>
            <Switch
              id="smsEnabled"
              checked={sms.enabled}
              onCheckedChange={(value) => updateNestedField("sms.enabled", value)}
            />
          </div>
          <EnvSourceHint
            show={
              !sms.enabled &&
              Boolean(env?.accountSid || env?.authToken || env?.fromNumber)
            }
          />

          {sms.enabled && (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <SecretInput
                    id="twilioAccountSid"
                    label={tSafe("admin.settings.sms.accountSid", "Account SID")}
                    value={twilio.accountSid || ""}
                    onChange={(value) =>
                      updateNestedField("sms.twilio.accountSid", value)
                    }
                    onClear={() =>
                      updateNestedField("sms.twilio.accountSid", null)
                    }
                    secretSet={credential("sms.twilio.accountSid").set}
                    maskedHint={credential("sms.twilio.accountSid").hint}
                    placeholderWhenSet="Saved (leave blank to keep)"
                    placeholderWhenUnset="AC…"
                    revealTyped
                  />
                  <EnvSourceHint show={Boolean(env?.accountSid)} />
                </div>
                <div className="space-y-2">
                  <SecretInput
                    id="twilioAuthToken"
                    label={tSafe("admin.settings.sms.authToken", "Auth Token")}
                    value={twilio.authToken || ""}
                    onChange={(value) =>
                      updateNestedField("sms.twilio.authToken", value)
                    }
                    onClear={() => updateNestedField("sms.twilio.authToken", null)}
                    secretSet={credential("sms.twilio.authToken").set}
                    maskedHint={credential("sms.twilio.authToken").hint}
                    placeholderWhenSet="Saved (leave blank to keep)"
                    placeholderWhenUnset="Enter Auth Token"
                    helperText="Also verifies Twilio's delivery receipts. Saved tokens are not shown again."
                  />
                  <EnvSourceHint show={Boolean(env?.authToken)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="twilioMessagingServiceSid">
                    {tSafe(
                      "admin.settings.sms.messagingServiceSid",
                      "Messaging Service SID",
                    )}
                  </Label>
                  <Input
                    id="twilioMessagingServiceSid"
                    value={twilio.messagingServiceSid || ""}
                    onChange={(event) =>
                      updateNestedField(
                        "sms.twilio.messagingServiceSid",
                        event.target.value,
                      )
                    }
                    placeholder="MG…"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <p className="text-xs text-muted-foreground">
                    Recommended. Twilio picks the right sender for each
                    destination and handles STOP replies.
                  </p>
                  <EnvSourceHint show={Boolean(env?.messagingServiceSid)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="twilioFromNumber">
                    {tSafe("admin.settings.sms.fromNumber", "From number or sender ID")}
                  </Label>
                  <Input
                    id="twilioFromNumber"
                    value={twilio.fromNumber || ""}
                    onChange={(event) =>
                      updateNestedField("sms.twilio.fromNumber", event.target.value)
                    }
                    placeholder="+15551234567"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <p className="text-xs text-muted-foreground">
                    Used when no Messaging Service is set: a Twilio number, or
                    an alphanumeric sender ID where your destinations allow one.
                  </p>
                  <EnvSourceHint show={Boolean(env?.fromNumber)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="smsDefaultCountry">
                    {tSafe(
                      "admin.settings.sms.defaultCountry",
                      "Default country for phone numbers",
                    )}
                  </Label>
                  <CountrySelect
                    id="smsDefaultCountry"
                    value={sms.defaultCountry || ""}
                    onChange={(country) =>
                      updateNestedField("sms.defaultCountry", country)
                    }
                    valueFormat="code"
                    restrictToAvailableCountries={false}
                    clearable
                    placeholder="Use the shipping origin country"
                  />
                  <p className="text-xs text-muted-foreground">
                    Reads profile numbers saved without a country code. An
                    order&apos;s phone is always read against its shipping country.
                  </p>
                </div>
                <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
                  <div>
                    <Label htmlFor="smsIncludeLinks">
                      {tSafe("admin.settings.sms.includeLinks", "Include a link")}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Adds the order or tracking page. A link often pushes a
                      message into a second segment, billed as a second text.
                    </p>
                  </div>
                  <Switch
                    id="smsIncludeLinks"
                    checked={sms.includeLinks !== false}
                    onCheckedChange={(value) =>
                      updateNestedField("sms.includeLinks", value)
                    }
                  />
                </div>
              </div>

              <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  Customers are texted at the phone on their order and can opt
                  out under Account → Preferences or by replying STOP. Admins,
                  staff and vendors are texted at the phone on their profile or
                  store. Choose the events in{" "}
                  <Link
                    href={`/${locale}/admin/settings/notifications`}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Notification settings
                  </Link>
                  . Only text people who agreed to hear from you.
                </p>
              </div>

              <Separator />
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1 space-y-2">
                  <Label htmlFor="testSmsTo">
                    {tSafe("admin.settings.sms.testLabel", "Send a test message to")}
                  </Label>
                  <Input
                    id="testSmsTo"
                    type="tel"
                    value={testSmsTo}
                    onChange={(event) => setTestSmsTo(event.target.value)}
                    placeholder="+8801712345678"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onTestSms()}
                  disabled={isTestingSms || !testSmsTo.trim()}
                >
                  {isTestingSms ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="mr-2 h-4 w-4" />
                  )}
                  {tSafe("admin.settings.sms.testButton", "Send test SMS")}
                </Button>
              </div>
            </>
          )}

          <StickySaveFooter
            label={tSafe("admin.settings.sms.save", "Save SMS settings")}
            isSaving={isSaving}
            isDirty={isDirty}
            onSave={onSave}
          />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <DeliveryLogs
            kind="sms"
            retentionDays={sms.logRetentionDays ?? 30}
            onRetentionDaysChange={(days) =>
              updateNestedField("sms.logRetentionDays", days)
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
