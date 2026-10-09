import type { Metadata } from "next";
import Link from "@/components/language/link";
import { LinkIcon } from "lucide-react";
import { setRequestLocale } from "next-intl/server";
import { type Locale } from "@/config/i18n.config";
import { User } from "@/models";
import { getSettings } from "@/models/settings.model";
import { Button } from "@/components/ui/button";
import { DEFAULT_STORE_NAME } from "@/config/branding.config";
import { MARKETING_CONSENT_STATE } from "@/config/app.config";
import {
  findProfileByUnsubscribeToken,
  readEmailConsentState,
} from "@/lib/customers/marketing-consent";
import { MarketingConfirmView } from "@/components/store/marketing-confirm-view";

/**
 * Confirming a subscription, from the link in the double opt-in email.
 *
 * The twin of the unsubscribe page, and narrow in the same way: the token says
 * whose subscription this is, and the only thing the page can do is finish
 * what the shopper started at checkout.
 */

export const metadata: Metadata = {
  title: "Confirm your subscription",
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

export default async function MarketingConfirmPage({ params }: PageProps) {
  const { locale, token } = await params;
  setRequestLocale(locale as Locale);

  const [profile, settings] = await Promise.all([
    findProfileByUnsubscribeToken(token),
    getSettings(),
  ]);
  const storeName = settings.general?.storeName || DEFAULT_STORE_NAME;
  const state = profile ? readEmailConsentState(profile) : null;
  const usable =
    state === MARKETING_CONSENT_STATE.PENDING ||
    state === MARKETING_CONSENT_STATE.SUBSCRIBED;

  if (!profile || !usable) {
    // A link that has been superseded — they unsubscribed since, or the
    // address was suppressed — reads the same as one that never worked.
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
            It may have been mistyped, or the subscription it confirms has
            since been cancelled. Tick the box at your next checkout to
            subscribe again.
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

  const email = profile.email
    ? profile.email
    : profile.userId
      ? ((
          await User.findById(profile.userId).select("email").lean<{
            email?: string;
          } | null>()
        )?.email ?? "")
      : "";

  return (
    <Shell>
      <MarketingConfirmView
        token={token}
        email={email}
        storeName={storeName}
        alreadyConfirmed={state === MARKETING_CONSENT_STATE.SUBSCRIBED}
      />
    </Shell>
  );
}
