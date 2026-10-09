"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { authClient } from "@/lib/auth/auth-client";
import {
  DEFAULT_PROFILE_DEMO_MODE,
  type DemoModeState,
} from "@/lib/demo-mode-shared";

/**
 * "Delete account" on the account Security page: Better Auth's own
 * /delete-user, whose hooks keep the rules (lib/customers/account-deletion.ts)
 * and clean up after it. The shopper app's `DELETE /me` keeps the same ones.
 *
 * On a demo store the button is off; the page's password card already says
 * why. Asks for the password; Better Auth also accepts a sign-in from the last ten
 * minutes in its place, which is what an account without a password (one
 * that signs in with Google) relies on.
 */
export function DeleteAccountCard({
  locale,
  demoMode = DEFAULT_PROFILE_DEMO_MODE,
}: {
  locale: string;
  demoMode?: DemoModeState;
}) {
  const t = useTranslations("account.deleteAccount");
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onOpenChange = (next: boolean) => {
    if (isDeleting) return;
    setOpen(next);
    if (!next) {
      setPassword("");
      setError(null);
    }
  };

  const errorMessage = (code: string | undefined, fallback: string | undefined) => {
    switch (code) {
      case "INVALID_PASSWORD":
        return t("errors.wrongPassword");
      case "CREDENTIAL_ACCOUNT_NOT_FOUND":
      case "SESSION_EXPIRED":
        return t("errors.signInAgain");
      case "ACCOUNT_DELETION_NOT_ALLOWED":
        return t("errors.notAllowed");
      default:
        return fallback || t("errors.generic");
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (demoMode.enabled || isDeleting) return;
    setIsDeleting(true);
    setError(null);
    try {
      const { error: failure } = await authClient.deleteUser(
        password ? { password } : {},
      );
      if (failure) {
        setError(errorMessage(failure.code, failure.message));
        return;
      }
      // A new document, as after signing out: every client store still holds
      // the deleted account's data.
      window.location.assign(new URL(`/${locale}`, window.location.origin).href);
    } catch {
      setError(t("errors.generic"));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Card className="border-destructive/30 shadow-sm">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-destructive/10 p-2">
            <Trash2 className="h-5 w-5 text-destructive" />
          </div>
          <div>
            <CardTitle>
              <h2 className="text-lg">{t("title")}</h2>
            </CardTitle>
            <CardDescription>{t("description")}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="list-disc space-y-1 ps-5 text-sm text-muted-foreground">
          <li>{t("whatGoes")}</li>
          <li>{t("whatStays")}</li>
        </ul>
        <Button
          type="button"
          variant="destructive"
          disabled={demoMode.enabled}
          onClick={() => setOpen(true)}
        >
          {t("button")}
        </Button>
      </CardContent>

      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <AlertDialogHeader>
              <AlertDialogTitle>{t("confirmTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("confirmDescription")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2">
              <Label htmlFor="delete-account-password">{t("password")}</Label>
              <Input
                id="delete-account-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={isDeleting}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "delete-account-error" : undefined}
              />
              {error && (
                <p
                  id="delete-account-error"
                  role="alert"
                  className="text-sm text-destructive"
                >
                  {error}
                </p>
              )}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={isDeleting}>
                {t("cancel")}
              </AlertDialogCancel>
              <Button type="submit" variant="destructive" disabled={isDeleting}>
                {isDeleting && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                {t("confirm")}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
