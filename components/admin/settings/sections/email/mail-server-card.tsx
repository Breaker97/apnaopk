"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";

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
import { NumberInput } from "@/components/ui/number-input";
import { SecretInput } from "@/components/admin/settings/fields/secret-input";
import { SettingList, SettingRow } from "@/components/admin/settings/fields/setting-row";
import { credentialMeta } from "@/components/admin/settings/fields/use-credential-meta";
import type { Settings } from "@/components/admin/settings/types";
import { portEncryption } from "./smtp-hints";

/** The id the lock note's link jumps to. */
export const VERIFICATION_CARD_ID = "email-verification";

/**
 * Where the store's mail goes out: server and port, login, password, with the
 * test that proves them in the header and the setup guide at the foot.
 *
 * Locked while sign-up verification is on. The server refuses any change to
 * these then (a new account must keep getting its link), and the form used
 * to let the admin type one and fail on save.
 */
export function MailServerCard({
  settings,
  locked,
  tested,
  status,
  action,
  guide,
  updateField,
}: {
  settings: Settings;
  locked: boolean;
  /** The saved settings passed a test; the Gmail password hint goes then. */
  tested: boolean;
  /** The line under the title: tested, failing, not set up, or save first. */
  status: ReactNode;
  /** The test button. */
  action: ReactNode;
  /** The setup guide. */
  guide: ReactNode;
  updateField: (path: string, value: unknown) => void;
}) {
  const t = useTranslations("admin.settings.email.server");
  const smtp = settings.email.smtp;
  const env = settings._meta?.envSources?.email;
  const secret = credentialMeta(settings, "email.smtp.password");
  const host = smtp.host || "";
  const gmail = host.toLowerCase().includes("gmail");

  const encryption = portEncryption(smtp.port);
  const portHint =
    encryption === "tls"
      ? t("portTls")
      : encryption === "starttls"
        ? t("portStarttls")
        : encryption === "other"
          ? t("portOther", { port: smtp.port })
          : t("portEmpty");

  // What the password field holds: a new one typed, a removal waiting for the
  // save (null), or nothing (keep the saved one).
  const typed = typeof smtp.password === "string" && smtp.password !== "";
  const removing = smtp.password === null && secret.set;
  const passwordHint = typed
    ? t("passwordReplace")
    : removing
      ? t("passwordRemoved")
      : gmail && !tested
        ? t("passwordGmail")
        : secret.set
          ? t("passwordSaved")
          : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{status}</CardDescription>
        <CardAction>{action}</CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {locked ? (
          <p className="bg-muted/40 text-muted-foreground flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm">
            <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>
              {t.rich("locked", {
                link: (chunks) => (
                  <a
                    href={`#${VERIFICATION_CARD_ID}`}
                    className="text-primary font-medium hover:underline"
                  >
                    {chunks}
                  </a>
                ),
              })}
            </span>
          </p>
        ) : null}

        <SettingList>
          <SettingRow
            inputId="smtpHost"
            label={t("host")}
            hint={
              <>
                <span className="block">{portHint}</span>
                <EnvNote show={Boolean(env?.host)} />
              </>
            }
          >
            <Input
              id="smtpHost"
              className="min-w-0 flex-1"
              value={host}
              disabled={locked}
              placeholder="smtp.example.com"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => updateField("email.smtp.host", event.target.value)}
            />
            <NumberInput
              id="smtpPort"
              aria-label={t("port")}
              className="w-20"
              min={1}
              max={65535}
              step={1}
              value={smtp.port || 587}
              whenEmpty="keep"
              normalize={Math.trunc}
              disabled={locked}
              onValueChange={(next) => {
                if (next !== undefined) updateField("email.smtp.port", next);
              }}
            />
          </SettingRow>

          <SettingRow
            inputId="smtpUser"
            label={t("username")}
            hint={env?.user ? <EnvNote show /> : undefined}
          >
            <Input
              id="smtpUser"
              value={smtp.user || ""}
              disabled={locked}
              placeholder="you@example.com"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => updateField("email.smtp.user", event.target.value)}
            />
          </SettingRow>

          <SettingRow
            inputId="smtpPassword"
            label={t("password")}
            hint={
              passwordHint || env?.password ? (
                <>
                  {passwordHint ? <span className="block">{passwordHint}</span> : null}
                  <EnvNote show={Boolean(env?.password)} />
                </>
              ) : undefined
            }
          >
            <div className="min-w-0 flex-1">
              <SecretInput
                id="smtpPassword"
                value={typeof smtp.password === "string" ? smtp.password : ""}
                onChange={(value) => updateField("email.smtp.password", value)}
                secretSet={secret.set && !removing}
                maskedHint={secret.hint}
                disabled={locked}
              />
            </div>
            {secret.set && !typed && !removing && !locked ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => updateField("email.smtp.password", null)}
              >
                {t("remove")}
              </Button>
            ) : null}
          </SettingRow>
        </SettingList>

        {guide}
      </CardContent>
    </Card>
  );
}

/**
 * `EnvSourceHint`'s line ("Set via environment variable…") as a span: here it
 * sits inside a row's hint paragraph, where a second paragraph is invalid.
 */
function EnvNote({ show }: { show: boolean }) {
  const t = useTranslations("admin.settings.fields");
  if (!show) return null;
  return (
    <span className="mt-1 flex items-center gap-1 text-xs">
      <Lock aria-hidden className="h-3 w-3 shrink-0" />
      <span>{t("envSourceHint")}</span>
    </span>
  );
}
