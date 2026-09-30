"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Circle, Package } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { cn } from "@/lib/utils";
import type { QuoteStage } from "@/lib/quotes/quote-status";
import type { QuoteLotLimit } from "@/lib/quotes/quote-lot-fit";

/**
 * The small pieces the Quotes table, the detail sheet and the price dialog
 * all draw, so the three never show the same quote two different ways.
 */

/**
 * One colour per stage, in the Orders list's pill style. The order of warmth
 * is the order of urgency: amber waits on the merchant, rose lapsed and wants
 * a nudge, blue and cyan wait on the customer, green is done, slate is over.
 */
const STAGE_STYLES: Record<QuoteStage, string> = {
  needs_reply:
    "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  offer_sent:
    "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
  expired: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
  ordered: "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/20 dark:text-cyan-300",
  won: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  closed:
    "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-200",
};

export function QuoteStageBadge({
  stage,
  className,
}: {
  stage: QuoteStage;
  className?: string;
}) {
  const t = useTranslations("admin.quotesPage.stage");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm px-2 py-1 text-[12px] font-medium",
        STAGE_STYLES[stage],
        className,
      )}
    >
      <Circle className="h-2.5 w-2.5 fill-current stroke-0" />
      {t(stage)}
    </span>
  );
}

/** "Guest" beside a name that has no account behind it. */
export function GuestChip() {
  const t = useTranslations("common");
  return (
    <span className="inline-flex h-[18px] shrink-0 items-center rounded-sm bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground">
      {t("guest")}
    </span>
  );
}

export function QuoteProductThumb({
  src,
  alt,
  size = 36,
}: {
  src?: string;
  alt: string;
  size?: 36 | 48;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground",
        size === 48 ? "h-12 w-12" : "h-9 w-9",
      )}
    >
      {src && !failed ? (
        <AppImage
          src={src}
          alt={alt}
          fill
          sizes="48px"
          className="object-cover"
          onImageError={() => setFailed(true)}
        />
      ) : (
        <Package className="h-4 w-4" />
      )}
    </span>
  );
}

/** Short date, the way the Orders list prints one. */
export function formatQuoteDate(value?: string | Date | null) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Why a quoted lot cannot be checked out, in a table cell's few words or the
 * sentence the sheet and the dialog print. Null when it can.
 */
export function useLotMessage() {
  const t = useTranslations("admin.quotesPage.lot");
  return {
    short(limit: QuoteLotLimit) {
      switch (limit.reason) {
        case "stock":
          return t("stockShort", { max: limit.max ?? 0 });
        case "preorder":
          return t("preorderShort", { max: limit.max ?? 0 });
        case "needs_variant":
          return t("needsVariantShort");
        default:
          return t("unavailableShort");
      }
    },
    long(limit: QuoteLotLimit, quantity: number) {
      switch (limit.reason) {
        case "stock":
          return t("stock", { max: limit.max ?? 0, quantity });
        case "preorder":
          return t("preorder", { max: limit.max ?? 0, quantity });
        case "needs_variant":
          return t("needsVariant");
        default:
          return t("unavailable");
      }
    },
  };
}
