"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react";

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
import {
  authClient,
  getSession,
  signIn,
  signInWithFacebook,
  signInWithGoogle,
} from "@/lib/auth/auth-client";
import { LoginSchema, type LoginInput } from "@/lib/validations/auth";
import {
  describeAuthError,
  type AuthErrorPayload,
  type Translate,
} from "@/lib/auth/auth-error-message";
import { FacebookIcon, GoogleIcon } from "@/components/auth/oauth-icons";
import {
  DEMO_ACCOUNTS,
  DEMO_LOGIN_ORDER,
  DEMO_ROLE_LABELS,
} from "@/config/demo-credentials";

/**
 * Sign-in, minus any chrome. The /login page wraps these in its card layout and
 * the storefront's account drawer wraps them in a sheet, so the flow — email,
 * OAuth, 2FA, demo quick-login, and the role-aware landing afterwards — is
 * written once here rather than twice.
 */

export interface OAuthEnabled {
  google: boolean;
  facebook: boolean;
}

/**
 * Shown only when the deployment runs with DEMO_MODE enabled — these are the
 * accounts `pnpm db:seed` and `pnpm db:seed:users` create, so on a real store
 * the card would be handing every visitor a working admin login.
 *
 * Derived from `config/demo-credentials.ts` rather than written out here: the
 * copy that used to live in this file drifted from the seeders, and the card
 * offered a quick login for an account that did not exist.
 */
export const demoCredentials = DEMO_LOGIN_ORDER.map((role) => ({
  role,
  label: DEMO_ROLE_LABELS[role],
  email: DEMO_ACCOUNTS[role].email,
  password: DEMO_ACCOUNTS[role].password,
}));

type DemoCredential = (typeof demoCredentials)[number];

interface UseLoginFormOptions {
  locale: string;
  /**
   * Sanitized same-origin path to return to once signed in. Null — the default
   * — hands the user to their own role's landing page instead, which is what
   * the account drawer wants: the shopper asked for "my account", not for a
   * particular page.
   */
  redirectTo?: string | null;
  /** Runs before each attempt, so a host can clear banners it owns. */
  onAttempt?: () => void;
  /** Runs once auth succeeds, just before the route change. */
  onSuccess?: () => void;
}

export function useLoginForm({
  locale,
  redirectTo = null,
  onAttempt,
  onSuccess,
}: UseLoginFormOptions) {
  const t = useTranslations();
  const router = useRouter();

  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isFacebookLoading, setIsFacebookLoading] = useState(false);
  const [activeDemoRole, setActiveDemoRole] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 2FA state
  const [requires2FA, setRequires2FA] = useState(false);
  const [is2FALoading, setIs2FALoading] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  // Trusting the device skips the second factor here for 30 days, so it is the
  // user's call — on a shared or public machine it must stay off.
  const [trustDevice, setTrustDevice] = useState(false);

  const resolveRoleAfterLogin = async (userRole?: string) => {
    if (userRole) return userRole;

    const sessionResult = await getSession();
    const sessionUser = sessionResult.data?.user as
      | { role?: string; roles?: string[] }
      | undefined;

    if (sessionUser?.role) return sessionUser.role;
    if (sessionUser?.roles?.includes("admin")) return "admin";
    if (sessionUser?.roles?.includes("vendor")) return "vendor";
    if (sessionUser?.roles?.includes("staff")) return "staff";
    if (sessionUser?.roles?.includes("seller")) return "seller";

    return undefined;
  };

  const redirectAfterLogin = async (userRole?: string) => {
    // A deep return target (checkout, wishlist, inbox) wins over the role
    // dashboards. Home callbacks never reach here — sanitizeReturnPath drops
    // them so every role lands on its dashboard when there's nothing to
    // return to.
    if (redirectTo) {
      onSuccess?.();
      router.push(redirectTo);
      router.refresh();
      return;
    }

    const resolvedRole = await resolveRoleAfterLogin(userRole);

    // Default role-based redirects
    let redirectPath = `/${locale}/account`;
    if (resolvedRole === "admin") {
      redirectPath = `/${locale}/admin/dashboard`;
    } else if (resolvedRole === "vendor") {
      redirectPath = `/${locale}/vendor/dashboard`;
    } else if (resolvedRole === "staff" || resolvedRole === "seller") {
      redirectPath = `/${locale}/staff/dashboard`;
    }
    onSuccess?.();
    router.push(redirectPath);
    router.refresh();
  };

  const form = useForm<LoginInput>({
    resolver: zodResolver(LoginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const onSubmit = async (data: LoginInput) => {
    setIsLoading(true);
    setError(null);
    onAttempt?.();

    try {
      const result = await signIn.email({
        email: data.email,
        password: data.password,
      });

      if (result.error) {
        if (result.error.code === "EMAIL_NOT_VERIFIED") {
          onSuccess?.();
          router.push(
            `/${locale}/verify-email?email=${encodeURIComponent(data.email)}`,
          );
          return;
        }
        // The server sends the facts; the sentence is built here so it lands in
        // the visitor's own language.
        setError(
          describeAuthError(
            result.error as unknown as AuthErrorPayload,
            t as unknown as Translate,
          ),
        );
        return;
      }

      const signInData = result.data as unknown as {
        user?: { id?: string; email?: string; role?: string };
        twoFactorRedirect?: boolean;
      };
      if (signInData?.twoFactorRedirect) {
        setRequires2FA(true);
        return;
      }

      await redirectAfterLogin(signInData?.user?.role);
    } catch {
      setError(t("common.error"));
    } finally {
      setIsLoading(false);
    }
  };

  const quickLogin = async (credential: DemoCredential) => {
    setActiveDemoRole(credential.role);
    form.setValue("email", credential.email, { shouldDirty: true });
    form.setValue("password", credential.password, { shouldDirty: true });

    try {
      await onSubmit({
        email: credential.email,
        password: credential.password,
      });
    } finally {
      setActiveDemoRole(null);
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

  const handle2FAVerify = async () => {
    if (twoFactorCode.length !== 6) return;

    setIs2FALoading(true);
    setError(null);

    try {
      const verifyResult = await authClient.twoFactor.verifyTotp({
        code: twoFactorCode,
        trustDevice,
      });
      if (verifyResult.error) {
        setError(verifyResult.error.message || "Invalid 2FA code");
        return;
      }

      const session = await getSession();
      const userRole = (
        session.data?.user as { role?: string } | undefined
      )?.role;
      await redirectAfterLogin(userRole);
    } catch {
      setError("An error occurred. Please try again.");
    } finally {
      setIs2FALoading(false);
    }
  };

  const cancel2FA = () => {
    setRequires2FA(false);
    setTwoFactorCode("");
    setError(null);
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
    showPassword,
    setShowPassword,
    activeDemoRole,
    requires2FA,
    is2FALoading,
    twoFactorCode,
    setTwoFactorCode,
    trustDevice,
    setTrustDevice,
    onSubmit,
    quickLogin,
    handleGoogleSignIn,
    handleFacebookSignIn,
    handle2FAVerify,
    cancel2FA,
  };
}

type LoginFormState = ReturnType<typeof useLoginForm>;

/**
 * OAuth row plus its "or continue with" rule. Renders nothing when the admin
 * has no provider enabled, so hosts can drop it in unconditionally.
 */
export function LoginOAuthButtons({
  state,
  oauthEnabled,
  dividerClassName,
}: {
  state: LoginFormState;
  oauthEnabled: OAuthEnabled;
  /** Background of the surface the divider label sits on. */
  dividerClassName?: string;
}) {
  const t = useTranslations();

  if (!oauthEnabled.google && !oauthEnabled.facebook) return null;

  return (
    <>
      <div className="space-y-2">
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
            className="w-full gap-2"
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
      </div>
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

/**
 * Email + password + submit. `error` is passed in rather than read off the
 * state because /login also surfaces OAuth failures handed back in the query
 * string, and both belong in the same banner.
 */
export function LoginFields({
  state,
  error,
}: {
  state: LoginFormState;
  error?: string | null;
}) {
  const t = useTranslations();
  const { form, isLoading } = state;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(state.onSubmit)} className="space-y-4">
        {error && (
          <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md">
            {error}
          </div>
        )}

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("auth.email")}</FormLabel>
              <FormControl>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  {/* `type="text"`, not `type="email"`: browsers refuse the
                      selection API on email inputs (selectionStart is null,
                      setSelectionRange throws), so React cannot restore the
                      caret after a re-render and any edit in the middle of the
                      address snaps back to the end. inputMode keeps the email
                      keyboard on mobile and LoginSchema still validates the
                      address. */}
                  <Input
                    {...field}
                    type="text"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
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
                    type={state.showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="pl-10 pr-10"
                    disabled={isLoading}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full hover:bg-transparent"
                    aria-label={
                      state.showPassword
                        ? t("auth.hidePassword")
                        : t("auth.showPassword")
                    }
                    aria-pressed={state.showPassword}
                    disabled={isLoading}
                    onClick={() => state.setShowPassword(!state.showPassword)}
                  >
                    {state.showPassword ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex items-center justify-end">
          <Link
            href={`/${state.locale}/forgot-password`}
            className="text-sm text-primary hover:underline"
          >
            {t("auth.forgotPassword")}
          </Link>
        </div>

        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("common.loading")}
            </>
          ) : (
            t("auth.signIn")
          )}
        </Button>
      </form>
    </Form>
  );
}

/** The code entry that replaces the form once a 2FA-enrolled account signs in. */
export function TwoFactorFields({
  state,
  error,
}: {
  state: LoginFormState;
  error?: string | null;
}) {
  const t = useTranslations();

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md">
          {error}
        </div>
      )}
      <Input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={6}
        value={state.twoFactorCode}
        onChange={(e) => state.setTwoFactorCode(e.target.value.replace(/\D/g, ""))}
        placeholder="000000"
        className="text-center text-2xl tracking-widest font-mono"
        disabled={state.is2FALoading}
      />
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          className="size-4 rounded border-input accent-primary"
          checked={state.trustDevice}
          onChange={(event) => state.setTrustDevice(event.target.checked)}
          disabled={state.is2FALoading}
        />
        {t("auth.trustThisDevice")}
      </label>
      <Button
        className="w-full"
        onClick={state.handle2FAVerify}
        disabled={state.is2FALoading || state.twoFactorCode.length !== 6}
      >
        {state.is2FALoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t("common.loading")}
          </>
        ) : (
          t("auth.verify")
        )}
      </Button>
    </div>
  );
}

/**
 * The demo account rows. Chrome-free — /login frames them in a card beside the
 * form, the account drawer stacks them under it.
 */
export function DemoCredentialsList({ state }: { state: LoginFormState }) {
  return (
    <div className="grid gap-2">
      {demoCredentials.map((item) => {
        const isActive = state.activeDemoRole === item.role;
        return (
          <div
            key={`${item.role}-${item.email}`}
            className="rounded-md border border-border/70 bg-card/60 p-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">{item.label}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 whitespace-nowrap text-xs"
                disabled={state.busy}
                onClick={() => state.quickLogin(item)}
              >
                {isActive ? (
                  <>
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    Logging in
                  </>
                ) : (
                  "Fill & quick login"
                )}
              </Button>
            </div>
            <div className="grid text-xs">
              <div className="grid grid-cols-[4.75rem_minmax(0,1fr)] items-start gap-2">
                <span className="pt-1 text-muted-foreground">Email</span>
                <span className="min-w-0 break-all rounded-md border border-border/60 bg-muted/50 px-2 py-1 font-mono leading-relaxed text-foreground">
                  {item.email}
                </span>
              </div>
              <div className="grid grid-cols-[4.75rem_minmax(0,1fr)] items-start gap-2">
                <span className="pt-1 text-muted-foreground">Password</span>
                <span className="min-w-0 break-all rounded-md border border-border/60 bg-muted/50 px-2 py-1 font-mono leading-relaxed text-foreground">
                  {item.password}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
