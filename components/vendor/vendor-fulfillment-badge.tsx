"use client";

import { Clock3, MapPin } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  preordered:
    "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300",
  pending: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
  processing:
    "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  shipped: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
  delivered:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
};

const FALLBACK_STYLE =
  "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-200";

/**
 * A vendor consignment's fulfilment state, worded and coloured as the vendor
 * order list's Fulfillment column shows it. The dashboard's recent orders use
 * the same badge, so one order never reads two different ways.
 *
 * A consignment collected in person shows its pickup progress instead.
 */
export function VendorFulfillmentBadge({
  status,
  pickupStatus,
  className,
}: {
  status: string;
  pickupStatus?: string;
  className?: string;
}) {
  const t = useTranslations();
  const shown = pickupStatus || status;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-[12px] font-medium",
        STATUS_STYLES[shown] || FALLBACK_STYLE,
        className,
      )}
    >
      {pickupStatus ? (
        <MapPin className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <Clock3 className="h-3.5 w-3.5 shrink-0" />
      )}
      {pickupStatus
        ? `${t("checkout.pickup.localPickup")} · ${t(`checkout.pickup.${pickupStatus}`)}`
        : t(`vendor.fulfillmentStatus.${status}`)}
    </span>
  );
}
