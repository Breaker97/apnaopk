"use client";

import { useTranslations } from "next-intl";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SettingList, SettingRow } from "@/components/admin/settings/fields/setting-row";
import type { Settings } from "@/components/admin/settings/types";
import { inboxSender, needsGmailAlias } from "./smtp-hints";

/**
 * What customers see in their inbox, apart from the server details: it used
 * to sit in the same grid as the host and password.
 *
 * The title line shows the sender as it goes out, fallbacks included: a blank
 * From name sends the store's name (the field's old placeholder said "Your
 * Store Name"), a blank From email sends the login.
 */
export function SenderCard({
  settings,
  locked,
  storeName,
  updateField,
}: {
  settings: Settings;
  /** The From email is part of what a test proves, so it locks with the server. */
  locked: boolean;
  storeName: string;
  updateField: (path: string, value: unknown) => void;
}) {
  const t = useTranslations("admin.settings.email.sender");
  const email = settings.email;
  const user = email.smtp.user || "";
  const fromEmail = email.fromEmail || "";
  const alias = needsGmailAlias({ host: email.smtp.host, user, fromEmail });

  const fromEmailNote = locked
    ? t("fromEmailLocked")
    : !fromEmail.trim()
      ? t("fromEmailHint")
      : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>
          {t.rich("preview", {
            sender: inboxSender({
              fromName: email.fromName,
              fromEmail,
              user,
              storeName,
            }),
            strong: (chunks) => (
              <strong className="text-foreground font-medium">{chunks}</strong>
            ),
          })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SettingList>
          <SettingRow inputId="smtpFromName" label={t("fromName")} hint={t("fromNameHint")}>
            <Input
              id="smtpFromName"
              value={email.fromName || ""}
              placeholder={storeName}
              onChange={(event) => updateField("email.fromName", event.target.value)}
            />
          </SettingRow>
          <SettingRow
            inputId="smtpFromEmail"
            label={t("fromEmail")}
            align="start"
            hint={
              fromEmailNote || alias ? (
                <>
                  {fromEmailNote ? <span className="block">{fromEmailNote}</span> : null}
                  {alias ? (
                    <span className="block text-amber-700 dark:text-amber-400">
                      {t("gmailAlias", { user, from: fromEmail.trim() })}
                    </span>
                  ) : null}
                </>
              ) : undefined
            }
          >
            <Input
              id="smtpFromEmail"
              type="email"
              value={fromEmail}
              disabled={locked}
              placeholder={user || "noreply@yourstore.com"}
              autoComplete="off"
              onChange={(event) => updateField("email.fromEmail", event.target.value)}
            />
          </SettingRow>
        </SettingList>
      </CardContent>
    </Card>
  );
}
