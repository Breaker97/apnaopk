"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Suspense, useState } from "react";
import { Loader2, Shield } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { sanitizeReturnPath } from "@/lib/auth/return-path";
import { cn } from "@/lib/utils";
import { useParams, useSearchParams } from "next/navigation";
import {
  DemoCredentialsList,
  LoginFields,
  LoginOAuthButtons,
  TwoFactorFields,
  demoCredentials,
  useLoginForm,
  type OAuthEnabled,
} from "@/components/auth/login-form";

interface LoginPageProps {
  /** Resolved on the server so the buttons render in the initial HTML. */
  oauthEnabled: OAuthEnabled;
  demoModeEnabled: boolean;
}

function LoginContent({ oauthEnabled, demoModeEnabled }: LoginPageProps) {
  const t = useTranslations();
  const params = useParams();
  const locale = params.locale as string;
  const searchParams = useSearchParams();

  const [dismissedSearchErrorKey, setDismissedSearchErrorKey] = useState<
    string | null
  >(null);

  const showDemoCredentials = demoModeEnabled && demoCredentials.length > 0;

  const formatRoleLabel = (role: string) => {
    const value = role.trim();
    if (!value) return "";
    return value.charAt(0).toUpperCase() + value.slice(1);
  };

  const searchErrorCode = searchParams.get("error");
  const searchErrorRole = searchParams.get("role") || "";
  const searchErrorEmail = searchParams.get("email") || "";
  const searchErrorKey = searchErrorCode
    ? `${searchErrorCode}:${searchErrorRole}:${searchErrorEmail}`
    : null;
  let searchErrorMessage: string | null = null;

  if (searchErrorCode === "oauth_account_role_conflict") {
    const role = formatRoleLabel(searchErrorRole);
    searchErrorMessage = t("auth.oauthRoleConflict", {
      email: searchErrorEmail || t("auth.thisEmail"),
      role: role || t("auth.vendorRole"),
    });
  } else if (
    searchErrorCode === "oauth_customer_only" ||
    searchErrorCode === "OAUTH_SIGNIN_IS_ONLY_AVAILABLE_FOR_CUSTOMERS"
  ) {
    searchErrorMessage = t("auth.oauthCustomerOnly");
  }

  const dismissSearchError = () => {
    if (searchErrorKey) {
      setDismissedSearchErrorKey(searchErrorKey);
    }
  };

  /**
   * `redirect` is this page's own convention, but most of the app links here
   * with `?callbackUrl=` (account pages, wishlist, become-vendor, chat). Both
   * are accepted so those return-to targets aren't silently dropped.
   * Sanitized to same-origin paths so a crafted link can't bounce a fresh
   * login to an external site.
   */
  const redirectParam = sanitizeReturnPath(
    searchParams.get("redirect") || searchParams.get("callbackUrl"),
  );

  const state = useLoginForm({
    locale,
    redirectTo: redirectParam,
    onAttempt: dismissSearchError,
  });

  const visibleError =
    state.error ||
    (searchErrorKey !== dismissedSearchErrorKey ? searchErrorMessage : null);

  // 2FA Verification Screen
  if (state.requires2FA) {
    return (
      <Card className="shadow-lg">
        <CardHeader className="space-y-1 text-center">
          <div className="flex justify-center mb-2">
            <Shield className="h-12 w-12 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold">
            {t("auth.twoFactorTitle")}
          </CardTitle>
          <CardDescription>{t("auth.twoFactorDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <TwoFactorFields state={state} error={state.error} />
        </CardContent>
        <CardFooter>
          <Button variant="link" className="w-full" onClick={state.cancel2FA}>
            {t("auth.backToLogin")}
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <div
      className={cn(
        "auth-wide mx-auto grid w-full max-w-md items-center gap-6",
        showDemoCredentials
          ? "lg:max-w-none lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]"
          : "lg:grid-cols-[minmax(0,26rem)] lg:justify-center",
      )}
    >
      <Card className="shadow-lg">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-2xl font-bold">
            {t("auth.welcomeBack")}
          </CardTitle>
          <CardDescription>{t("auth.signIn")}</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginOAuthButtons state={state} oauthEnabled={oauthEnabled} />
          <LoginFields state={state} error={visibleError} />
        </CardContent>
        <CardFooter className="flex flex-col gap-4">
          <div className="relative w-full">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">
                {t("auth.noAccount")}
              </span>
            </div>
          </div>
          <Button variant="outline" className="w-full" asChild>
            {/* Keep the return-to target across the switch to sign-up, so a
                guest who registers instead still lands where they meant to. */}
            <Link
              href={`/${locale}/register${
                redirectParam
                  ? `?redirect=${encodeURIComponent(redirectParam)}`
                  : ""
              }`}
            >
              {t("auth.createAccount")}
            </Link>
          </Button>
        </CardFooter>
      </Card>
      {showDemoCredentials && (
        <Card className="h-fit gap-3 px-2 py-4 shadow-lg">
          <CardHeader className="px-2 gap-1 text-center lg:text-left">
            <CardTitle className="text-base font-semibold">
              Demo account login credentials
            </CardTitle>
            <CardDescription>
              Select a role to fill the login form.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-2">
            <DemoCredentialsList state={state} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function LoginFallback() {
  return (
    <Card className="shadow-lg">
      <CardContent className="flex flex-col items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
        <p className="text-muted-foreground">Loading...</p>
      </CardContent>
    </Card>
  );
}

export function LoginPageClient(props: LoginPageProps) {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginContent {...props} />
    </Suspense>
  );
}
