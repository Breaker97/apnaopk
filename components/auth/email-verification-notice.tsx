"use client";

import { useState } from "react";
import { AlertCircle, Loader2, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EmailVerificationStatus } from "@/lib/auth/email-verification-policy";

export function EmailVerificationNotice({
  email,
  status,
  locale,
}: {
  email: string;
  status?: EmailVerificationStatus;
  locale: string;
}) {
  const [isSending, setIsSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (status !== "grace_pending") return null;

  const resend = async () => {
    setIsSending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/auth/send-verification-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          callbackURL: `/${locale}/email-verified`,
        }),
      });
      if (!response.ok) throw new Error();
      setMessage("A verification link has been sent. Please check your inbox.");
    } catch {
      setMessage("The verification email could not be sent. Please try again shortly.");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950 sm:flex-row sm:items-center sm:justify-between dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
      <div className="flex gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <p className="font-medium">Your email address is not verified</p>
          <p className="text-sm opacity-80">
            Your account remains accessible. Verify {email} to secure it.
          </p>
          {message && <p className="mt-1 text-sm font-medium">{message}</p>}
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        className="shrink-0 bg-background"
        disabled={isSending}
        onClick={() => void resend()}
      >
        {isSending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <MailCheck className="mr-2 h-4 w-4" />
        )}
        Verify email
      </Button>
    </div>
  );
}
