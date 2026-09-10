import Link from "next/link";
import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { Lock, Mail, Home, LogIn } from "lucide-react";
import { StatusPageShell } from "@/components/errors/status-page-shell";
import { Button } from "@/components/ui/button";
import { appConfig } from "@/config/app.config";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });

  return {
    title: t("errors.unauthorized"),
    description: t("errors.unauthorizedDescription"),
    robots: { index: false, follow: false },
  };
}

export default async function ForbiddenPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });

  const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;

  const homeHref = `/${locale}`;
  const loginHref = `/${locale}${appConfig.urls.login}`;

  return (
    <StatusPageShell
      code="403"
      title={t("errors.unauthorized")}
      description={t("errors.unauthorizedDescription")}
      icon={<Lock className="size-5" />}
      primaryAction={
        <Button asChild className="w-full sm:w-auto">
          <Link href={homeHref}>
            <Home className="size-4" aria-hidden="true" />
            {t("common.backToHome")}
          </Link>
        </Button>
      }
      secondaryAction={
        <Button asChild variant="secondary" className="w-full sm:w-auto">
          <Link href={loginHref}>
            <LogIn className="size-4" aria-hidden="true" />
            {t("common.login")}
          </Link>
        </Button>
      }
    >
      {supportEmail ? (
        <div className="rounded-lg border bg-muted/20 p-4">
          <div className="flex items-start gap-3">
            <div
              className="grid size-9 place-items-center rounded-md bg-muted text-foreground"
              aria-hidden="true"
            >
              <Mail className="size-4" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {t("errors.needAccessTitle")}
              </p>
              <p className="text-sm text-muted-foreground">
                {t("errors.needAccessDescription", {
                  email: supportEmail,
                })}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </StatusPageShell>
  );
}
