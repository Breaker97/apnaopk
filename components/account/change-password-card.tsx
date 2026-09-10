"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Eye, EyeOff, Loader2, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/toast-notification";
import {
  DEFAULT_PROFILE_DEMO_MODE,
  normalizeDemoModeState,
} from "@/lib/demo-mode-shared";

interface PasswordFormData {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export function ChangePasswordCard() {
  const t = useTranslations();
  const translateWithFallback = (key: string, fallbackKey: string) =>
    typeof t.has !== "function" || t.has(key) ? t(key) : t(fallbackKey);
  const changePasswordLabel = translateWithFallback(
    "profile.changePassword",
    "account.security",
  );
  const oldPasswordLabel = translateWithFallback(
    "profile.oldPassword",
    "auth.password",
  );
  const newPasswordLabel = translateWithFallback(
    "profile.newPassword",
    "auth.password",
  );
  const confirmPasswordLabel = translateWithFallback(
    "profile.confirmPassword",
    "auth.confirmPassword",
  );
  const updatePasswordLabel = translateWithFallback(
    "profile.updatePassword",
    "common.save",
  );
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isLoadingDemoMode, setIsLoadingDemoMode] = useState(true);
  const [showOldPassword, setShowOldPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [demoMode, setDemoMode] = useState(DEFAULT_PROFILE_DEMO_MODE);
  const isDemoMode = demoMode.enabled;

  const passwordForm = useForm<PasswordFormData>({
    defaultValues: {
      oldPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  useEffect(() => {
    let active = true;

    async function loadDemoMode() {
      try {
        const res = await fetch("/api/user/profile");
        const json = await res.json();

        if (active && res.ok && json?.success) {
          setDemoMode(normalizeDemoModeState(json?.data?.demoMode));
        }
      } catch {
        // Keep the existing non-demo fallback if profile state cannot load.
      } finally {
        if (active) setIsLoadingDemoMode(false);
      }
    }

    loadDemoMode();

    return () => {
      active = false;
    };
  }, []);

  const onPasswordSubmit = async (data: PasswordFormData) => {
    if (isDemoMode) {
      toast.error(demoMode.message);
      return;
    }

    setIsChangingPassword(true);
    try {
      const currentPassword = data.oldPassword.trim();
      const res = await fetch("/api/user/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword:
            currentPassword.length > 0 ? currentPassword : undefined,
          newPassword: data.newPassword,
        }),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        const errors = json?.errors as Record<string, string[]> | undefined;
        if (errors?.currentPassword?.[0]) {
          passwordForm.setError("oldPassword", {
            type: "server",
            message: errors.currentPassword[0],
          });
        }
        if (errors?.newPassword?.[0]) {
          passwordForm.setError("newPassword", {
            type: "server",
            message: errors.newPassword[0],
          });
        }
        throw new Error(
          json?.error || json?.message || t("account.genericTryAgain"),
        );
      }

      toast.success(json?.message || t("common.saved"));
      passwordForm.reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.error"));
    } finally {
      setIsChangingPassword(false);
    }
  };

  const passwordToggleLabel = (fieldLabel: string) =>
    `${changePasswordLabel}: ${fieldLabel}`;
  const validationMessage = (key: string) =>
    translateWithFallback(key, "common.error");

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle>
          <h2 className="text-lg">{changePasswordLabel}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isDemoMode && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-100">
            <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="min-w-0 text-sm leading-5 text-amber-800 dark:text-amber-200">
              {demoMode.message}
            </p>
          </div>
        )}

        <Form {...passwordForm}>
          <form
            onSubmit={passwordForm.handleSubmit(onPasswordSubmit)}
            className="space-y-6"
          >
            <fieldset
              disabled={
                isLoadingDemoMode || isDemoMode || isChangingPassword
              }
              className="space-y-6"
            >
              <FormField
                control={passwordForm.control}
                name="oldPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-medium">
                      {oldPasswordLabel}
                    </FormLabel>
                    <div className="relative">
                      <FormControl>
                        <Input
                          {...field}
                          type={showOldPassword ? "text" : "password"}
                          autoComplete="current-password"
                          className="h-11 bg-background/50 pr-11 transition-colors focus:bg-background"
                        />
                      </FormControl>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0 h-11 min-h-11 w-11 min-w-11 hover:bg-transparent"
                        aria-label={passwordToggleLabel(oldPasswordLabel)}
                        aria-pressed={showOldPassword}
                        onClick={() => setShowOldPassword((shown) => !shown)}
                      >
                        {showOldPassword ? (
                          <EyeOff className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Eye className="h-4 w-4 text-muted-foreground" />
                        )}
                      </Button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={passwordForm.control}
                name="newPassword"
                rules={{
                  required: translateWithFallback(
                    "account.passwordRequired",
                    "common.error",
                  ),
                  minLength: {
                    value: 8,
                    message: validationMessage(
                      "vendor.settingsForm.passwordMinLength",
                    ),
                  },
                }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-medium">
                      {newPasswordLabel}
                    </FormLabel>
                    <div className="relative">
                      <FormControl>
                        <Input
                          {...field}
                          type={showNewPassword ? "text" : "password"}
                          autoComplete="new-password"
                          className="h-11 bg-background/50 pr-11 transition-colors focus:bg-background"
                        />
                      </FormControl>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0 h-11 min-h-11 w-11 min-w-11 hover:bg-transparent"
                        aria-label={passwordToggleLabel(newPasswordLabel)}
                        aria-pressed={showNewPassword}
                        onClick={() => setShowNewPassword((shown) => !shown)}
                      >
                        {showNewPassword ? (
                          <EyeOff className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Eye className="h-4 w-4 text-muted-foreground" />
                        )}
                      </Button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={passwordForm.control}
                name="confirmPassword"
                rules={{
                  required: translateWithFallback(
                    "account.passwordRequired",
                    "common.error",
                  ),
                  validate: (value) =>
                    value === passwordForm.getValues("newPassword") ||
                    validationMessage(
                      "vendor.settingsForm.passwordsDoNotMatch",
                    ),
                }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-medium">
                      {confirmPasswordLabel}
                    </FormLabel>
                    <div className="relative">
                      <FormControl>
                        <Input
                          {...field}
                          type={showConfirmPassword ? "text" : "password"}
                          autoComplete="new-password"
                          className="h-11 bg-background/50 pr-11 transition-colors focus:bg-background"
                        />
                      </FormControl>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0 h-11 min-h-11 w-11 min-w-11 hover:bg-transparent"
                        aria-label={passwordToggleLabel(confirmPasswordLabel)}
                        aria-pressed={showConfirmPassword}
                        onClick={() =>
                          setShowConfirmPassword((shown) => !shown)
                        }
                      >
                        {showConfirmPassword ? (
                          <EyeOff className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Eye className="h-4 w-4 text-muted-foreground" />
                        )}
                      </Button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                disabled={
                  isLoadingDemoMode || isDemoMode || isChangingPassword
                }
                className="h-11 w-full sm:w-auto"
              >
                {isChangingPassword && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {updatePasswordLabel}
              </Button>
            </fieldset>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
