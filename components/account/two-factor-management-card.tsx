"use client";

import { useState, useEffect } from "react";
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
import { Shield, Loader2, CheckCircle, XCircle } from "lucide-react";
import { authClient } from "@/lib/auth/auth-client";
import { TwoFactorEnrollment } from "@/components/account/two-factor-enrollment";

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
 */
export function TwoFactorManagementCard({
  disabled = false,
  disabledMessage,
}: {
  disabled?: boolean;
  disabledMessage?: string;
} = {}) {
  const t = useTranslations();

  const [is2FAEnabled, setIs2FAEnabled] = useState(false);
  const [available, setAvailable] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [isDisabling, setIsDisabling] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");
  const [showDisableConfirm, setShowDisableConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Load per-user enrollment state and whether 2FA is offered to this role.
  useEffect(() => {
    async function load() {
      try {
        const profileRes = await fetch("/api/user/profile");
        if (profileRes.ok) {
          const data = await profileRes.json();
          const user = data.data?.user || data.user;
          setIs2FAEnabled(Boolean(user?.twoFactorEnabled));
          setAvailable(Boolean(user?.twoFactorAvailable));
        }
      } catch {
        // Silently fail — the card stays hidden if we cannot determine state.
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, []);

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

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

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
