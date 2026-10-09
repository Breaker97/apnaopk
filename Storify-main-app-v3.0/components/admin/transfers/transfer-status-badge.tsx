"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

export type TransferStatus =
  | "draft"
  | "ready_to_ship"
  | "in_transit"
  | "completed"
  | "cancelled";

const STATUS_STYLES: Record<TransferStatus, string> = {
  draft: "bg-slate-100 text-slate-700 border-slate-200",
  ready_to_ship: "bg-amber-100 text-amber-700 border-amber-200",
  in_transit: "bg-blue-100 text-blue-700 border-blue-200",
  completed: "bg-emerald-100 text-emerald-700 border-emerald-200",
  cancelled: "bg-rose-100 text-rose-700 border-rose-200",
};

export function TransferStatusBadge({ status }: { status: TransferStatus }) {
  const t = useTranslations();
  const label = t(`admin.transfers.status.${status}`);

  return (
    <Badge variant="outline" className={cn("capitalize", STATUS_STYLES[status])}>
      {label}
    </Badge>
  );
}
