"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { BellRing, CheckCircle2, Loader2 } from "lucide-react";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast-notification";

/**
 * "All pre-order spots are taken — tell me if one opens."
 *
 * The state a full pre-order used to render as plain "Out of stock", which is
 * both wrong (it is not a stock problem, and it may come back) and a dead end.
 * A signed-in shopper joins with one click on their own address; a guest types
 * theirs. The invitation it leads to is honest about the race — see
 * `lib/orders/preorder-waitlist.ts`.
 */
export function PreorderWaitlistForm({
  productKey,
  variantId,
  locale,
  signedInEmail,
}: {
  /** The product's slug, or its id — what the route segment accepts. */
  productKey: string;
  variantId?: string;
  locale: string;
  signedInEmail?: string;
}) {
  const t = useTranslations();
  const tf = useFallbackTranslator(t);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [joined, setJoined] = useState(false);

  const join = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/products/${encodeURIComponent(productKey)}/preorder-waitlist`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            // A signed-in shopper's address comes from their session on the
            // server; sending one here would be ignored anyway.
            email: signedInEmail ? undefined : email.trim(),
            variantId,
            locale,
          }),
        },
      );
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        const fieldError = json?.errors
          ? (Object.values(json.errors as Record<string, string[]>).flat()[0] as
              | string
              | undefined)
          : undefined;
        throw new Error(
          fieldError ||
            json?.message ||
            tf("product.preorderWaitlist.failed", "Could not add you to the list"),
        );
      }
      const result = json.data as { joined: boolean; reason?: string };
      if (result.joined) {
        setJoined(true);
        return;
      }
      // The spot that was full has opened again between page load and now —
      // the list would be a pointless wait for something already in reach.
      if (result.reason === "available") {
        toast.info(
          tf(
            "product.preorderWaitlist.available",
            "A spot has just opened — refresh the page to pre-order now.",
          ),
        );
        return;
      }
      toast.info(
        tf(
          "product.preorderWaitlist.closed",
          "This pre-order is no longer taking a waiting list.",
        ),
      );
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : tf("product.preorderWaitlist.failed", "Could not add you to the list"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (joined) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>
          {tf(
            "product.preorderWaitlist.joined",
            "You're on the list. We'll email you if a spot opens — pre-orders then go to whoever checks out first.",
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-3 text-sm text-blue-900 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-100">
      <p className="font-medium">
        {tf("product.preorderWaitlist.full", "All pre-order spots are taken")}
      </p>
      <p className="text-blue-800/90 dark:text-blue-200/80">
        {tf(
          "product.preorderWaitlist.hint",
          "Spots open up when someone cancels. Join the list and we'll tell you.",
        )}
      </p>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          void join();
        }}
      >
        {signedInEmail ? null : (
          <Input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={tf("product.preorderWaitlist.emailPlaceholder", "Your email")}
            autoComplete="email"
            className="bg-background"
          />
        )}
        <Button type="submit" disabled={submitting} className="shrink-0">
          {submitting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <BellRing className="mr-2 h-4 w-4" />
          )}
          {tf("product.preorderWaitlist.join", "Notify me")}
        </Button>
      </form>
    </div>
  );
}
