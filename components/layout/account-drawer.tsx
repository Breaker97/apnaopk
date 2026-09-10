"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { type OAuthEnabled } from "@/components/auth/login-form";
import { type Locale } from "@/config/i18n.config";

interface AccountDrawerProps {
  locale: Locale;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  /** Server-resolved on the store layout, same flags the /login page gets. */
  oauthEnabled: OAuthEnabled;
  demoModeEnabled: boolean;
  emailVerificationRequired: boolean;
}

// The forms (and react-hook-form + zod behind them) load when the drawer
// opens, not with every storefront page — see account-drawer-content.tsx.
const AccountDrawerContent = dynamic(
  () =>
    import("@/components/layout/account-drawer-content").then(
      (module) => module.AccountDrawerContent,
    ),
  { ssr: false, loading: () => <AccountDrawerLoading /> },
);

function AccountDrawerLoading() {
  const t = useTranslations();
  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <SheetTitle className="min-w-0 flex-1 truncate text-base font-bold">
          {t("common.account")}
        </SheetTitle>
      </div>
      <div className="space-y-3 px-5 py-5" aria-busy="true">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  );
}

/**
 * The guest half of the bottom nav's Account tab: the real sign-in and sign-up
 * forms, in a sheet.
 *
 * The tab used to link to /login, which threw a shopper off the page they were
 * browsing just to reach a form. Here they fill it in place — same hooks the
 * /login and /register pages use, so OAuth, 2FA, email verification and the
 * demo quick-login all behave identically.
 *
 * No `redirectTo` is passed: a shopper tapping "Account" asked for their own
 * area, not for the page underneath, so `useLoginForm` sends each role to the
 * place it is actually allowed to land — admin and vendor to their dashboards,
 * staff to theirs, a customer to /account.
 *
 * Guests only. Signed-in shoppers have a real /account page, so their tab stays
 * a link and this never mounts for them.
 */
export function AccountDrawer({
  locale,
  isOpen,
  setIsOpen,
  oauthEnabled,
  demoModeEnabled,
  emailVerificationRequired,
}: AccountDrawerProps) {
  const close = () => setIsOpen(false);

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-[min(92vw,380px)] gap-0 overflow-y-auto p-0"
      >
        {isOpen ? (
          <AccountDrawerContent
            locale={locale}
            close={close}
            oauthEnabled={oauthEnabled}
            demoModeEnabled={demoModeEnabled}
            emailVerificationRequired={emailVerificationRequired}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
