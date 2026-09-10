import { AlertTriangle } from "lucide-react";
import { format } from "date-fns";

import { cn } from "@/lib/utils";

/** Delivery going wrong, as the API serialises it. */
export type DeliveryException = {
  /** Our normalized vocabulary: `returned` or `failure`. */
  code: string;
  message: string;
  at: string;
};

const exceptionTitles: Record<string, string> = {
  returned: "Returned to sender",
  failure: "Delivery issue",
};

/**
 * A parcel the courier could not deliver.
 *
 * This is the one thing on a customer's tracking view that the order status
 * cannot say. A return or a failed attempt deliberately does not rewrite the
 * order — voiding a delivery on one carrier scan would be worse than leaving
 * it — so a page reading only the status went on saying "In transit" about a
 * parcel that had already gone back to the depot.
 *
 * The courier's own message is quoted rather than paraphrased: "Recipient not
 * available, second attempt tomorrow" is something the shopper can act on, and
 * anything we substitute for it would be less true.
 */
export function DeliveryException({
  exception,
  className,
}: {
  exception?: DeliveryException;
  className?: string;
}) {
  if (!exception) return null;

  const title = exceptionTitles[exception.code] || "Delivery issue";

  return (
    <div
      className={cn(
        "mt-3 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-800 dark:text-amber-300",
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        <p className="text-xs font-semibold">{title}</p>
        <p className="mt-0.5 text-xs">{exception.message}</p>
        <p className="mt-0.5 text-xs opacity-80">
          {format(new Date(exception.at), "MMM d, yyyy 'at' h:mm a")}
        </p>
      </div>
    </div>
  );
}
