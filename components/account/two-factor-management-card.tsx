"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Shield, Loader2, CheckCircle, XCircle } from "lucide-react";
import { authClient } from "@/lib/auth/auth-client";
import { TwoFactorEnrollment } from "@/components/account/two-factor-enrollment";
import { ClientSuspense } from "@/components/common/client-suspense";
import { useSuspenseResource } from "@/hooks/use-suspense-resource";
import {
  USER_PROFILE_URL,
  type UserProfilePayload,
} from "@/components/account/user-profile-resource";

interface TwoFactorManagementCardProps {
  disabled?: boolean;
  disabledMessage?: string;
}

/**
 * Self-service two-factor authentication management, usable from any account
 * area (customer security page, vendor settings, admin profile).
 *
 * 2FA is treated as a personal preference rather than a forced requirement:
 * - The card only appears when the store administrator has enabled 2FA for the
 *   user's role (`twoFactorAvailable`, derived from the master switch plus the
 *   per-role toggle). If 2FA is not offered and the user is not enrolled, the
 *   card renders nothing.
 * - A user who is already enrolled can always manage/disable it, even if the
 *   admin later turns the feature off.
 *
 * The state comes from /api/user/profile through `useSuspenseResource`: on the
 * customer Security page that is the copy the Profile page already holds, so
 * it costs no request, and the card's own Suspense boundary replaces the
 * spinner card it used to draw while loading.
 */
export function TwoFactorManagementCard(
  props: TwoFactorManagementCardProps = {},
) {
  return (
    <ClientSuspense fallback={<TwoFactorCardSkeleton />}>
      <TwoFactorManagementContent {...props} />
    </ClientSuspense>
  );
}

function TwoFactorCardSkeleton() {
  return (
    <Card aria-busy="true">
      <CardHeader>
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Skeleton className="h-10 w-40" />
      </CardContent>
    </Card>
  );
}

function TwoFactorManagementContent({
  disabled = false,
  disabledMessage,
}: TwoFactorManagementCardProps) {
  const t = useTranslations();

  // A failed read leaves both flags false, which hides the card: without the
  // state there is nothing it could offer safely.
  const { data: profile, mutate: mutateProfile } =
    useSuspenseResource<UserProfilePayload>(USER_PROFILE_URL);
  const is2FAEnabled = Boolean(profile?.user?.twoFactorEnabled);
  const available = Boolean(profile?.user?.twoFactorAvailable);
  // Written into the shared copy, so the Profile page and a later visit here
  // agree with what just happened.
  const setIs2FAEnabled = (enabled: boolean) =>
    mutateProfile((current) => ({
      ...current,
      user: current.user
        ? { ...current.user, twoFactorEnabled: enabled }
        : current.user,
    }));
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [isDisabling, setIsDisabling] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");
  const [showDisableConfirm, setShowDisableConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleDisable2FA = async () => {
    if (disabled) return;
    if (!disablePassword) return;

    setIsDisabling(true);
    setError(null);

    try {
      const res = await authClient.twoFactor.disable({
        password: disablePassword,
      });

      if (res.error) {
        setError(
          res.error.message ||
            t("account.disable2FAFailed"),
        );
        return;
      }

      setIs2FAEnabled(false);
      setShowDisableConfirm(false);
      setDisablePassword("");
      setSuccess(
        t("account.twoFactorDisabledSuccess"),
      );
    } catch {
      setError(
        t("account.genericTryAgain"),
      );
    } finally {
      setIsDisabling(false);
    }
  };

  // Personal preference: only surface 2FA when the admin has enabled it for this
  // role. Users already enrolled keep access so they can manage/disable it.
  if (!available && !is2FAEnabled) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">
                {t("account.twoFactorAuth")}
              </CardTitle>
              <CardDescription>
                {t("account.twoFactorDescription")}
              </CardDescription>
            </div>
          </div>
          <Badge variant={is2FAEnabled ? "default" : "secondary"}>
            {is2FAEnabled
              ? t("common.enabled")
              : t("common.disabled")}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {success && (
          <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg flex items-center gap-3">
            <CheckCircle className="h-5 w-5 text-green-500" />
            <span className="text-green-700 dark:text-green-400">{success}</span>
          </div>
        )}
        {error && (
          <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-3">
            <XCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">{error}</span>
          </div>
        )}

        {is2FAEnabled && !isEnrolling ? (
          <>
            <p className="text-sm text-muted-foreground">
              {t("account.twoFactorEnabledInfo")}
            </p>

            {showDisableConfirm ? (
              <div className="space-y-4 max-w-sm">
                <p className="text-sm font-medium text-destructive">
                  {t("account.confirmDisable2FA")}
                </p>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    value={disablePassword}
                    onChange={(e) => setDisablePassword(e.target.value)}
                    placeholder={t("auth.password")}
                    disabled={disabled || isDisabling}
                  />
                  <Button
                    variant="destructive"
                    onClick={handleDisable2FA}
                    disabled={disabled || !disablePassword || isDisabling}
                  >
                    {isDisabling ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      t("common.confirm")
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowDisableConfirm(false);
                      setDisablePassword("");
                    }}
                    disabled={isDisabling}
                  >
                    {t("common.cancel")}
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="destructive"
                onClick={() => setShowDisableConfirm(true)}
                disabled={disabled}
              >
                {t("account.disable2FA")}
              </Button>
            )}
          </>
        ) : (
          <TwoFactorEnrollment
            disabled={disabled}
            description={t("account.twoFactorDisabledInfo")}
            onEnabled={() => {
              setIs2FAEnabled(true);
              setIsEnrolling(true);
              setSuccess(
                t("account.twoFactorEnabledSuccess"),
              );
            }}
            onDone={() => setIsEnrolling(false)}
          />
        )}
        {disabled && disabledMessage && (
          <p className="text-xs text-muted-foreground">{disabledMessage}</p>
        )}
      </CardContent>
    </Card>
  );
}
