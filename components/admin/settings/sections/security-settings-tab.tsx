"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast-notification";
import { apiClient } from "@/lib/api/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import type { Settings } from "@/components/admin/settings/types";
// The same limits the settings API enforces and each consumer clamps to. Typed
// in by hand, this screen offered a seven-day lockout the storage cut to one and
// a six-character password minimum the policy raised to eight.
import {
  DEFAULT_LOCKOUT_MINUTES,
  DEFAULT_MAX_LOGIN_ATTEMPTS,
  DEFAULT_SESSION_MAX_AGE_DAYS,
  MAX_LOCKOUT_MINUTES,
  MAX_LOGIN_ATTEMPTS,
  MAX_SESSION_MAX_AGE_DAYS,
  MIN_LOCKOUT_MINUTES,
  MIN_LOGIN_ATTEMPTS,
  MIN_SESSION_MAX_AGE_DAYS,
} from "@/lib/security-limits";
import {
  MAX_ALLOWED_PASSWORD_LENGTH,
  MIN_ALLOWED_PASSWORD_LENGTH,
} from "@/lib/auth/password-policy";
import { SettingsTabHeader } from "./settings-tab-header";
import { StickySaveFooter } from "./sticky-save-footer";
import { useTranslations } from "next-intl";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

/**
 * Lift a failed-sign-in lock.
 *
 * The lock expires on its own, but it is keyed per host — so a merchant who
 * mistyped their password at the till cannot escape it by switching browser,
 * and "wait fifteen minutes" is the whole of the support answer without this.
 * Deliberately not part of the section's save: it acts immediately and has
 * nothing to do with the settings draft.
 */
function UnlockAccountRow({
  tSafe,
}: {
  tSafe: (key: string, fallback: string) => string;
}) {
  const [email, setEmail] = useState("");
  const [isUnlocking, setIsUnlocking] = useState(false);

  const unlock = async () => {
    const address = email.trim();
    if (!address) return;
    try {
      setIsUnlocking(true);
      const result = await apiClient.request<{ cleared: number }>(
        "POST",
        "/api/admin/security/unlock",
        { email: address },
      );
      toast.success(result.message || "Account unlocked");
      setEmail("");
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Could not unlock that account",
      );
    } finally {
      setIsUnlocking(false);
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="unlock-email">
        {tSafe("admin.settings.security.unlock.label", "Unlock an account")}
      </Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="unlock-email"
          type="text"
          value={email}
          placeholder="owner@example.com"
          autoComplete="off"
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void unlock();
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => void unlock()}
          disabled={isUnlocking || !email.trim()}
          className="sm:w-40"
        >
          {isUnlocking
            ? tSafe("common.loading", "Working…")
            : tSafe("admin.settings.security.unlock.action", "Unlock")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {tSafe(
          "admin.settings.security.unlock.hint",
          "Clears the failed sign-in count for this address on every device it was locked from. Takes effect immediately — no save needed.",
        )}
      </p>
    </div>
  );
}

export function SecuritySettingsTab(props: {
  settings: Settings;
  isSaving: boolean;
  isDirty: boolean;
  updateField: (path: string, value: unknown) => void;
  onSave: () => void | Promise<unknown>;
}) {
  const t = useTranslations();
  const security = props.settings.security;

  const tSafe = useFallbackTranslator(t);

  const rateLimiting = security.rateLimiting ?? {
    enabled: true,
    ipPreset: "default",
    adminPreset: "default",
    vendorPreset: "default",
    checkoutPreset: "default",
    cartPreset: "default",
    couponPreset: "default",
    authPreset: "default",
  };

  const presetOptions: Array<{ value: string; label: string }> = [
    { value: "default", label: "Default" },
    { value: "lenient", label: "Lenient (100/15m)" },
    { value: "moderate", label: "Moderate (20/15m)" },
    { value: "strict", label: "Strict (5/15m)" },
  ];

  return (
    <div className="space-y-4">
      <SettingsTabHeader
        title={tSafe("admin.settings.security.title", "Security & Access Control")}
        description={tSafe(
          "admin.settings.security.description",
          "Configure session security and password policies",
        )}
      />
      <Card>
        <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>
              {tSafe("admin.settings.security.session.duration", "Session Duration (days)")}
            </Label>
            <NumberInput
              min={MIN_SESSION_MAX_AGE_DAYS}
              max={MAX_SESSION_MAX_AGE_DAYS}
              step={1}
              value={security.sessionMaxAgeDays ?? DEFAULT_SESSION_MAX_AGE_DAYS}
              whenEmpty="keep"
              normalize={Math.trunc}
              onValueChange={(next) => {
                if (next !== undefined) props.updateField("security.sessionMaxAgeDays", next);
              }}
            />
          </div>
          <div className="space-y-2">
            <Label>
              {tSafe("admin.settings.security.session.maxAttempts", "Max Login Attempts")}
            </Label>
            {/* 0 is reachable on purpose — it switches the lockout off, and
                this screen has no other toggle for it. */}
            <NumberInput
              min={MIN_LOGIN_ATTEMPTS}
              max={MAX_LOGIN_ATTEMPTS}
              step={1}
              value={security.maxLoginAttempts ?? DEFAULT_MAX_LOGIN_ATTEMPTS}
              whenEmpty="keep"
              normalize={Math.trunc}
              onValueChange={(next) => {
                if (next !== undefined) props.updateField("security.maxLoginAttempts", next);
              }}
            />
          </div>
          <div className="space-y-2">
            <Label>
              {tSafe("admin.settings.security.session.lockout", "Lockout Duration (min)")}
            </Label>
            <NumberInput
              min={MIN_LOCKOUT_MINUTES}
              max={MAX_LOCKOUT_MINUTES}
              step={1}
              value={security.lockoutDurationMinutes ?? DEFAULT_LOCKOUT_MINUTES}
              whenEmpty="keep"
              normalize={Math.trunc}
              onValueChange={(next) => {
                if (next !== undefined) props.updateField("security.lockoutDurationMinutes", next);
              }}
            />
          </div>
        </div>
        <Separator />
        <UnlockAccountRow tSafe={tSafe} />
        <Separator />
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm">
              {tSafe(
                "admin.settings.security.rateLimiting.enabled",
                "Enable Rate Limiting",
              )}
            </span>
            <Switch
              checked={Boolean(rateLimiting.enabled)}
              onCheckedChange={(v) =>
                props.updateField("security.rateLimiting.enabled", v)
              }
            />
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>
                {tSafe(
                  "admin.settings.security.rateLimiting.adminPreset",
                  "Admin API",
                )}
              </Label>
              <Select
                value={String(rateLimiting.adminPreset ?? "default")}
                onValueChange={(v) =>
                  props.updateField("security.rateLimiting.adminPreset", v)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {presetOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>
                {tSafe(
                  "admin.settings.security.rateLimiting.vendorPreset",
                  "Vendor API",
                )}
              </Label>
              <Select
                value={String(rateLimiting.vendorPreset ?? "default")}
                onValueChange={(v) =>
                  props.updateField("security.rateLimiting.vendorPreset", v)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {presetOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>
                {tSafe(
                  "admin.settings.security.rateLimiting.checkoutPreset",
                  "Checkout / Payments",
                )}
              </Label>
              <Select
                value={String(rateLimiting.checkoutPreset ?? "default")}
                onValueChange={(v) =>
                  props.updateField("security.rateLimiting.checkoutPreset", v)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {presetOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>
                {tSafe("admin.settings.security.rateLimiting.cartPreset", "Cart")}
              </Label>
              <Select
                value={String(rateLimiting.cartPreset ?? "default")}
                onValueChange={(v) =>
                  props.updateField("security.rateLimiting.cartPreset", v)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {presetOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>
                {tSafe(
                  "admin.settings.security.rateLimiting.couponPreset",
                  "Coupons",
                )}
              </Label>
              <Select
                value={String(rateLimiting.couponPreset ?? "default")}
                onValueChange={(v) =>
                  props.updateField("security.rateLimiting.couponPreset", v)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {presetOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>
                {tSafe(
                  "admin.settings.security.rateLimiting.authPreset",
                  "Auth / Login",
                )}
              </Label>
              <Select
                value={String(rateLimiting.authPreset ?? "default")}
                onValueChange={(v) =>
                  props.updateField("security.rateLimiting.authPreset", v)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {presetOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-3">
              <Label>
                {tSafe(
                  "admin.settings.security.rateLimiting.ipPreset",
                  "Guest / Public (IP-based)",
                )}
              </Label>
              <Select
                value={String(rateLimiting.ipPreset ?? "default")}
                onValueChange={(v) =>
                  props.updateField("security.rateLimiting.ipPreset", v)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {presetOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <Separator />
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>
              {tSafe(
                "admin.settings.security.passwordPolicy.minLength",
                "Minimum Password Length",
              )}
            </Label>
            <NumberInput
              min={MIN_ALLOWED_PASSWORD_LENGTH}
              max={MAX_ALLOWED_PASSWORD_LENGTH}
              step={1}
              value={security.minPasswordLength ?? MIN_ALLOWED_PASSWORD_LENGTH}
              whenEmpty="keep"
              normalize={Math.trunc}
              onValueChange={(next) => {
                if (next !== undefined) props.updateField("security.minPasswordLength", next);
              }}
            />
          </div>
        </div>
        <Separator />
        <div className="grid gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm">
              {tSafe("admin.settings.security.passwordPolicy.uppercase", "Require Uppercase")}
            </span>
            <Switch
              checked={Boolean(security.requireUppercase)}
              onCheckedChange={(v) =>
                props.updateField("security.requireUppercase", v)
              }
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm">
              {tSafe("admin.settings.security.passwordPolicy.numbers", "Require Numbers")}
            </span>
            <Switch
              checked={Boolean(security.requireNumbers)}
              onCheckedChange={(v) =>
                props.updateField("security.requireNumbers", v)
              }
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm">
              {tSafe(
                "admin.settings.security.passwordPolicy.specialChars",
                "Require Special Characters",
              )}
            </span>
            <Switch
              checked={Boolean(security.requireSpecialChars)}
              onCheckedChange={(v) =>
                props.updateField("security.requireSpecialChars", v)
              }
            />
          </div>
        </div>
          <StickySaveFooter
            label={tSafe("admin.settings.security.save", "Save Security Settings")}
            isSaving={props.isSaving}
            isDirty={props.isDirty}
            onSave={props.onSave}
          />
        </CardContent>
      </Card>
    </div>
  );
}
