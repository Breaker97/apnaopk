import type { Metadata } from "next";
import Link from "@/components/language/link";
import { LinkIcon } from "lucide-react";
import { setRequestLocale } from "next-intl/server";
import { type Locale } from "@/config/i18n.config";
import { getSettings } from "@/models/settings.model";
import { Button } from "@/components/ui/button";
import { DEFAULT_STORE_NAME } from "@/config/branding.config";
import { getUnsubscribePageState } from "@/lib/customers/marketing-consent";
import { UnsubscribeView } from "@/components/store/unsubscribe-view";

/**
 * Leaving the marketing list, from the link at the foot of an email.
 *
 * Most people this store emails are guests with no account to sign into, so
 * the token in the URL is the whole credential — a customer record's own, or a
 * sealed one carrying the address of someone with no record at all. It is read
 * here only to say whose preferences these are; changing them is the POST the
 * view makes.
 *
 * Deliberately narrow, like the pre-order balance link: a leaked URL exposes
 * one email address and can do one thing.
 */

export const metadata: Metadata = {
  title: "Email preferences",
  // A capability URL has no business in a search index.
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ locale: string; token: string }>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="container mx-auto max-w-lg px-4 py-12 sm:py-16">
      {children}
    </div>
  );
}

export default async function UnsubscribePage({ params }: PageProps) {
  const { locale, token } = await params;
  setRequestLocale(locale as Locale);

  const [link, settings] = await Promise.all([
    getUnsubscribePageState(token),
    getSettings(),
  ]);
  const storeName = settings.general?.storeName || DEFAULT_STORE_NAME;

  if (!link) {
    // One message for a forged token and for a retired one alike: telling
    // them apart would make this page a way to test whether an address is on
    // the list.
    return (
      <Shell>
        <div className="rounded-2xl border bg-card p-6 sm:p-8">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
            <LinkIcon className="h-5 w-5 text-muted-foreground" aria-hidden />
          </div>
          <h1 className="mt-4 text-xl font-semibold">
            This link is no longer valid
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            It may have been mistyped or truncated by an email client. Open the
            link from the foot of a recent email again, or sign in and change
            your preferences from your account.
          </p>
          <div className="mt-6">
            <Button asChild variant="outline" className="rounded-full">
              <Link href="/">Back to the store</Link>
            </Button>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <UnsubscribeView
        token={token}
        email={link.email}
        initialState={link.state}
        storeName={storeName}
      />
    </Shell>
  );
}
