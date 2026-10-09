"use client";

import { useState } from "react";
import { Check, ChevronDown, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast-notification";
import {
  ScanHistory,
  describeScan,
  formatScanDate,
  type ScanEvent,
} from "@/components/shipping/scan-history";
import { cn } from "@/lib/utils";

/**
 * Copies a parcel's tracking number.
 *
 * A shopper who wants the number wants it in the carrier's app or a chat with
 * support, and selecting a 22-digit monospace string on a phone is the part of
 * that trip most likely to go wrong.
 */
export function CopyTrackingNumber({
  value,
  label = "Copy tracking number",
  copiedMessage = "Tracking number copied",
  className,
}: {
  value: string;
  label?: string;
  copiedMessage?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(copiedMessage);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy");
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className={cn("h-8 w-8 shrink-0 bg-background", className)}
      onClick={handleCopy}
      aria-label={label}
      title={label}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

/**
 * The courier's newest scan, with the rest one click away.
 *
 * A parcel's full history is a dozen lines per package, and on a split order
 * that stacks up fast; the latest scan is what someone checking on a delivery
 * came for.
 */
export function LatestScan({
  events,
  title,
  showAllLabel = "Show all scans",
  hideLabel = "Hide scans",
  className,
}: {
  events?: ScanEvent[];
  /** A small heading above the scan, e.g. "Latest from USPS". */
  title?: string;
  showAllLabel?: string;
  hideLabel?: string;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!events?.length) return null;

  const [latest, ...older] = events;

  return (
    <div className={cn("space-y-2", className)}>
      {title ? (
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
      ) : null}
      <div className="flex gap-3">
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
        <div className="min-w-0">
          <p className="text-sm font-medium">{describeScan(latest)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {latest.location ? `${latest.location} • ` : ""}
            {formatScanDate(latest.at)}
          </p>
        </div>
      </div>
      {older.length > 0 ? (
        <>
          {expanded ? (
            <ScanHistory events={older} className="mt-2" highlightLatest={false} />
          ) : null}
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="inline-flex items-center gap-1 py-1 text-xs font-medium text-primary hover:underline"
            aria-expanded={expanded}
          >
            {expanded ? hideLabel : `${showAllLabel} (${events.length})`}
            <ChevronDown
              className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")}
            />
          </button>
        </>
      ) : null}
    </div>
  );
}
