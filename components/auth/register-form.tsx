"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Lock, Mail, User } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { signInWithFacebook, signInWithGoogle, signUp } from "@/lib/auth/auth-client";
import { RegisterSchema, type RegisterInput } from "@/lib/validations/auth";
import { FacebookIcon, GoogleIcon } from "@/components/auth/oauth-icons";
import type { OAuthEnabled } from "@/components/auth/login-form";

/**
 * Sign-up, minus any chrome — the counterpart to `login-form.tsx`. Shared by
 * the /register page and the storefront's account drawer.
 */

interface UseRegisterFormOptions {
  locale: string;
  /**
   * Server-rendered: when the store requires email verification, a new account
   * has no session yet and must be sent to /verify-email instead.
   */
  emailVerificationRequired: boolean;
  /** Sanitized same-origin path to land on once the account is usable. */
  redirectTo?: string | null;
  /** Runs before each attempt, so a host can clear banners it owns. */
  onAttempt?: () => void;
  /** Runs once sign-up succeeds, just before the route change. */
  onSuccess?: () => void;
}

export function useRegisterForm({
  locale,
  emailVerificationRequired,
  redirectTo = null,
  onAttempt,
  onSuccess,
}: UseRegisterFormOptions) {
  const t = useTranslations();
  const router = useRouter();

  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isFacebookLoading, setIsFacebookLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<RegisterInput>({
    resolver: zodResolver(RegisterSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
    },
  });

  const onSubmit = async (data: RegisterInput) => {
    setIsLoading(true);
    setError(null);
    onAttempt?.();

    try {
      const result = await signUp.email({
        name: data.name,
        email: data.email,
        password: data.password,
        callbackURL: `/${locale}/email-verified`,
      });

      if (result.error) {
        setError(result.error.message || t("common.error"));
        return;
      }

      const signUpData = result.data as unknown as {
        token?: string | null;
        user?: { id?: string };
      };
      // Server-rendered flag, with the sign-up response as a cross-check —
      // better-auth returns a null token when it deferred the session until
      // the email is verified.
      const verificationRequired =
        emailVerificationRequired || signUpData?.token === null;

      onSuccess?.();
      router.push(
        verificationRequired
          ? `/${locale}/verify-email?email=${encodeURIComponent(data.email)}`
          : (redirectTo ?? `/${locale}/role-redirect`),
      );
    } catch {
      setError(t("common.error"));
    } finally {
      setIsLoading(false);
    }
  };

  const oauthCallbackUrl = () =>
    `/${locale}/role-redirect${
      redirectTo ? `?redirect=${encodeURIComponent(redirectTo)}` : ""
    }`;

  const handleGoogleSignIn = async () => {
    setIsGoogleLoading(true);
    setError(null);
    onAttempt?.();
    try {
      const callbackURL = oauthCallbackUrl();
      await signInWithGoogle({
        callbackURL,
        newUserCallbackURL: callbackURL,
        errorCallbackURL: `/${locale}/login`,
      });
      // OAuth redirects automatically
    } catch {
      setError("Failed to sign in with Google");
      setIsGoogleLoading(false);
    }
  };

  const handleFacebookSignIn = async () => {
    setIsFacebookLoading(true);
    setError(null);
    onAttempt?.();
    try {
      const callbackURL = oauthCallbackUrl();
      await signInWithFacebook({
        callbackURL,
        newUserCallbackURL: callbackURL,
        errorCallbackURL: `/${locale}/login`,
      });
      // OAuth redirects automatically
    } catch {
      setError("Failed to sign in with Facebook");
      setIsFacebookLoading(false);
    }
  };

  return {
    locale,
    redirectTo,
    form,
    error,
    setError,
    isLoading,
    isGoogleLoading,
    isFacebookLoading,
    /** Any auth request in flight — every trigger disables on this. */
    busy: isLoading || isGoogleLoading || isFacebookLoading,
    onSubmit,
    handleGoogleSignIn,
    handleFacebookSignIn,
  };
}

type RegisterFormState = ReturnType<typeof useRegisterForm>;

/** Renders nothing when the admin has no provider enabled. */
export function RegisterOAuthButtons({
  state,
  oauthEnabled,
  dividerClassName,
}: {
  state: RegisterFormState;
  oauthEnabled: OAuthEnabled;
  /** Background of the surface the divider label sits on. */
  dividerClassName?: string;
}) {
  const t = useTranslations();

  if (!oauthEnabled.google && !oauthEnabled.facebook) return null;

  return (
    <>
      {oauthEnabled.google && (
        <Button
          type="button"
          variant="outline"
          className="w-full gap-2"
          onClick={state.handleGoogleSignIn}
          disabled={state.busy}
        >
          {state.isGoogleLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <GoogleIcon className="h-4 w-4" />
          )}
          {t("auth.continueWithGoogle")}
        </Button>
      )}
      {oauthEnabled.facebook && (
        <Button
          type="button"
          variant="outline"
          className="w-full gap-2 mt-2"
          onClick={state.handleFacebookSignIn}
          disabled={state.busy}
        >
          {state.isFacebookLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FacebookIcon className="h-4 w-4" />
          )}
          {t("auth.continueWithFacebook")}
        </Button>
      )}
      <div className="relative my-4">
        <div className="absolute inset-0 flex items-center">
          <Separator />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span
            className={cn("px-2 text-muted-foreground", dividerClassName ?? "bg-card")}
          >
            {t("auth.orContinueWith")}
          </span>
        </div>
      </div>
    </>
  );
}

export function RegisterFields({ state }: { state: RegisterFormState }) {
  const t = useTranslations();
  const { form, isLoading } = state;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(state.onSubmit)} className="space-y-4">
        {state.error && (
          <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md">
            {state.error}
          </div>
        )}

        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("auth.fullName")}</FormLabel>
              <FormControl>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    {...field}
                    placeholder="John Doe"
                    className="pl-10"
                    disabled={isLoading}
                  />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("auth.email")}</FormLabel>
              <FormControl>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    {...field}
                    type="email"
                    placeholder="name@example.com"
                    className="pl-10"
                    disabled={isLoading}
                  />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("auth.password")}</FormLabel>
              <FormControl>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    {...field}
                    type="password"
                    placeholder="••••••••"
                    className="pl-10"
                    disabled={isLoading}
                  />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("common.loading")}
            </>
          ) : (
            t("auth.signUp")
          )}
        </Button>
      </form>
    </Form>
  );
}

/** Terms + privacy line. Legally part of the form, so both hosts show it. */
export function RegisterTermsNotice({ locale }: { locale: string }) {
  const t = useTranslations();

  return (
    <p className="text-center text-sm text-muted-foreground">
      {t("auth.termsAgreement")}{" "}
      <Link href={`/${locale}/terms`} className="text-primary hover:underline">
        {t("auth.termsOfService")}
      </Link>{" "}
      {t("auth.and")}{" "}
      <Link href={`/${locale}/privacy`} className="text-primary hover:underline">
        {t("auth.privacyPolicy")}
      </Link>
    </p>
  );
}
