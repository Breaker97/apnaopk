import { format } from "date-fns";

import { WarningBanner } from "@/components/ui/warning-banner";
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
    <WarningBanner title={title} className={cn("mt-3", className)}>
      <p>{exception.message}</p>
      <p className="text-muted-foreground">
        {format(new Date(exception.at), "MMM d, yyyy 'at' h:mm a")}
      </p>
    </WarningBanner>
  );
}
