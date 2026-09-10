"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { sanitizeReturnPath } from "@/lib/auth/return-path";
import { useMultiVendorMode } from "@/providers/app-settings-provider";
import type { OAuthEnabled } from "@/components/auth/login-form";
import {
  RegisterFields,
  RegisterOAuthButtons,
  RegisterTermsNotice,
  useRegisterForm,
} from "@/components/auth/register-form";

interface RegisterPageProps {
  /** Resolved on the server so the buttons render in the initial HTML. */
  oauthEnabled: OAuthEnabled;
  emailVerificationRequired: boolean;
}

function RegisterContent({
  oauthEnabled,
  emailVerificationRequired,
}: RegisterPageProps) {
  const t = useTranslations();
  const params = useParams();
  const locale = params.locale as string;
  const searchParams = useSearchParams();
  // Return-to target handed over from the login page (or a guarded page), so
  // a guest who registers instead of signing in still lands where they meant
  // to go. Same-origin paths only.
  const redirectParam = sanitizeReturnPath(
    searchParams.get("redirect") || searchParams.get("callbackUrl"),
  );
  const { isMultiVendor } = useMultiVendorMode();

  const state = useRegisterForm({
    locale,
    emailVerificationRequired,
    redirectTo: redirectParam,
  });

  return (
    <Card className="shadow-lg">
      <CardHeader className="space-y-1 text-center">
        <CardTitle className="text-2xl font-bold">
          {t("auth.createAccount")}
        </CardTitle>
        <CardDescription>{t("auth.createAccountDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <RegisterOAuthButtons state={state} oauthEnabled={oauthEnabled} />
        <RegisterFields state={state} />
      </CardContent>
      <CardFooter className="flex flex-col gap-4">
        <RegisterTermsNotice locale={locale} />

        {/* Want to sell? Link - now uses dynamic setting */}
        {isMultiVendor && (
          <div className="flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-primary/5 border border-primary/10">
            <Store className="h-4 w-4 text-primary" />
            <span className="text-sm text-muted-foreground">
              {t("auth.wantToSell")}{" "}
              <Link
                href={`/${locale}/become-vendor`}
                className="text-primary font-medium hover:underline"
              >
                {t("auth.becomeVendor")}
              </Link>
            </span>
          </div>
        )}

        <div className="relative w-full">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">
              {t("auth.hasAccount")}
            </span>
          </div>
        </div>
        <Button variant="outline" className="w-full" asChild>
          <Link
            href={`/${locale}/login${
              redirectParam
                ? `?redirect=${encodeURIComponent(redirectParam)}`
                : ""
            }`}
          >
            {t("auth.signIn")}
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

function RegisterFallback() {
  return (
    <Card className="shadow-lg">
      <CardContent className="flex flex-col items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
        <p className="text-muted-foreground">Loading...</p>
      </CardContent>
    </Card>
  );
}

export function RegisterPageClient(props: RegisterPageProps) {
  return (
    <Suspense fallback={<RegisterFallback />}>
      <RegisterContent {...props} />
    </Suspense>
  );
}
