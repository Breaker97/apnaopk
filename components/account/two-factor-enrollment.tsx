"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Smartphone, Loader2, Copy, XCircle } from "lucide-react";
import { authClient } from "@/lib/auth/auth-client";

interface TwoFactorSetupData {
  totpURI: string;
  secret: string;
  qrCodeDataUrl: string;
  backupCodes: string[];
}

type Step = "idle" | "setup" | "backup";

/**
 * Self-contained 2FA enrollment flow: password → QR/secret → TOTP verify →
 * backup codes. Rendered by `TwoFactorManagementCard` on the account security
 * pages — enrollment is always a self-service choice, never forced.
 */
export function TwoFactorEnrollment(props: {
  /** Shown above the password field on the first step only. */
  description?: string;
  disabled?: boolean;
  /** Called immediately after the TOTP code is verified (2FA is now active). */
  onEnabled?: () => void;
  /** Called when the user dismisses the backup codes. */
  onDone?: () => void;
  /** Label for the final dismiss button (defaults to "Done"). */
  doneLabel?: string;
}) {
  const t = useTranslations();
  const [step, setStep] = useState<Step>("idle");
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [setupData, setSetupData] = useState<TwoFactorSetupData | null>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [enablePassword, setEnablePassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSetup2FA = async () => {
    if (props.disabled) return;
    setIsSettingUp(true);
    setError(null);

    try {
      if (!enablePassword) {
        setError(
          t("account.passwordRequired"),
        );
        return;
      }

      const response = await authClient.twoFactor.enable({
        password: enablePassword,
      });

      if (response.error) {
        setError(
          response.error.message ||
            t("account.setup2FAFailed"),
        );
        return;
      }

      const responseData = response.data as unknown as {
        totpURI?: string;
        backupCodes?: string[];
      };

      const totpURI = responseData.totpURI || "";
      if (!totpURI) {
        setError(
          t("account.setup2FAFailed"),
        );
        return;
      }

      const secretMatch = /[?&]secret=([^&]+)/.exec(totpURI);
      const secret = secretMatch ? decodeURIComponent(secretMatch[1]) : "";
      const qrCodeDataUrl = await QRCode.toDataURL(totpURI);

      setSetupData({
        totpURI,
        secret,
        qrCodeDataUrl,
        backupCodes: responseData.backupCodes || [],
      });
      setStep("setup");
    } catch {
      setError(
        t("account.genericTryAgain"),
      );
    } finally {
      setIsSettingUp(false);
    }
  };

  const handleVerify2FA = async () => {
    if (props.disabled) return;
    if (verificationCode.length !== 6) return;

    setIsSettingUp(true);
    setError(null);

    try {
      const res = await authClient.twoFactor.verifyTotp({
        code: verificationCode,
        trustDevice: true,
      });

      if (res.error) {
        setError(
          res.error.message ||
            t("account.invalidVerificationCode"),
        );
        return;
      }

      props.onEnabled?.();
      setStep("backup");
    } catch {
      setError(
        t("account.genericTryAgain"),
      );
    } finally {
      setIsSettingUp(false);
      setVerificationCode("");
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-3">
          <XCircle className="h-5 w-5 text-destructive" />
          <span className="text-destructive">{error}</span>
        </div>
      )}

      {step === "idle" && (
        <div className="space-y-3 max-w-sm">
          {props.description && (
            <p className="text-sm text-muted-foreground">{props.description}</p>
          )}
          <Input
            type="password"
            value={enablePassword}
            onChange={(e) => setEnablePassword(e.target.value)}
            placeholder={t("auth.password")}
            disabled={props.disabled || isSettingUp}
          />
          <Button onClick={handleSetup2FA} disabled={props.disabled || isSettingUp}>
            {isSettingUp ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("common.loading")}
              </>
            ) : (
              <>
                <Smartphone className="mr-2 h-4 w-4" />
                {t("account.setup2FA")}
              </>
            )}
          </Button>
        </div>
      )}

      {step === "setup" && setupData && (
        <div className="space-y-6">
          <Separator />

          <div className="space-y-4">
            <h3 className="font-semibold">
              {t("account.step1")}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t("account.scanQRDescription")}
            </p>

            <div className="flex justify-center rounded-lg border bg-card p-4">
              {/* eslint-disable-next-line @next/next/no-img-element -- data: URL QR code, nothing for the optimizer to fetch */}
              <img
                src={setupData.qrCodeDataUrl}
                alt={t("account.qrCodeAlt")}
                className="h-48 w-48 rounded bg-white p-2"
              />
            </div>

            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {t("account.cantScanQR")}
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 p-2 bg-muted rounded text-sm font-mono break-all">
                  {setupData.secret}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard(setupData.secret)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <h3 className="font-semibold">
              {t("account.step2")}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t("account.enterCodeDescription")}
            </p>

            <div className="flex gap-2">
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={verificationCode}
                onChange={(e) =>
                  setVerificationCode(e.target.value.replace(/\D/g, ""))
                }
                placeholder="000000"
                className="text-center text-xl tracking-widest font-mono max-w-40"
                disabled={props.disabled || isSettingUp}
              />
              <Button
                onClick={handleVerify2FA}
                disabled={
                  props.disabled || verificationCode.length !== 6 || isSettingUp
                }
              >
                {isSettingUp ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  t("auth.verify")
                )}
              </Button>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setStep("idle");
                setSetupData(null);
                setVerificationCode("");
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}

      {step === "backup" && setupData?.backupCodes && (
        <div className="space-y-4">
          <Separator />

          <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
            <h3 className="font-semibold text-yellow-700 dark:text-yellow-400 mb-2">
              {t("account.backupCodes")}
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              {t("account.backupCodesDescription")}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {setupData.backupCodes.map((code, index) => (
                <code
                  key={index}
                  className="p-2 bg-muted rounded text-center font-mono text-sm"
                >
                  {code}
                </code>
              ))}
            </div>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => copyToClipboard(setupData.backupCodes.join("\n"))}
            >
              <Copy className="mr-2 h-4 w-4" />
              {t("account.copyBackupCodes")}
            </Button>
          </div>

          <Button onClick={() => props.onDone?.()}>
            {props.doneLabel ?? t("common.done")}
          </Button>
        </div>
      )}
    </div>
  );
}
