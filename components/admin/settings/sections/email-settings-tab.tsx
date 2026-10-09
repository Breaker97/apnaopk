"use client";

import { useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CircleCheck, CircleX } from "lucide-react";

import { DEFAULT_STORE_NAME } from "@/config/branding.config";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast-notification";
import type { Settings } from "@/components/admin/settings/types";
import type { EmailTestResult } from "@/components/admin/settings/use-admin-settings";
import { credentialMeta } from "@/components/admin/settings/fields/use-credential-meta";
import { SettingsTabHeader } from "./settings-tab-header";
import { StickySaveFooter } from "./sticky-save-footer";
import { DeliveryLogs, type LogRetentionDays } from "../delivery-logs";
import { EmailSetupGuide } from "./email/email-setup-guide";
import { MailServerCard } from "./email/mail-server-card";
import { SenderCard } from "./email/sender-card";
import { StuckEmailsBanner } from "./email/stuck-emails-banner";
import { TestEmailPopover } from "./email/test-email-popover";
import { useEmailQueueHealth } from "./email/use-email-queue";
import { VerificationCard } from "./email/verification-card";

/** What a test proves (lib/email/smtp-verification.ts): an edit to one of these needs a new test. */
function serverFields(settings: Settings) {
  const email = settings.email;
  return JSON.stringify([
    Boolean(email.enabled),
    email.smtp.host ?? "",
    email.smtp.port ?? null,
    email.smtp.user ?? "",
    // A typed password, or null for a removal; the saved one never comes back.
    email.smtp.password === undefined || email.smtp.password === ""
      ? ""
      : email.smtp.password,
    email.fromEmail ?? "",
  ]);
}

/**
 * Settings → Email: the switch, the mail server with its test and setup guide,
 * the sender customers see, the sign-up verification that depends on both, and
 * the delivery log.
 *
 * The page says up front what the server enforces on save. Verification can
 * be switched on only once the saved server passed a test, and while it is on
 * the server, its login and the From email cannot change. Both used to be
 * save-time errors under a form that let you try.
 */
export function EmailSettingsTab(props: {
  settings: Settings;
  /** The copy last loaded or saved: the lock and the test go by it. */
  savedSettings: Settings;
  isSaving: boolean;
  /** Unsaved edits to the email block (server, sender, switch). */
  isEmailDirty: boolean;
  /** Unsaved edits to the verification switches. */
  isVerificationDirty: boolean;
  isTestingEmail: boolean;
  /** The signed-in admin's address, offered for the test email. */
  adminEmail: string;
  updateNestedField: (path: string, value: unknown) => void;
  updateFieldInSection: (section: string, path: string, value: unknown) => void;
  onSave: () => void | Promise<unknown>;
  onDiscard: () => void;
  onTestSmtp: (to: string) => Promise<EmailTestResult | undefined>;
  /** Saves the log's retention at once, apart from the page's form. */
  onSaveRetention: (days: LogRetentionDays) => void | Promise<unknown>;
}) {
  const t = useTranslations("admin.settings.email");
  const tSettings = useTranslations("admin.settings");
  const locale = useLocale();
  const { settings, savedSettings } = props;
  const email = settings.email;
  const { health, reload } = useEmailQueueHealth();

  // The test run on this visit. It ends with the next save: a pass or a
  // failure describes the settings as they were.
  const [lastTest, setLastTest] = useState<(EmailTestResult & { for: Settings }) | null>(
    null,
  );
  const test = lastTest?.for === savedSettings ? lastTest : null;

  // The log, opened on another tab (the warning's "Show them") by a remount.
  const [log, setLog] = useState<{ key: number; tab: "all" | "waiting" }>({
    key: 0,
    tab: "all",
  });
  const [logRefresh, setLogRefresh] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);

  const enabled = Boolean(email.enabled);
  const env = settings._meta?.envSources?.email;
  const envLogin = Boolean(env?.user && env?.password);
  // Whether the SAVED settings hold a login: the status and the guide go by
  // the saved copy, so typing into the form folds nothing under the cursor.
  const hasLogin =
    Boolean(savedSettings.email.smtp.user?.trim() || env?.user) &&
    Boolean(credentialMeta(savedSettings, "email.smtp.password").set || env?.password);

  const saved = savedSettings.security;
  // The server refuses SMTP changes while either rule is on, Multi-Vendor
  // Mode or not (app/api/admin/settings/route.ts).
  const locked = Boolean(
    saved?.emailVerificationRequired || saved?.emailVerificationForVendors,
  );
  const serverDirty = serverFields(settings) !== serverFields(savedSettings);
  const verifiedAt = test?.ok
    ? (test.verifiedAt ?? new Date().toISOString())
    : test
      ? undefined
      : saved?.smtpVerifiedAt;
  const tested = Boolean(verifiedAt);
  const canTurnOn = tested && !serverDirty && enabled;
  const showVendors =
    Boolean(settings.multiVendorMode?.enabled) ||
    Boolean(settings.security?.emailVerificationForVendors);

  // The newest email failed after these settings passed a test: say so,
  // rather than "Tested" over a password revoked since. A failure before the
  // pass, or with settings never tested, belongs to settings that are gone;
  // "Not tested" asks for the test that tells.
  const lastAttempt = health?.lastAttempt;
  const sendingFails = Boolean(
    lastAttempt &&
      !lastAttempt.ok &&
      verifiedAt &&
      new Date(lastAttempt.at) > new Date(verifiedAt),
  );

  const moment = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));

  // What is unfinished in the saved settings opens in the guide: the steps
  // until a test passes, the fixes after one fails. Not edits in progress.
  const guideOpen: Array<"setup" | "fix"> =
    (test && !test.ok) || sendingFails ? ["fix"] : tested && hasLogin ? [] : ["setup"];

  let status: ReactNode;
  if (props.isEmailDirty) {
    status = t("server.saveFirst");
  } else if (test && !test.ok) {
    status = <Failure>{t("server.failed", { error: test.message })}</Failure>;
  } else if (sendingFails && lastAttempt) {
    status = (
      <Failure>
        {t("server.lastFailed", {
          date: moment(lastAttempt.at),
          error: lastAttempt.error ?? "",
        })}
      </Failure>
    );
  } else if (!hasLogin) {
    status = t("server.notSetUp");
  } else if (tested && verifiedAt) {
    status = (
      <span className="flex items-center gap-1.5">
        <CircleCheck aria-hidden className="size-4 shrink-0 text-emerald-600" />
        {test?.ok ? t("server.testedNow") : t("server.tested", { date: moment(verifiedAt) })}
      </span>
    );
  } else {
    status = (
      <span className="text-amber-700 dark:text-amber-400">{t("server.untested")}</span>
    );
  }

  const sendTest = async (to: string) => {
    const result = await props.onTestSmtp(to);
    if (!result) return;
    setLastTest({ ...result, for: savedSettings });
    if (result.ok) toast.success(t("test.sent", { email: to }));
    // The test is a row in the log, and the newest email for the status.
    setLogRefresh((count) => count + 1);
    void reload();
  };

  const openLog = (tab: "all" | "waiting") => {
    setLog((current) => ({ key: current.key + 1, tab }));
    window.requestAnimationFrame(() =>
      logRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };

  const storeName = settings.general?.storeName?.trim() || DEFAULT_STORE_NAME;

  return (
    <div className="space-y-4">
      <SettingsTabHeader
        title={t("title")}
        description={
          enabled
            ? t("description")
            : envLogin
              ? t("descriptionOffEnv")
              : t("descriptionOff")
        }
        control={
          <Switch
            className="mt-1"
            checked={enabled}
            // Switching off changes the server a passed test vouched for,
            // which the save refuses while verification is on.
            disabled={locked}
            aria-label={t("switchLabel")}
            onCheckedChange={(on) => props.updateNestedField("email.enabled", on)}
          />
        }
      />

      <StuckEmailsBanner
        health={health}
        onShow={() => openLog("waiting")}
        onCancelled={async () => {
          openLog("all");
          await reload();
        }}
      />

      {enabled ? (
        <>
          <MailServerCard
            settings={settings}
            locked={locked}
            tested={tested}
            status={status}
            action={
              <TestEmailPopover
                defaultTo={props.adminEmail}
                disabled={props.isEmailDirty || props.isTestingEmail}
                busy={props.isTestingEmail}
                onSend={sendTest}
              />
            }
            guide={
              <EmailSetupGuide
                // Keyed on what is unfinished, so a passing test folds the
                // steps and a failing one opens "If the test fails".
                key={guideOpen.join() || "done"}
                host={email.smtp.host || ""}
                defaultOpen={guideOpen}
              />
            }
            updateField={props.updateNestedField}
          />
          <SenderCard
            settings={settings}
            locked={locked}
            storeName={storeName}
            updateField={props.updateNestedField}
          />
          <VerificationCard
            settings={settings}
            showVendors={showVendors}
            canTurnOn={canTurnOn}
            needReason={canTurnOn ? null : tested && serverDirty ? "save" : "test"}
            failing={locked && sendingFails}
            updateField={(path, value) =>
              props.updateFieldInSection("emailVerification", path, value)
            }
          />
        </>
      ) : null}

      <StickySaveFooter
        label={tSettings("general.save")}
        isSaving={props.isSaving}
        isDirty={props.isEmailDirty || props.isVerificationDirty}
        onSave={props.onSave}
        onDiscard={props.onDiscard}
      />

      <div ref={logRef} className="scroll-mt-20">
        <DeliveryLogs
          key={log.key}
          kind="email"
          initialTab={log.tab}
          refreshKey={logRefresh}
          // Switched off with nothing ever sent, the page is its header.
          hideWhenEmpty={!enabled}
          retentionDays={email.logRetentionDays ?? 30}
          onRetentionDaysChange={props.onSaveRetention}
        />
      </div>
    </div>
  );
}

function Failure({ children }: { children: ReactNode }) {
  return (
    <span className="text-destructive flex items-start gap-1.5">
      <CircleX aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </span>
  );
}
