"use client";

import { useState } from "react";
import Link from "@/components/language/link";
import { Check, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast-notification";
import type { MarketingConsentState } from "@/config/app.config";

/**
 * The unsubscribe page's one control.
 *
 * Leaving the list is a POST rather than something the link itself does:
 * corporate mail scanners and inbox previews open every URL in a message, and
 * a GET that unsubscribes means a shopper who never touched the email is off
 * the list. Shopify's link acts on open; this one asks for the click, which is
 * the one deliberate difference here.
 */
export function UnsubscribeView({
  token,
  email,
  initialState,
  storeName,
}: {
  token: string;
  email: string;
  initialState: MarketingConsentState;
  storeName: string;
}) {
  const [state, setState] = useState<MarketingConsentState>(initialState);
  const [isSaving, setIsSaving] = useState(false);

  const submit = async (subscribe: boolean) => {
    setIsSaving(true);
    try {
      const res = await fetch("/api/marketing/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, subscribe }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Could not update your preferences");
      }
      setState(data.data?.state ?? (subscribe ? "subscribed" : "unsubscribed"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not update your preferences",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const isOut =
    state === "unsubscribed" || state === "invalid" || state === "redacted";
  // Never joined, never asked to stop. They are here because a checkout
  // reminder reached them, and "You are unsubscribed" — what this page used
  // to say — was untrue: the next abandoned checkout mailed them again.
  const neverJoined = state === "not_subscribed";

  return (
    <div className="rounded-2xl border bg-card p-6 sm:p-8">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
        {isOut || neverJoined ? (
          <Mail className="h-5 w-5 text-muted-foreground" aria-hidden />
        ) : (
          <Check className="h-5 w-5 text-muted-foreground" aria-hidden />
        )}
      </div>

      <h1 className="mt-4 text-xl font-semibold">
        {isOut
          ? "You are unsubscribed"
          : neverJoined
            ? "Stop these emails?"
            : "Leave our news and offers?"}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {isOut
          ? `${email} will no longer receive news, offers or checkout reminders from ${storeName}.`
          : neverJoined
            ? `${email} is not on our news and offers list, but may still get reminders about a checkout left unfinished at ${storeName}.`
            : `${email} currently receives news and offers from ${storeName}.`}
      </p>

      <div className="mt-4 rounded-xl border bg-muted/40 p-4">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Order confirmations, delivery updates and returns are not affected —
          those are sent for orders you place.
        </p>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {isOut ? (
          <Button
            variant="outline"
            className="rounded-full"
            disabled={isSaving || state === "invalid" || state === "redacted"}
            onClick={() => submit(true)}
          >
            Resubscribe
          </Button>
        ) : (
          <Button
            className="rounded-full"
            disabled={isSaving}
            onClick={() => submit(false)}
          >
            Unsubscribe
          </Button>
        )}
        <Link
          href="/"
          className="text-sm font-medium text-muted-foreground underline-offset-4 hover:underline"
        >
          Back to the store
        </Link>
      </div>
    </div>
  );
}
