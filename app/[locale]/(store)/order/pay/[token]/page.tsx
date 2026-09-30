import type { Metadata } from "next";
import Link from "@/components/language/link";
import { CheckCircle2, LinkIcon } from "lucide-react";
import { setRequestLocale } from "next-intl/server";
import { type Locale } from "@/config/i18n.config";
import { connectDB } from "@/lib/db";
import { Order } from "@/models";
import { Button } from "@/components/ui/button";
import { readOrderPayToken } from "@/lib/payments/preorder-balance-link";
import {
  getOrderPayAmountDue,
  isOrderPayable,
  type PayableOrder,
} from "@/lib/payments/order-pay";
import {
  SUPERSEDED_ATTEMPT_REASON,
  wasSupersededByLaterPurchase,
} from "@/lib/checkout/superseded-orders";
import { OrderPayLinkView } from "@/components/store/order-pay-link-view";
import { RouteMessages } from "@/components/language/route-messages";
import { formatCurrency } from "@/lib/intl/money";

/**
 * Pay for an order whose payment never arrived, from the link in the email
 * that told the shopper so.
 *
 * The page a guest needs for this to work at all: their order is backed by a
 * cart rather than a user, so their account can never show it to them. The
 * token in the URL is a signature over the order id and an expiry
 * (`lib/payments/preorder-balance-link.ts`) — checked here to decide what to
 * render, and again by the routes the card calls, which are the ones that
 * matter.
 *
 * Deliberately narrow: only the order number and the amount are read out, so a
 * leaked or forwarded link exposes a figure rather than an address and a
 * shopping history, and the only thing it can do is pay.
 */

export const metadata: Metadata = {
  title: "Pay for your order",
  // A capability URL has no business in a search index.
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ locale: string; token: string }>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="container mx-auto max-w-lg px-4 py-12 sm:py-16">
      <h1 className="mb-6 text-2xl font-semibold">Pay for your order</h1>
      {children}
      <div className="mt-8">
        <Button asChild variant="outline" className="rounded-full">
          <Link href="/">Back to the store</Link>
        </Button>
      </div>
    </div>
  );
}

function Notice({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Shell>
      <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-4">
        <div className="mt-0.5 text-muted-foreground">{icon}</div>
        <div>
          <p className="font-medium">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{body}</p>
        </div>
      </div>
    </Shell>
  );
}

const INVALID_LINK = {
  title: "This payment link is not valid",
  body: "It may have expired — these links last a week — or been truncated by an email client. Contact us and we will send you a fresh one.",
};

export default async function OrderPayLinkPage({ params }: PageProps) {
  const { locale, token } = await params;
  setRequestLocale(locale as Locale);

  const orderId = readOrderPayToken(token);
  if (!orderId) {
    // One message for a forged token, an expired one and an unknown order
    // alike: telling them apart would turn this page into a way of asking
    // whether an order id exists.
    return (
      <Notice
        icon={<LinkIcon className="h-5 w-5" aria-hidden />}
        {...INVALID_LINK}
      />
    );
  }

  await connectDB();
  const order = (await Order.findById(orderId)
    .select(
      "orderNumber status paymentStatus paymentMethod channel currency total preorderOutstandingAmount storeCredit cancelReason checkoutCartId createdAt exchangeOf",
    )
    .lean()) as
    | (PayableOrder & {
        cancelReason?: string;
        checkoutCartId?: unknown;
        createdAt?: Date;
        exchangeOf?: { returnNumber?: string; undoneAt?: Date | null } | null;
      })
    | null;
  if (!order) {
    return (
      <Notice
        icon={<LinkIcon className="h-5 w-5" aria-hidden />}
        {...INVALID_LINK}
      />
    );
  }

  const amountDue = getOrderPayAmountDue(order);
  if (!isOrderPayable(order) || amountDue <= 0) {
    // Paid in the meantime, or cancelled. Both end the link's usefulness, and
    // the shopper is told which without being asked for money either way.
    const cancelled = String(order.status || "") === "cancelled";
    // Retired because the shopper went through the same checkout again. Said
    // as it is — "cancelled" alone reads as the shop calling the sale off —
    // and split on whether that newer checkout has been paid for yet.
    const replaced =
      cancelled && order.cancelReason === SUPERSEDED_ATTEMPT_REASON;
    const completedElsewhere =
      replaced && (await wasSupersededByLaterPurchase(order).catch(() => false));
    return (
      <Notice
        icon={<CheckCircle2 className="h-5 w-5" aria-hidden />}
        title={
          completedElsewhere
            ? `Order #${order.orderNumber} is no longer needed`
            : replaced
              ? `Order #${order.orderNumber} was replaced`
              : cancelled
                ? `Order #${order.orderNumber} was cancelled`
                : `Nothing left to pay on #${order.orderNumber}`
        }
        body={
          completedElsewhere
            ? "This checkout was completed as another order, so there is nothing to pay here. Your confirmation email has the details of the order that went ahead."
            : replaced
              ? "You started this checkout again, so this link can no longer take a payment and nothing has been charged. Finish the newer checkout, or start again from your cart."
              : cancelled
                ? "This order is no longer going ahead, so there is nothing to pay. Anything already taken has been refunded."
                : "This order has already been paid for. Nothing further is needed — your confirmation email has the details."
        }
      />
    );
  }

  return (
    <Shell>
      <p className="mb-4 text-sm text-muted-foreground">
        Order <span className="font-medium">#{order.orderNumber}</span>
        {/* The exchange a return became (R7): the rest of it, not a new bill. */}
        {order.exchangeOf?.returnNumber && !order.exchangeOf.undoneAt ? (
          <>
            {" "}— the exchange for your return {order.exchangeOf.returnNumber}. Your return
            covered{" "}
            {formatCurrency(
              Number(order.storeCredit?.applied || 0),
              String(order.currency || "USD"),
            )}
            .
          </>
        ) : null}
      </p>
      <RouteMessages namespaces={["orders"]}>
        <OrderPayLinkView
          locale={locale}
          accessToken={token}
          order={{
            _id: String(order._id),
            status: String(order.status || ""),
            paymentStatus: String(order.paymentStatus || ""),
            // Worked out on the server: the browser cannot see a pre-order's
            // outstanding balance, and would ask for the wrong figure.
            preorderBalanceDue: amountDue,
            preorderPaidSoFar: 0,
            // Decides whether the card offers a card form or a fresh prompt to
            // the payer's phone.
            paymentMethod: String(order.paymentMethod || ""),
            total: Number(order.total || 0),
          }}
        />
      </RouteMessages>
    </Shell>
  );
}
