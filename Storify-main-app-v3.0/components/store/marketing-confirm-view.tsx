"use client";

import { useState } from "react";
import Link from "@/components/language/link";
import { Check, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast-notification";

/**
 * The double opt-in landing page's one control.
 *
 * A click rather than a page load, for the same reason as the unsubscribe
 * page: mail scanners open every link in a message, and a subscription
 * confirmed by a corporate filter is not consent from anybody.
 */
export function MarketingConfirmView({
  token,
  email,
  storeName,
  alreadyConfirmed,
}: {
  token: string;
  email: string;
  storeName: string;
  alreadyConfirmed: boolean;
}) {
  const [confirmed, setConfirmed] = useState(alreadyConfirmed);
  const [isSaving, setIsSaving] = useState(false);

  const confirm = async () => {
    setIsSaving(true);
    try {
      const res = await fetch("/api/marketing/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Could not confirm your subscription");
      }
      setConfirmed(true);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not confirm your subscription",
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border bg-card p-6 sm:p-8">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
        {confirmed ? (
          <Check className="h-5 w-5 text-muted-foreground" aria-hidden />
        ) : (
          <Mail className="h-5 w-5 text-muted-foreground" aria-hidden />
        )}
      </div>

      <h1 className="mt-4 text-xl font-semibold">
        {confirmed ? "Subscription confirmed" : "One last step"}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {confirmed
          ? `Thanks — ${email} is on the list. You can leave any time from the link at the foot of every email.`
          : `Confirm that ${email} should receive news and offers from ${storeName}.`}
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {confirmed ? (
          <Button asChild className="rounded-full">
            <Link href="/">Start shopping</Link>
          </Button>
        ) : (
          <>
            <Button
              className="rounded-full"
              disabled={isSaving}
              onClick={confirm}
            >
              Confirm subscription
            </Button>
            <Link
              href="/"
              className="text-sm font-medium text-muted-foreground underline-offset-4 hover:underline"
            >
              Not now
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
