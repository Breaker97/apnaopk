"use client";

import { useState } from "react";
import { Clock3, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast-notification";
import { apiClient, describeApiError } from "@/lib/api/client";

/**
 * Shown to a vendor this store has not cleared for pre-orders yet.
 *
 * Without a way to ask, the admin's approval queue would never have anything in
 * it and the only route in would be emailing someone — which is what this
 * replaces. It appears solely when the store actually requires review, so a
 * shop that leaves review off never sees a gate that is not there.
 *
 * `requestedAt` is passed from the server rather than fetched, so the pending
 * state is right on first paint instead of flashing "Request access" at a
 * vendor who already asked yesterday.
 */
export function VendorPreorderAccessNotice(props: {
  requestedAt?: string | null;
  maxLeadDays: number;
  maxDepositPercent: number;
}) {
  const [requested, setRequested] = useState(Boolean(props.requestedAt));
  const [isSubmitting, setIsSubmitting] = useState(false);

  const request = async () => {
    setIsSubmitting(true);
    try {
      await apiClient.post("/api/vendor/preorder-access");
      setRequested(true);
      toast.success("Request sent — the store will review it");
    } catch (error) {
      toast.error(describeApiError(error, "Could not send the request"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-wrap items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
      <span className="mt-0.5 text-amber-700 dark:text-amber-300">
        {requested ? (
          <Clock3 className="h-4 w-4" />
        ) : (
          <Lock className="h-4 w-4" />
        )}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
          {requested
            ? "Your pre-order request is with the store"
            : "This store reviews vendors before they can sell pre-orders"}
        </p>
        <p className="text-xs text-amber-800/90 dark:text-amber-200/80">
          {requested
            ? "You will be able to open pre-orders as soon as it is approved. Anything already selling is unaffected."
            : `Once approved you can take deposits ahead of a release. Release dates can be up to ${props.maxLeadDays} days out, and deposits up to ${props.maxDepositPercent}% of the price.`}
        </p>
      </div>
      {!requested ? (
        // `type="button"`: this notice also sits inside the product editor's
        // form, where a default-typed button would submit the product.
        <Button
          type="button"
          size="sm"
          disabled={isSubmitting}
          onClick={() => void request()}
        >
          {isSubmitting ? "Sending..." : "Request access"}
        </Button>
      ) : null}
    </div>
  );
}
