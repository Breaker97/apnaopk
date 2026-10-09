"use client";

import { useMemo, type ReactNode } from "react";
import { Ban, CheckCircle, CreditCard, XCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface CheckoutPaymentEvent {
  gateway?: string;
  status?: string;
  message?: string;
  paymentId?: string;
  createdAt?: string;
}

interface CheckoutPaymentTimelineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: string;
  customerName: string;
  /** Email or phone, printed after the name. */
  contact?: string;
  /** The row's recovery badge, so the dialog says how the story ended. */
  statusBadge?: ReactNode;
  events: CheckoutPaymentEvent[];
}

/** Gateway ids as stored on the event, named the way an operator knows them. */
const GATEWAY_LABELS: Record<string, string> = {
  stripe: "Stripe",
  // Checkout records the method the shopper picked, and "card" is Stripe's;
  // the capture is then recorded as "stripe". One name for both, or a single
  // card payment reads as two gateways.
  card: "Stripe",
  paypal: "PayPal",
  razorpay: "Razorpay",
  paystack: "Paystack",
  pesapal: "Pesapal",
  iotec: "ioTec Pay",
  orange_money: "Orange Money",
  mtn_momo: "MTN Mobile Money",
  cod: "Cash on delivery",
  bank_transfer: "Bank transfer",
};

function getGatewayLabel(gateway?: string) {
  if (!gateway) return "Checkout";
  const key = gateway.trim().toLowerCase();
  return (
    GATEWAY_LABELS[key] ||
    key.replace(/_/g, " ").replace(/^\w/, (letter) => letter.toUpperCase())
  );
}

const STATUS_META: Record<
  string,
  { label: string; icon: ReactNode; textClass: string }
> = {
  created: {
    label: "Payment started",
    icon: <CreditCard className="h-3 w-3 text-slate-400 dark:text-slate-500" />,
    textClass: "text-muted-foreground",
  },
  succeeded: {
    label: "Paid",
    icon: <CheckCircle className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />,
    textClass: "text-emerald-700 dark:text-emerald-400",
  },
  failed: {
    label: "Payment failed",
    icon: <XCircle className="h-3 w-3 text-rose-500" />,
    textClass: "text-rose-700 dark:text-rose-400",
  },
  cancelled: {
    label: "Cancelled",
    icon: <Ban className="h-3 w-3 text-slate-500 dark:text-slate-400" />,
    textClass: "text-slate-600 dark:text-slate-300",
  },
};

function getStatusMeta(event: CheckoutPaymentEvent) {
  const meta = STATUS_META[String(event.status)] || STATUS_META.created;
  // Nothing was paid when a cash-on-delivery order went through; the order
  // was placed, and that is all "succeeded" means for it.
  if (event.status === "succeeded" && event.gateway === "cod") {
    return { ...meta, label: "Order placed" };
  }
  return meta;
}

/**
 * Only a refusal or a cancellation carries a message worth reading — the
 * gateway's reason. "Checkout payment started" and "Stripe payment captured"
 * are written by our own code and only repeat the status beside them, which
 * is what turned a busy checkout into a wall of identical grey boxes.
 */
function getReason(event: CheckoutPaymentEvent) {
  if (event.status !== "failed" && event.status !== "cancelled") return null;
  return event.message?.trim() || null;
}

/**
 * How far apart two identical rows may be and still fold into one. Pressing
 * Pay again after a minute is the same attempt to check out; coming back in
 * the afternoon is a new visit, and folding it would hide that.
 */
const FOLD_WINDOW_MS = 15 * 60 * 1000;

interface TimelineRow {
  key: string;
  gateway?: string;
  status?: string;
  reason: string | null;
  paymentId?: string;
  /** Newest and oldest instant in the run; equal for a single event. */
  newest?: Date;
  oldest?: Date;
  count: number;
}

interface TimelineDay {
  key: string;
  date?: Date;
  rows: TimelineRow[];
}

function toDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Newest first, split by calendar day, with back-to-back repeats folded into
 * one row. A shopper who pressed Pay three times on Razorpay shows as one
 * "Razorpay · Payment started ×3" rather than three rows that differ only by
 * the second, which is what buried the one line that mattered — the gateway
 * that finally took the order. A refusal is never folded: each one can carry
 * a different reason, and a payment id to look it up by.
 */
function buildDays(events: CheckoutPaymentEvent[]): TimelineDay[] {
  const sorted = [...events].sort(
    (a, b) =>
      (toDate(b.createdAt)?.getTime() || 0) -
      (toDate(a.createdAt)?.getTime() || 0),
  );

  const days: TimelineDay[] = [];
  sorted.forEach((event, index) => {
    const date = toDate(event.createdAt);
    const dayKey = date ? date.toDateString() : "unknown";
    let day = days[days.length - 1];
    if (!day || day.key !== dayKey) {
      day = { key: dayKey, date, rows: [] };
      days.push(day);
    }

    const reason = getReason(event);
    const previous = day.rows[day.rows.length - 1];
    if (
      previous &&
      event.status !== "failed" &&
      previous.status === event.status &&
      getGatewayLabel(previous.gateway) === getGatewayLabel(event.gateway) &&
      previous.reason === reason &&
      date &&
      previous.oldest &&
      previous.oldest.getTime() - date.getTime() <= FOLD_WINDOW_MS
    ) {
      previous.count += 1;
      previous.oldest = date;
      return;
    }

    day.rows.push({
      key: `${event.createdAt || "none"}-${index}`,
      gateway: event.gateway,
      status: event.status,
      reason,
      paymentId: event.status === "created" ? undefined : event.paymentId,
      newest: date,
      oldest: date,
      count: 1,
    });
  });
  return days;
}

function pluralize(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * What the gateway said, newest first. A shopper who rings up saying "it kept
 * refusing my card" is answered from here rather than from the gateway's own
 * dashboard.
 *
 * The header answers the first question — did they get through, and how many
 * tries did it take — so the list below is only read when the detail matters.
 * The list scrolls inside the dialog; before, a checkout with a dozen events
 * pushed the title and the close button off the screen.
 */
export function CheckoutPaymentTimelineDialog({
  open,
  onOpenChange,
  locale,
  customerName,
  contact,
  statusBadge,
  events,
}: CheckoutPaymentTimelineDialogProps) {
  const days = useMemo(() => buildDays(events), [events]);

  const summary = useMemo(() => {
    const attempts = events.filter((event) => event.status === "created").length;
    const failed = events.filter((event) => event.status === "failed").length;
    const gateways = new Set(
      events.map((event) => getGatewayLabel(event.gateway)),
    );
    return { attempts, failed, gateways: gateways.size };
  }, [events]);

  const formatters = useMemo(
    () => ({
      day: new Intl.DateTimeFormat(locale, {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
      time: new Intl.DateTimeFormat(locale, {
        hour: "numeric",
        minute: "2-digit",
      }),
      full: new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "medium",
      }),
    }),
    [locale],
  );

  const formatTimeRange = (row: TimelineRow) => {
    if (!row.newest) return "";
    const newest = formatters.time.format(row.newest);
    if (!row.oldest || row.count === 1) return newest;
    const oldest = formatters.time.format(row.oldest);
    return oldest === newest ? newest : `${oldest} – ${newest}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(40rem,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="gap-1 border-b ps-6 pe-12 pt-5 pb-4 text-start sm:text-start">
          <DialogTitle className="text-base">Payment timeline</DialogTitle>
          <DialogDescription className="truncate">
            {contact && contact !== customerName
              ? `${customerName} · ${contact}`
              : customerName}
          </DialogDescription>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
            {statusBadge}
            {summary.attempts > 0 && (
              <span>{pluralize(summary.attempts, "attempt")}</span>
            )}
            {summary.gateways > 1 && (
              <span>{pluralize(summary.gateways, "gateway")}</span>
            )}
            {summary.failed > 0 && (
              <span className="font-medium text-rose-700 dark:text-rose-400">
                {summary.failed} failed
              </span>
            )}
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-5">
          {days.map((day) => (
            <section key={day.key}>
              {/* Sticks while its day scrolls by, so a row far down a long
                  list still says which day it belongs to. */}
              <h3 className="sticky top-0 z-10 bg-background pt-4 pb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                {day.date ? formatters.day.format(day.date) : "Date unknown"}
              </h3>
              {/* Logical properties (border-s / ps / -inset-s-*) keep the
                  rail on the correct side in the Arabic admin, as the order
                  timeline does. */}
              <ol role="list" className="ms-2.5 space-y-3 border-s border-border ps-5">
                {day.rows.map((row) => {
                  const meta = getStatusMeta(row);
                  return (
                    <li key={row.key} className="relative">
                      <span className="absolute -inset-s-7.5 top-0 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background">
                        {meta.icon}
                      </span>
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 text-sm leading-5">
                          <span className="font-medium text-foreground">
                            {getGatewayLabel(row.gateway)}
                          </span>
                          <span className={`ms-1.5 ${meta.textClass}`}>
                            {meta.label}
                          </span>
                          {row.count > 1 && (
                            <span className="ms-1.5 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
                              ×{row.count}
                            </span>
                          )}
                        </p>
                        {row.newest && (
                          <time
                            dateTime={row.newest.toISOString()}
                            title={formatters.full.format(row.newest)}
                            className="shrink-0 text-xs leading-5 text-muted-foreground tabular-nums"
                          >
                            {formatTimeRange(row)}
                          </time>
                        )}
                      </div>
                      {row.reason && (
                        <p
                          className={`mt-1.5 rounded-md px-3 py-2 text-xs leading-relaxed wrap-break-word ${
                            row.status === "failed"
                              ? "bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:text-rose-300"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {row.reason}
                        </p>
                      )}
                      {row.paymentId && (
                        <p
                          className="mt-1 truncate font-mono text-[11px] text-muted-foreground"
                          title={row.paymentId}
                        >
                          {row.paymentId}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
