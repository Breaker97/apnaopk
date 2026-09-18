import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, LinkIcon } from "lucide-react";
import { setRequestLocale } from "next-intl/server";
import { type Locale } from "@/config/i18n.config";
import { connectDB } from "@/lib/db";
import { Order } from "@/models";
import { getSettings } from "@/models/settings.model";
import { Button } from "@/components/ui/button";
import { readPreorderBalanceToken } from "@/lib/payments/preorder-balance-link";
import {
  getPreorderBalanceDeadline,
  getPreorderBalanceDue,
  getPreorderPaidSoFar,
} from "@/lib/orders/order-payment-status";
import { resolvePreorderPolicy } from "@/lib/orders/preorder-gating";
import { PreorderBalanceLinkView } from "@/components/store/preorder-balance-link-view";

/**
 * Pay a pre-order balance from the link in the "balance due" email.
 *
 * The page a guest pre-order needs to exist at all: their order is backed by a
 * cart rather than a user, so the account view can never show it to them. The
 * token in the URL is a signature over the order id
 * (`lib/payments/preorder-balance-link.ts`) — it is checked here to decide
 * what to render, and again by the two routes the card calls, which are the
 * ones that actually matter.
 *
 * Deliberately narrow. Only the figures needed to pay are read out of the
 * order, so a leaked link exposes an amount and an order number rather than an
 * address and a shopping history, and the only thing it can do is pay.
 */

export const metadata: Metadata = {
  title: "Pay pre-order balance",
  // A capability URL has no business in a search index.
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ locale: string; token: string }>;
}

function Shell({
  locale,
  children,
}: {
  locale: string;
  children: React.ReactNode;
}) {
  return (
    <div className="container mx-auto max-w-lg px-4 py-12 sm:py-16">
      <h1 className="mb-6 text-2xl font-semibold">Pre-order balance</h1>
      {children}
      <div className="mt-8">
        <Button asChild variant="outline" className="rounded-full">
          <Link href={`/${locale}`}>Back to the store</Link>
        </Button>
      </div>
    </div>
  );
}

function Notice({
  locale,
  icon,
  title,
  body,
}: {
  locale: string;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Shell locale={locale}>
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

export default async function PreorderBalanceLinkPage({ params }: PageProps) {
  const { locale, token } = await params;
  setRequestLocale(locale as Locale);

  const orderId = readPreorderBalanceToken(token);
  if (!orderId) {
    // One message for a forged token and for an unknown order alike: telling
    // them apart would turn this page into a way to ask whether an order id
    // exists.
    return (
      <Notice
        locale={locale}
        icon={<LinkIcon className="h-5 w-5" aria-hidden />}
        title="This payment link is not valid"
        body="It may have been mistyped or truncated by an email client. Open the link from your pre-order email again, or contact us and we will send a fresh one."
      />
    );
  }

  await connectDB();
  const order = await Order.findById(orderId)
    .select(
      "orderNumber status paymentStatus paymentMethod total refundedTotal hasPreorder preorderStatus preorderPaymentMode preorderOutstandingAmount preorderBalancePaidAt preorderReleaseDate preorderBalanceRequestedAt subOrders.status subOrders.items.preorderOutstandingAmount",
    )
    .lean();
  if (!order) {
    return (
      <Notice
        locale={locale}
        icon={<LinkIcon className="h-5 w-5" aria-hidden />}
        title="This payment link is not valid"
        body="It may have been mistyped or truncated by an email client. Open the link from your pre-order email again, or contact us and we will send a fresh one."
      />
    );
  }

  const balanceDue = getPreorderBalanceDue(order);
  if (balanceDue <= 0) {
    // Covers both good endings and one sad one — paid, or cancelled and
    // refunded — because the link stops working for the same reason in each:
    // there is no longer a balance to collect.
    return (
      <Notice
        locale={locale}
        icon={<CheckCircle2 className="h-5 w-5" aria-hidden />}
        title={`Nothing left to pay on #${order.orderNumber}`}
        body="This balance has already been settled, or the pre-order was cancelled and anything paid refunded. Nothing further is needed."
      />
    );
  }

  const settings = await getSettings();
  const deadline = getPreorderBalanceDeadline(
    order,
    resolvePreorderPolicy(settings.preorder).expiryGraceDays,
  );

  return (
    <Shell locale={locale}>
      <p className="mb-4 text-sm text-muted-foreground">
        Order <span className="font-medium">#{order.orderNumber}</span>
      </p>
      <PreorderBalanceLinkView
        locale={locale}
        accessToken={token}
        order={{
          _id: String(order._id),
          status: String(order.status || ""),
          paymentStatus: String(order.paymentStatus || ""),
          hasPreorder: true,
          preorderStatus: order.preorderStatus,
          preorderPaymentMode: order.preorderPaymentMode,
          preorderOutstandingAmount: order.preorderOutstandingAmount,
          // Worked out here rather than in the browser: the card cannot see
          // which part of the balance belongs to a consignment a vendor has
          // called off, and would chase money nobody is owed.
          preorderBalanceDue: balanceDue,
          preorderPaidSoFar: getPreorderPaidSoFar(order),
          preorderBalanceDeadline: deadline?.toISOString(),
          total: Number(order.total || 0),
        }}
      />
    </Shell>
  );
}
