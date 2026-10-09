"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { BookOpen, ExternalLink, LifeBuoy } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  SetupGuide,
  SetupGuideCaution,
  SetupGuideCode,
  SetupGuideSection,
  SetupGuideSteps,
} from "@/components/admin/setup-guide";
import { cn } from "@/lib/utils";
import { useAppSettings } from "@/providers/app-settings-provider";
import {
  EMAIL_PROVIDERS,
  detectEmailProvider,
  type EmailProvider,
} from "./smtp-hints";

/**
 * Each provider's guide: how many steps it has
 * (`admin.settings.email.guide.<provider>.step<n>`), the values one of them
 * shows in code, and the provider's own page. Values are never translated, so
 * they live here; a host whose name differs per account (cPanel, Amazon SES)
 * is shown with a placeholder.
 */
const GUIDES: Record<
  EmailProvider,
  { steps: number; code?: Partial<Record<number, string>>; link?: string }
> = {
  gmail: {
    steps: 5,
    code: { 3: "smtp.gmail.com    587" },
    link: "https://myaccount.google.com/apppasswords",
  },
  zoho: {
    steps: 4,
    code: { 1: "smtppro.zoho.com    587" },
    link: "https://accounts.zoho.com",
  },
  hosting: { steps: 4, code: { 2: "mail.yourdomain.com    465" } },
  brevo: {
    steps: 5,
    code: { 4: "smtp-relay.brevo.com    587" },
    link: "https://app.brevo.com",
  },
  sendgrid: {
    steps: 4,
    code: { 3: "smtp.sendgrid.net    587    apikey" },
    link: "https://app.sendgrid.com",
  },
  ses: {
    steps: 4,
    code: { 2: "email-smtp.<region>.amazonaws.com    587" },
    link: "https://console.aws.amazon.com/ses/",
  },
  other: { steps: 4 },
};

/** What a failed test's error says, as the mail server words it, and why. */
const TROUBLE = [
  { key: "login", code: "535  Username and Password not accepted  /  Invalid login" },
  { key: "timeout", code: "Connection timed out" },
  { key: "sender", code: "550  Sender address rejected" },
  { key: "certificate", code: "certificate  /  TLS" },
] as const;

/**
 * How to fill in the Mail server card, at its foot, in the look of the other
 * setup guides (Omnichannel, Storage).
 *
 * The title follows the server typed above, so a store on Gmail reads "Gmail
 * setup guide"; the chips open another provider's steps. `defaultOpen` is read
 * once: the page keys the guide on its test state, so the steps fold away once
 * a test passes and "If the test fails" opens after one fails.
 */
export function EmailSetupGuide({
  host,
  defaultOpen,
}: {
  host: string;
  defaultOpen: Array<"setup" | "fix">;
}) {
  const t = useTranslations("admin.settings.email.guide");
  const { storeName } = useAppSettings();
  const [picked, setPicked] = useState<EmailProvider | null>(null);
  const named = picked ?? detectEmailProvider(host);
  const provider = named ?? "gmail";
  const guide = GUIDES[provider];

  const title =
    named && named !== "other"
      ? t("title", { provider: t(`providers.${named}`) })
      : t("titleGeneric");

  return (
    <SetupGuide defaultOpen={defaultOpen}>
      <SetupGuideSection value="setup" icon={BookOpen} title={title}>
        <div
          role="radiogroup"
          aria-label={t("provider")}
          className="flex flex-wrap items-center gap-1.5"
        >
          <span aria-hidden className="text-muted-foreground mr-1 text-xs">
            {t("provider")}
          </span>
          {EMAIL_PROVIDERS.map((id) => {
            const on = id === provider;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setPicked(id)}
                className={cn(
                  "h-6 rounded-full border px-2.5 text-xs font-medium transition-colors",
                  on
                    ? "border-primary bg-primary/10 text-primary"
                    : "bg-background text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`providers.${id}`)}
              </button>
            );
          })}
        </div>
        <SetupGuideSteps
          steps={Array.from({ length: guide.steps }, (_, index) => ({
            key: `${provider}-${index + 1}`,
            text: t(`${provider}.step${index + 1}`, { storeName }),
            code: guide.code?.[index + 1],
          }))}
        />
        <SetupGuideCaution>{t(`${provider}.caution`)}</SetupGuideCaution>
        <div className="flex flex-wrap items-center gap-3">
          {guide.link ? (
            <Button asChild type="button" variant="outline" size="sm">
              <a href={guide.link} target="_blank" rel="noopener noreferrer">
                {t(`${provider}.link`)}
                <ExternalLink className="ml-2 size-3.5" />
              </a>
            </Button>
          ) : null}
          <p className="text-muted-foreground text-xs">{t("docs")}</p>
        </div>
      </SetupGuideSection>

      <SetupGuideSection value="fix" icon={LifeBuoy} title={t("fix.title")}>
        <p className="text-muted-foreground text-xs leading-relaxed">
          {t("fix.intro")}
        </p>
        <ul className="space-y-3">
          {TROUBLE.map((item) => (
            <li
              key={item.key}
              className="text-muted-foreground space-y-1.5 text-xs leading-relaxed"
            >
              <SetupGuideCode>{item.code}</SetupGuideCode>
              <p>{t(`fix.${item.key}`)}</p>
            </li>
          ))}
        </ul>
      </SetupGuideSection>
    </SetupGuide>
  );
}
