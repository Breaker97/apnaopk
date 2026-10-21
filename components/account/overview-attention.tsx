"use client";

import { useState, type ReactNode } from "react";
import Link from "@/components/language/link";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight, MapPin, Package } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AppImage } from "@/components/ui/app-image";
import { InteractiveStarRating } from "@/components/reviews/star-rating";
import { ReviewDialog, type ReviewTarget } from "@/components/reviews/review-dialog";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { useCurrency } from "@/providers/currency-provider";
import { cn } from "@/lib/utils";
import { ORDER_STATUS_CLASSES } from "@/lib/theme-colors/status";
import type { PendingReview } from "@/lib/catalog/review-eligibility";
import type {
  OverviewAttention,
  OverviewProduct,
} from "@/lib/customers/overview-attention";

/**
 * Rows the card shows before "Show N more". The reviews wait their turn: the
 * first of them is the last row, and the rest of them fold away behind it.
 */
const COLLAPSED_ROWS = 3;

type Translator = ((key: never, values?: never) => string) & {
  has: (key: string) => boolean;
};

/** Statuses carrying an `orders.*` label in every locale. */
const TRANSLATED_ORDER_STATUSES = new Set([
  "pending",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
]);

/**
 * An order status in the shopper's words. A status without a translated label
 * is de-underscored rather than shown raw ("out_for_delivery").
 */
export function orderStatusLabel(t: Translator, status: string): string {
  if (TRANSLATED_ORDER_STATUSES.has(status)) {
    const key = `orders.${status}`;
    if (t.has(key)) return t(key as never);
  }
  const text = status.replace(/_/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A product's picture, or the box it would be in. */
export function ProductThumb({
  product,
  className,
}: {
  product: OverviewProduct;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative size-11 shrink-0 overflow-hidden rounded-lg bg-muted sm:size-12",
        className,
      )}
    >
      <AppImage
        src={product.image}
        alt=""
        fill
        sizes="48px"
        className="object-cover"
        fallback={
          <div className="flex h-full items-center justify-center">
            <Package className="h-5 w-5 text-muted-foreground" aria-hidden />
          </div>
        }
      />
    </div>
  );
}

function IconChip({
  icon: Icon,
  tone,
}: {
  icon: LucideIcon;
  tone: "warning" | "primary";
}) {
  return (
    <div
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-lg sm:size-12",
        tone === "warning"
          ? "bg-status-warning text-status-on-warning"
          : "bg-primary/10 text-store-link",
      )}
    >
      <Icon className="size-[22px]" aria-hidden />
    </div>
  );
}

const rowClassName = "flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5 sm:py-4";
const overlineClassName =
  "block text-[11px] font-bold uppercase leading-4 tracking-wider text-muted-foreground";

function RowText({
  overline,
  title,
  meta,
}: {
  overline?: string;
  title: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className="min-w-0 flex-1">
      {overline ? <span className={overlineClassName}>{overline}</span> : null}
      <p className="truncate text-sm font-medium leading-5">{title}</p>
      {meta ? (
        <p className="line-clamp-2 text-xs text-muted-foreground sm:text-[13px] sm:leading-[18px]">
          {meta}
        </p>
      ) : null}
    </div>
  );
}

/** A row's picture and words, with whatever acts on them on its far side. */
function RowBody({
  lead,
  text,
  trailing,
}: {
  lead: ReactNode;
  text: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
      {lead}
      {text}
      {trailing}
    </div>
  );
}

/** An order's first product, and how many more follow it, as one title. */
export function productTitle(
  product: OverviewProduct,
  orderNumber: string,
  moreItems: number,
  plusMore: (count: number) => string,
) {
  return (
    <>
      {product.name || `#${orderNumber}`}
      {moreItems > 0 ? (
        <span className="font-normal text-muted-foreground">
          {" "}
          {plusMore(moreItems)}
        </span>
      ) : null}
    </>
  );
}

/**
 * "Needs your attention": the few things on the account that wait on the
 * shopper, one row each — an address the courier cannot deliver to, money
 * still owed, the order on its way, a delivered product to rate. It states no
 * normal case: with nothing to ask it is not on the page at all.
 *
 * The order is the order of urgency (an address hold stops the parcel, an
 * unpaid balance can cancel the order). More than three rows fold behind
 * "Show N more", and the products still to be rated are what folds first.
 */
export function AttentionCard({
  locale,
  attention,
  pendingReviews,
}: {
  locale: string;
  attention: OverviewAttention;
  pendingReviews: PendingReview[];
}) {
  const t = useTranslations();
  const tf = useFallbackTranslator(t);
  const { formatPrice } = useCurrency();
  const [reviews, setReviews] = useState(pendingReviews);
  const [expanded, setExpanded] = useState(false);
  const [target, setTarget] = useState<ReviewTarget | null>(null);

  const formatDate = (value: string, options?: Intl.DateTimeFormatOptions) =>
    new Date(value).toLocaleDateString(
      locale,
      options ?? { year: "numeric", month: "short", day: "numeric" },
    );
  const shortDay = (value: string, timeZone?: string) =>
    formatDate(value, { month: "short", day: "numeric", timeZone });
  const plusMore = (count: number) =>
    tf("account.overview.plusMore", "+{count} more", { count });

  const openReview = (item: PendingReview, rating?: number) =>
    setTarget({
      productId: item.productId,
      orderId: item.orderId,
      name: item.name,
      image: item.image,
      orderNumber: item.orderNumber,
      rating,
    });

  const { addressHold, payment, inFlight } = attention;
  const primary: ReactNode[] = [];

  if (addressHold) {
    const deadline = addressHold.deadlineAt
      ? tf("account.overview.addressDeadline", "Shipping is paused, correct it by {date}", {
          date: shortDay(addressHold.deadlineAt),
        })
      : tf("account.overview.addressPaused", "Shipping is paused until the address is corrected");
    primary.push(
      <div key="address-hold" className={rowClassName}>
        <RowBody
          lead={<IconChip icon={MapPin} tone="warning" />}
          text={
            <RowText
              overline={tf("account.overview.actionNeeded", "Action needed")}
              title={tf("account.overview.addressTitle", "We can't deliver to your address")}
              meta={[
                `#${addressHold.orderNumber}`,
                deadline,
                addressHold.more > 0 ? plusMore(addressHold.more) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            />
          }
        />
        <Button asChild size="sm" className="min-h-11 self-start max-sm:ml-14 sm:min-h-8 sm:self-center">
          <Link href={`/account/orders/${addressHold.orderId}`}>
            {tf("account.overview.fixAddress", "Fix address")}
          </Link>
        </Button>
      </div>,
    );
  }

  if (payment) {
    const preorder = payment.kind === "preorder_balance";
    primary.push(
      <div key="payment" className={rowClassName}>
        <RowBody
          lead={<ProductThumb product={payment.product} />}
          text={
            <RowText
              overline={
                preorder
                  ? tf("orders.preorderBalance.title", "Pre-order balance")
                  : tf("account.overview.paymentDue", "Payment due")
              }
              title={payment.product.name || `#${payment.orderNumber}`}
              meta={[
                `#${payment.orderNumber}`,
                payment.deadlineAt
                  ? tf("account.overview.payBy", "Pay by {date}", {
                      // The balance deadline is a UTC calendar day.
                      date: shortDay(payment.deadlineAt, "UTC"),
                    })
                  : null,
                payment.more > 0 ? plusMore(payment.more) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            />
          }
        />
        <Button asChild size="sm" className="min-h-11 self-start max-sm:ml-14 sm:min-h-8 sm:self-center">
          <Link href={`/account/orders/${payment.orderId}`}>
            {tf("orders.preorderBalance.payAmount", "Pay {amount}", {
              amount: formatPrice(payment.amount),
            })}
          </Link>
        </Button>
      </div>,
    );
  }

  if (inFlight) {
    primary.push(
      <Link
        key="in-flight"
        href={`/account/orders/${inFlight.orderId}`}
        className={cn(rowClassName, "flex-row items-center transition-colors hover:bg-muted/50")}
      >
        <RowBody
          lead={<ProductThumb product={inFlight.product} />}
          text={
            <RowText
              overline={t("orders.trackOrder")}
              title={productTitle(
                inFlight.product,
                inFlight.orderNumber,
                inFlight.moreItems,
                plusMore,
              )}
              meta={[
                `#${inFlight.orderNumber} · ${formatDate(inFlight.createdAt)}`,
                inFlight.more > 0
                  ? tf("account.overview.moreInProgress", "{count} more in progress", {
                      count: inFlight.more,
                    })
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            />
          }
          trailing={
            <Badge
              variant="secondary"
              className={cn("shrink-0", ORDER_STATUS_CLASSES[inFlight.status])}
            >
              {orderStatusLabel(t, inFlight.status)}
            </Badge>
          }
        />
        <ChevronRight className="hidden size-4 shrink-0 text-muted-foreground sm:block" aria-hidden />
      </Link>,
    );
  }

  const reviewRow = (item: PendingReview, first: boolean) => (
    <div key={item.productId} className={rowClassName}>
      <RowBody
        lead={<ProductThumb product={{ name: item.name, image: item.image }} />}
        text={
          <div className="min-w-0 flex-1">
            {first ? (
              <span className={overlineClassName}>
                {tf("reviews.pendingTitle", "Rate your purchases")}
              </span>
            ) : null}
            <Link
              href={`/products/${item.slug}`}
              className="line-clamp-1 text-sm font-medium leading-5 hover:underline"
            >
              {item.name}
            </Link>
            <p className="text-xs text-muted-foreground sm:text-[13px] sm:leading-[18px]">
              {item.deliveredAt
                ? `${tf("reviews.deliveredOn", "Delivered {date}", {
                    date: formatDate(item.deliveredAt),
                  })} · `
                : null}
              <Link
                href={`/account/orders/${item.orderId}`}
                className="hover:underline"
              >
                #{item.orderNumber}
              </Link>
            </p>
          </div>
        }
      />
      <div className="max-sm:ml-14 sm:shrink-0">
        <InteractiveStarRating
          value={0}
          size="sm"
          onChange={(rating) => openReview(item, rating)}
          labelFor={(star) =>
            tf("reviews.rateStar", "Rate {count} out of 5", { count: star })
          }
        />
      </div>
    </div>
  );

  // The first product to rate is a row of its own; the others fold away.
  const [firstReview, ...otherReviews] = reviews;
  if (firstReview) primary.push(reviewRow(firstReview, true));
  const extra = otherReviews.map((item) => reviewRow(item, false));

  const all = [...primary, ...extra];
  if (all.length === 0) return null;

  // Folded, the card is its first three rows; whatever is past them — a fourth
  // row, the other products to rate — is what "Show N more" opens.
  const collapsedCount = Math.min(primary.length, COLLAPSED_ROWS);
  const foldable = all.length - collapsedCount;
  const visible = expanded ? all : all.slice(0, collapsedCount);

  return (
    <section
      aria-label={tf("account.overview.needsAttention", "Needs your attention")}
      className="overflow-hidden rounded-xl border bg-card shadow-sm"
    >
      <div className="divide-y">{visible}</div>
      {foldable > 0 ? (
        // The rule is the wrapper's: a button's own radius would curve its ends.
        <div className="border-t">
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 w-full rounded-none text-muted-foreground"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            {expanded
              ? tf("reviews.showFewer", "Show fewer")
              : tf("reviews.showMore", "Show {count} more", { count: foldable })}
            <ChevronDown
              className={cn("ml-1 size-4 transition-transform", expanded && "rotate-180")}
              aria-hidden
            />
          </Button>
        </div>
      ) : null}

      <ReviewDialog
        target={target}
        onClose={() => setTarget(null)}
        onReviewed={(reviewed) => {
          setTarget(null);
          setReviews((current) =>
            current.filter((item) => item.productId !== reviewed.productId),
          );
        }}
      />
    </section>
  );
}
