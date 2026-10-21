"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast-notification";
import { createTSafe } from "@/components/admin/online-store/t-safe";

/**
 * The vendor's sign-in email, with a way to change it: the new address and
 * the current password, applied at once (PUT /api/vendor/account/email).
 * The old address is told by the server.
 */
export function VendorEmailChange({
  email,
  disabled = false,
  onChanged,
}: {
  email: string;
  disabled?: boolean;
  onChanged: (email: string) => void;
}) {
  const t = useTranslations();
  const tSafe = createTSafe(t);
  const [open, setOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; currentPassword?: string }>({});

  const openDialog = () => {
    setNewEmail("");
    setPassword("");
    setErrors({});
    setOpen(true);
  };

  const save = async () => {
    setSaving(true);
    setErrors({});
    try {
      const res = await fetch("/api/vendor/account/email", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail, currentPassword: password || undefined }),
      });
      const json = (await res.json()) as {
        success?: boolean;
        message?: string;
        error?: string;
        data?: { email?: string };
        errors?: Record<string, string[] | undefined>;
        details?: Record<string, string[] | undefined>;
      };
      if (!res.ok || !json.success) {
        const fields = json.errors ?? json.details ?? {};
        const next = {
          email: fields.email?.[0],
          currentPassword: fields.currentPassword?.[0],
        };
        if (next.email || next.currentPassword) setErrors(next);
        else {
          toast.error(
            json.message ||
              json.error ||
              tSafe("vendor.settingsForm.emailChangeFailed", "Failed to update email"),
          );
        }
        return;
      }
      const saved = json.data?.email ?? newEmail.trim().toLowerCase();
      onChanged(saved);
      setOpen(false);
      toast.success(
        tSafe(
          "vendor.settingsForm.emailChanged",
          "Email updated. Sign in with your new email from now on.",
        ),
      );
    } catch {
      toast.error(tSafe("vendor.settingsForm.emailChangeFailed", "Failed to update email"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="flex gap-2">
        <Input value={email} disabled className="min-w-0 flex-1" />
        <Button
          type="button"
          variant="outline"
          onClick={openDialog}
          disabled={disabled}
          className="shrink-0 gap-1.5"
        >
          <Mail className="h-4 w-4" />
          {tSafe("vendor.settingsForm.changeEmail", "Change")}
        </Button>
      </div>

      <Dialog open={open} onOpenChange={(next) => !saving && setOpen(next)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {tSafe("vendor.settingsForm.changeEmailTitle", "Change your email")}
            </DialogTitle>
            <DialogDescription>
              {tSafe(
                "vendor.settingsForm.changeEmailDescription",
                "You will sign in with the new email. We will let your current email know about the change.",
              )}
            </DialogDescription>
          </DialogHeader>

          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="vendor-new-email">
                {tSafe("vendor.settingsForm.newEmail", "New email")}
              </Label>
              <Input
                id="vendor-new-email"
                type="email"
                autoComplete="email"
                value={newEmail}
                onChange={(event) => setNewEmail(event.target.value)}
                aria-invalid={Boolean(errors.email)}
                required
              />
              {errors.email ? (
                <p className="text-xs font-medium text-destructive">{errors.email}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="vendor-email-password">
                {tSafe("vendor.settingsForm.currentPasswordForEmail", "Current password")}
              </Label>
              <Input
                id="vendor-email-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={Boolean(errors.currentPassword)}
                required
              />
              {errors.currentPassword ? (
                <p className="text-xs font-medium text-destructive">
                  {errors.currentPassword}
                </p>
              ) : null}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={saving}
              >
                {tSafe("common.cancel", "Cancel")}
              </Button>
              <Button
                type="submit"
                disabled={saving || !newEmail.trim() || !password}
                className="gap-1.5"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {tSafe("vendor.settingsForm.updateEmail", "Update email")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
