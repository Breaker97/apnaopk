import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "@/components/language/link";
import { StoreBreadcrumb } from "@/components/store/store-breadcrumb";
import { Button } from "@/components/ui/button";
import { getLocaleRouting } from "@/lib/i18n/locale-routing";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";

interface PageProps {
  params: Promise<{ locale: string }>;
}

/**
 * How to delete an account, for people who are not signed in: the public
 * address Google Play asks an app with sign-up to give, where a user can
 * request deletion without the app. It names the two ways to delete
 * (the app, the account's Security page), a way to ask when signing in is
 * not possible, and what is deleted and what the store keeps.
 *
 * Always on: unlike the admin's content pages, a store cannot hide it while
 * its app is listed.
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const [t, { storeName }] = await Promise.all([
    getTranslations({ locale, namespace: "account.deletionPage" }),
    getStorefrontSettings(),
  ]);
  return {
    title: t("title", { storeName }),
    description: t("intro", { storeName }),
  };
}

export default async function AccountDeletionPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, { storeDefault }, { storeName, storeEmail, contentPages }] =
    await Promise.all([
      getTranslations({ locale, namespace: "account.deletionPage" }),
      getLocaleRouting(),
      getStorefrontSettings(),
    ]);
  const title = t("title", { storeName });
  const mailto = storeEmail
    ? `mailto:${storeEmail}?subject=${encodeURIComponent(t("emailSubject", { storeName }))}`
    : null;

  return (
    <section className="py-10 md:py-14">
      <div className="container mx-auto max-w-4xl px-4">
        <StoreBreadcrumb
          locale={locale}
          storeDefault={storeDefault}
          items={[{ label: t("breadcrumb") }]}
        />

        <article className="space-y-8 rounded-2xl border border-border/70 bg-card/95 p-6 md:p-8">
          <header className="space-y-3">
            <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{title}</h1>
            <p className="text-muted-foreground">{t("intro", { storeName })}</p>
          </header>

          <section className="space-y-2">
            <h2 className="text-xl font-semibold">{t("inAppTitle")}</h2>
            <p className="text-muted-foreground">{t("inAppSteps", { storeName })}</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">{t("onWebTitle")}</h2>
            <p className="text-muted-foreground">{t("onWebSteps")}</p>
            <Button asChild>
              <Link href="/account/security">{t("onWebButton")}</Link>
            </Button>
          </section>

          <section className="space-y-2">
            <h2 className="text-xl font-semibold">{t("cannotSignInTitle")}</h2>
            <p className="text-muted-foreground">
              {t.rich("cannotSignInReset", {
                reset: (chunks) => (
                  <Link href="/forgot-password" className="font-medium text-primary underline-offset-4 hover:underline">
                    {chunks}
                  </Link>
                ),
              })}
            </p>
            {mailto ? (
              <p className="text-muted-foreground">
                {t.rich("cannotSignInEmail", {
                  email: () => (
                    <a href={mailto} className="font-medium text-primary underline-offset-4 hover:underline">
                      {storeEmail}
                    </a>
                  ),
                })}
              </p>
            ) : contentPages.contact.visible ? (
              <p className="text-muted-foreground">
                {t.rich("cannotSignInContact", {
                  contact: (chunks) => (
                    <Link href="/contact" className="font-medium text-primary underline-offset-4 hover:underline">
                      {chunks}
                    </Link>
                  ),
                })}
              </p>
            ) : null}
          </section>

          <section className="space-y-2">
            <h2 className="text-xl font-semibold">{t("whatGoesTitle")}</h2>
            <p className="text-muted-foreground">{t("whatGoes")}</p>
          </section>

          <section className="space-y-2">
            <h2 className="text-xl font-semibold">{t("whatStaysTitle")}</h2>
            <p className="text-muted-foreground">{t("whatStays")}</p>
          </section>
        </article>
      </div>
    </section>
  );
}
