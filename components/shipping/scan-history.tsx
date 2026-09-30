import { format } from "date-fns";

import { cn } from "@/lib/utils";

/** One scan reported by the courier itself, as the API serialises it. */
export type ScanEvent = {
  at: string;
  status: string;
  description?: string;
  location?: string;
};

/**
 * Our normalized tracking vocabulary, in words a shopper reads.
 *
 * Only a fallback: a carrier that sent its own description is quoted verbatim,
 * because "Arrived at DHL facility LEJ" tells someone more than "In transit".
 */
const scanStatusLabels: Record<string, string> = {
  pre_transit: "Label created",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  returned: "Returned to sender",
  failure: "Delivery issue",
  unknown: "Update",
};

export function formatScanDate(value: string) {
  return format(new Date(value), "MMM d, yyyy 'at' h:mm a");
}

/** The carrier's own words when it sent any, else ours. */
export function describeScan(event: ScanEvent) {
  return event.description || scanStatusLabels[event.status] || event.status;
}

/**
 * The courier's scans, newest first.
 *
 * Shared by the public tracking page and the signed-in order screen. Rendering
 * nothing for an empty feed is the point: a store fulfilling by hand has no
 * scans, and the coarse order timeline above is the whole story there.
 */
export function ScanHistory({
  events,
  className,
  highlightLatest = true,
}: {
  events?: ScanEvent[];
  className?: string;
  /**
   * Marks the first scan as the newest. Off when the list is only the older
   * scans under a `LatestScan`, whose own dot already marks the newest one.
   */
  highlightLatest?: boolean;
}) {
  if (!events?.length) return null;

  return (
    <ol className={cn("mt-3 space-y-2 border-t pt-3", className)}>
      {events.map((event, index) => (
        <li key={`${event.at}-${index}`} className="flex gap-3">
          <span
            className={cn(
              "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
              index === 0 && highlightLatest ? "bg-primary" : "bg-muted-foreground/40",
            )}
          />
          <div className="min-w-0">
            <p className="text-xs font-medium">{describeScan(event)}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {formatScanDate(event.at)}
              {event.location ? ` • ${event.location}` : ""}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
