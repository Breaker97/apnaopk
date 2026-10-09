"use client";

import { useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  Bell,
  CircleAlert,
  CircleCheck,
  Info,
  Loader2,
  Lock,
  Send,
  type LucideIcon,
} from "lucide-react";
import Link from "@/components/language/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { WarningBanner } from "@/components/ui/warning-banner";
import { CountrySelect } from "@/components/common/country-multi-select";
import { SecretInput } from "@/components/admin/settings/fields/secret-input";
import { EnvSourceHint } from "@/components/admin/settings/fields/env-source-hint";
import { Segmented } from "@/components/admin/settings/fields/segmented";
import {
  SettingList,
  SettingRow,
  SettingSwitchItem,
} from "@/components/admin/settings/fields/setting-row";
import { useCredentialMeta } from "@/components/admin/settings/fields/use-credential-meta";
import { isSmsConfigured } from "@/components/admin/settings/settings-sections";
import type { Settings } from "@/components/admin/settings/types";
import type { SmsTestResult } from "@/components/admin/settings/use-admin-settings";
import {
  countryCodeForValue,
  countryNameForCode,
} from "@/lib/intl/country-availability";
import { countSmsNotifications } from "@/lib/notifications/notification-settings";
import {
  isAlphanumericSender,
  isMessagingServiceSid,
  isTwilioAccountSid,
  isValidSmsSender,
} from "@/lib/sms/sms-format";
import { cn } from "@/lib/utils";
import { useAppSettings } from "@/providers/app-settings-provider";
import { DeliveryLogs, type LogRetentionDays } from "../delivery-logs";
import { SettingsTabHeader } from "./settings-tab-header";
import { SmsMessagePreview } from "./sms-message-preview";
import { StickySaveFooter } from "./sticky-save-footer";

const linkClass = "text-primary font-medium hover:underline";
const cautionClass = "text-amber-700 dark:text-amber-400";

type Twilio = NonNullable<Settings["sms"]["twilio"]>;
type SmsEnv = { accountSid?: boolean; authToken?: boolean; messagingServiceSid?: boolean; fromNumber?: boolean };
type SenderMode = "service" | "number";

/**
 * Settings → SMS (Twilio): the switch, the Twilio account texts go out
 * through, how a text reads, and the log of what went out.
 *
 * With SMS off and nothing ever sent, the page is its header. The sender is
 * one choice and one field: a Messaging Service SID and a From number used to
 * sit side by side as if both were needed, while a saved service quietly won
 * over any number. A test answers on the page, with Twilio's reason when it
 * refuses. The header says how many events actually text, and says so loudly
 * when none do — nothing went out either way before, and the page was silent.
 */
export function SmsSettingsTab(props: {
  settings: Settings;
  /** The copy last saved: what Twilio is set up with right now. */
  savedSettings: Settings;
  isSaving: boolean;
  isDirty: boolean;
  isTestingSms: boolean;
  testSmsTo: string;
  setTestSmsTo: (value: string) => void;
  updateNestedField: (path: string, value: unknown) => void;
  onSave: () => void | Promise<unknown>;
  onDiscard?: () => void;
  onTestSms: () => Promise<SmsTestResult | undefined>;
  /** Saves the log's retention at once, apart from the page's form. */
  onSaveRetention: (days: LogRetentionDays) => void | Promise<unknown>;
}) {
  const t = useTranslations("admin.settings.sms");
  const tSettings = useTranslations("admin.settings");
  const { settings, savedSettings, updateNestedField } = props;
  const sms = settings.sms ?? { enabled: false };
  const twilio: Twilio = sms.twilio ?? {};
  const env: SmsEnv | undefined = settings._meta?.envSources?.sms;
  const credential = useCredentialMeta(settings);
  const enabled = Boolean(sms.enabled);
  // What the test and the notifications go through: the saved copy.
  const ready = isSmsConfigured(savedSettings);
  const events = countSmsNotifications(savedSettings.notifications);
  const envReady = Boolean(
    env?.accountSid && env?.authToken && (env?.messagingServiceSid || env?.fromNumber),
  );
  const [logRefresh, setLogRefresh] = useState(0);

  const sidMeta = credential("sms.twilio.accountSid");
  const tokenMeta = credential("sms.twilio.authToken");
  const [sidTouched, setSidTouched] = useState(false);
  const sid = twilio.accountSid || "";
  const sidInvalid = sidTouched && sid.trim() !== "" && !isTwilioAccountSid(sid);

  const originCode = countryCodeForValue(settings.shipping?.origin?.country);
  const originName = originCode ? (countryNameForCode(originCode) ?? originCode) : undefined;

  const notificationsLink = (chunks: ReactNode) => (
    <Link href="/admin/settings/notifications" className={linkClass}>
      {chunks}
    </Link>
  );

  const headerNote = enabled ? (
    !ready ? (
      <HeaderNote icon={Bell}>
        {t.rich("eventsAfterSave", { link: notificationsLink })}
      </HeaderNote>
    ) : events > 0 ? (
      <HeaderNote icon={Bell}>
        {t.rich("eventsCount", { count: events, link: notificationsLink })}
      </HeaderNote>
    ) : (
      <WarningBanner>{t.rich("eventsNone", { link: notificationsLink })}</WarningBanner>
    )
  ) : envReady ? (
    <HeaderNote icon={Lock}>{t("offEnvReady")}</HeaderNote>
  ) : null;

  return (
    <div className="space-y-4">
      <SettingsTabHeader
        title={t("title")}
        description={enabled ? t("description") : t("descriptionOff")}
        control={
          <Switch
            className="mt-1"
            checked={enabled}
            aria-label={t("title")}
            onCheckedChange={(on) => updateNestedField("sms.enabled", on)}
          />
        }
      >
        {headerNote}
      </SettingsTabHeader>

      {enabled ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t("accountTitle")}</CardTitle>
              <CardDescription>
                {t.rich("accountDescription", {
                  link: (chunks) => (
                    <a
                      href="https://console.twilio.com"
                      target="_blank"
                      rel="noreferrer"
                      className={linkClass}
                    >
                      {chunks}
                    </a>
                  ),
                })}
              </CardDescription>
              {sidMeta.set || tokenMeta.set ? (
                <CardAction>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      // null removes a stored secret on save; Discard brings it back.
                      updateNestedField("sms.twilio.accountSid", null);
                      updateNestedField("sms.twilio.authToken", null);
                    }}
                  >
                    {t("disconnect")}
                  </Button>
                </CardAction>
              ) : null}
            </CardHeader>
            <CardContent>
              <SettingList>
                <SettingRow inputId="twilioAccountSid" label={t("accountSid")} align="start">
                  <div className="w-full space-y-1.5">
                    <SecretInput
                      id="twilioAccountSid"
                      value={sid}
                      onChange={(value) => updateNestedField("sms.twilio.accountSid", value)}
                      onBlur={() => setSidTouched(true)}
                      invalid={sidInvalid}
                      secretSet={sidMeta.set}
                      maskedHint={sidMeta.hint}
                      placeholderWhenUnset="AC…"
                      revealTyped
                    />
                    {sidInvalid ? (
                      <p className="text-destructive text-xs">{t("accountSidInvalid")}</p>
                    ) : null}
                    <EnvSourceHint show={Boolean(env?.accountSid)} />
                  </div>
                </SettingRow>

                <SettingRow
                  inputId="twilioAuthToken"
                  label={t("authToken")}
                  hint={t("authTokenHint")}
                  align="start"
                >
                  <div className="w-full space-y-1.5">
                    <SecretInput
                      id="twilioAuthToken"
                      value={twilio.authToken || ""}
                      onChange={(value) => updateNestedField("sms.twilio.authToken", value)}
                      secretSet={tokenMeta.set}
                      maskedHint={tokenMeta.hint}
                      placeholderWhenUnset={t("authTokenPlaceholder")}
                    />
                    <EnvSourceHint show={Boolean(env?.authToken)} />
                  </div>
                </SettingRow>

                <SenderRow
                  twilio={twilio}
                  env={env}
                  isDirty={props.isDirty}
                  updateNestedField={updateNestedField}
                />

                <TestRow
                  blocked={props.isDirty ? "dirty" : !ready ? "setup" : null}
                  isTesting={props.isTestingSms}
                  to={props.testSmsTo}
                  setTo={props.setTestSmsTo}
                  onTest={async () => {
                    const result = await props.onTestSms();
                    // The test went through the outbox, so the log has a new row.
                    setLogRefresh((count) => count + 1);
                    return result;
                  }}
                />
              </SettingList>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("messagesTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <SettingList>
                <SettingRow
                  inputId="smsDefaultCountry"
                  label={t("defaultCountry")}
                  hint={t("defaultCountryHint")}
                  align="start"
                >
                  <CountrySelect
                    id="smsDefaultCountry"
                    value={sms.defaultCountry || ""}
                    onChange={(country) => updateNestedField("sms.defaultCountry", country)}
                    valueFormat="code"
                    restrictToAvailableCountries={false}
                    clearable
                    triggerClassName="w-full"
                    placeholder={
                      originName
                        ? t("defaultCountryOrigin", { country: originName })
                        : t("defaultCountryNone")
                    }
                  />
                </SettingRow>
                <div>
                  <SettingSwitchItem
                    title={t("includeLinks")}
                    description={t("includeLinksHint")}
                    checked={sms.includeLinks !== false}
                    onCheckedChange={(on) => updateNestedField("sms.includeLinks", on)}
                  />
                  <SmsMessagePreview
                    storeName={settings.general?.storeName}
                    orderPrefix={settings.orders?.prefix}
                    includeLink={sms.includeLinks !== false}
                  />
                </div>
              </SettingList>
            </CardContent>
          </Card>
        </>
      ) : null}

      <StickySaveFooter
        label={tSettings("general.save")}
        isSaving={props.isSaving}
        isDirty={props.isDirty}
        onSave={props.onSave}
        onDiscard={props.onDiscard}
      />

      {/* With SMS off, a log with nothing in it is left out with the rest. */}
      <DeliveryLogs
        kind="sms"
        retentionDays={sms.logRetentionDays ?? 30}
        onRetentionDaysChange={props.onSaveRetention}
        hideWhenEmpty={!enabled}
        refreshKey={logRefresh}
      />
    </div>
  );
}

function HeaderNote(props: { icon: LucideIcon; children: ReactNode }) {
  const Icon = props.icon;
  return (
    <p className="text-muted-foreground flex items-start gap-2 text-sm">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{props.children}</span>
    </p>
  );
}

/**
 * Who a text comes from: a Messaging Service (Twilio picks a number for each
 * country), or one number or name. A saved service is used whenever one is
 * set (`sendTwilioMessage`), so choosing a number takes the service out of
 * the form, and choosing the service again before saving puts it back.
 */
/** The store's name as an alphanumeric sender ID: letters and digits, at most 11. */
function senderIdExample(storeName: string) {
  return storeName.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 11) || "MYSTORE";
}

function SenderRow(props: {
  twilio: Twilio;
  env: SmsEnv | undefined;
  isDirty: boolean;
  updateNestedField: (path: string, value: unknown) => void;
}) {
  const t = useTranslations("admin.settings.sms");
  const { storeName } = useAppSettings();
  const { env, updateNestedField } = props;
  const serviceSid = props.twilio.messagingServiceSid || "";
  const fromNumber = props.twilio.fromNumber || "";
  const stored: SenderMode = serviceSid.trim()
    ? "service"
    : fromNumber.trim() || (env?.fromNumber && !env?.messagingServiceSid)
      ? "number"
      : "service";

  const [choice, setChoice] = useState<SenderMode | null>(null);
  const [wasDirty, setWasDirty] = useState(props.isDirty);
  if (wasDirty !== props.isDirty) {
    setWasDirty(props.isDirty);
    // Saved or discarded: the form holds stored values again, and so does this.
    if (!props.isDirty) setChoice(null);
  }
  const mode: SenderMode = serviceSid.trim() ? "service" : (choice ?? stored);
  const parkedServiceSid = useRef("");
  const [touched, setTouched] = useState(false);

  const value = mode === "service" ? serviceSid : fromNumber;
  const invalid =
    touched &&
    value.trim() !== "" &&
    (mode === "service" ? !isMessagingServiceSid(value) : !isValidSmsSender(value));
  const isName = mode === "number" && isAlphanumericSender(fromNumber);

  const pick = (next: SenderMode) => {
    if (next === mode) return;
    setChoice(next);
    setTouched(false);
    if (next === "number" && serviceSid) {
      parkedServiceSid.current = serviceSid;
      updateNestedField("sms.twilio.messagingServiceSid", "");
    }
    if (next === "service" && !serviceSid && parkedServiceSid.current) {
      updateNestedField("sms.twilio.messagingServiceSid", parkedServiceSid.current);
    }
  };

  return (
    <SettingRow
      inputId="twilioSender"
      label={<span id="twilioSenderLabel">{t("sender")}</span>}
      hint={
        <>
          <span className="block">
            {mode === "service" ? t("senderServiceHint") : t("senderNumberHint")}
          </span>
          {isName ? (
            <span className="text-foreground mt-2 flex items-start gap-2">
              <Info aria-hidden className="text-muted-foreground mt-0.5 size-4 shrink-0" />
              <span>{t("senderNameNote")}</span>
            </span>
          ) : null}
        </>
      }
      align="start"
    >
      <div className="w-full space-y-2">
        <Segmented
          labelledBy="twilioSenderLabel"
          value={mode}
          options={[
            { id: "service", label: t("senderService") },
            { id: "number", label: t("senderNumber") },
          ]}
          onChange={pick}
          className="grid-cols-2"
        />
        <Input
          id="twilioSender"
          value={value}
          onChange={(event) =>
            updateNestedField(
              mode === "service" ? "sms.twilio.messagingServiceSid" : "sms.twilio.fromNumber",
              event.target.value,
            )
          }
          onBlur={() => setTouched(true)}
          aria-invalid={invalid || undefined}
          placeholder={mode === "service" ? "MG…" : t("senderNumberPlaceholder", { senderId: senderIdExample(storeName) })}
          autoComplete="off"
          spellCheck={false}
        />
        {invalid ? (
          <p className="text-destructive text-xs">
            {mode === "service" ? t("senderServiceInvalid") : t("senderNumberInvalid")}
          </p>
        ) : null}
        <EnvSourceHint
          show={mode === "service" ? Boolean(env?.messagingServiceSid) : Boolean(env?.fromNumber)}
        />
        {mode === "number" && env?.messagingServiceSid ? (
          <p className={cn("text-xs", cautionClass)}>{t("senderEnvServiceWins")}</p>
        ) : null}
      </div>
    </SettingRow>
  );
}

/**
 * One real text through the saved settings. It is refused while the form
 * holds an edit (the credentials never reach the browser, so the old ones
 * would be tested), and the button says so up front instead of a toast after.
 */
function TestRow(props: {
  blocked: "dirty" | "setup" | null;
  isTesting: boolean;
  to: string;
  setTo: (value: string) => void;
  onTest: () => Promise<SmsTestResult | undefined>;
}) {
  const t = useTranslations("admin.settings.sms");
  const [result, setResult] = useState<SmsTestResult | null>(null);
  const { blocked } = props;

  return (
    <div>
      <SettingRow
        inputId="smsTestTo"
        label={t("testLabel")}
        hint={
          blocked ? (
            <span className={cautionClass}>
              {blocked === "dirty" ? t("testSaveFirst") : t("testSetupFirst")}
            </span>
          ) : (
            t("testHint")
          )
        }
        align="start"
      >
        <div className="flex w-full items-center gap-2">
          <Input
            id="smsTestTo"
            type="tel"
            className="min-w-0 flex-1"
            value={props.to}
            onChange={(event) => {
              props.setTo(event.target.value);
              setResult(null);
            }}
            placeholder="+8801712345678"
          />
          <Button
            type="button"
            variant="outline"
            disabled={Boolean(blocked) || props.isTesting || !props.to.trim()}
            onClick={async () => setResult((await props.onTest()) ?? null)}
          >
            {props.isTesting ? <Loader2 className="animate-spin" /> : <Send />}
            {t("testButton")}
          </Button>
        </div>
      </SettingRow>
      {result && !blocked ? (
        <p
          role={result.ok ? "status" : "alert"}
          className={cn(
            "flex items-start gap-2 px-4 pb-4 text-sm",
            result.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive",
          )}
        >
          {result.ok ? (
            <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
          ) : (
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          )}
          <span>{result.ok ? t("testSent", { to: result.to || props.to }) : result.message}</span>
        </p>
      ) : null}
    </div>
  );
}
