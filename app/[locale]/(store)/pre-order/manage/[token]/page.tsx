import type { Metadata } from "next";
import Link from "next/link";
import { LinkIcon } from "lucide-react";
import { setRequestLocale } from "next-intl/server";
import { type Locale } from "@/config/i18n.config";
import { ORDER_STATUS } from "@/config/app.config";
import { connectDB } from "@/lib/db";
import { Order } from "@/models";
import { getSettings } from "@/models/settings.model";
import { Button } from "@/components/ui/button";
import {
  createPreorderBalanceToken,
  readPreorderManageToken,
} from "@/lib/payments/preorder-balance-link";
import {
  getPreorderBalanceDeadline,
  getPreorderBalanceDue,
  getPreorderPaidSoFar,
} from "@/lib/orders/order-payment-status";
import { resolvePreorderPolicy } from "@/lib/orders/preorder-gating";
import { preorderAddressChangeBlocker } from "@/lib/orders/preorder-address";
import { PreorderManageView } from "@/components/store/preorder-manage-view";

/**
 * Manage a pre-order without an account — the page the delay notice links to.
 *
 * A guest's order is backed by a cart, so no account page can show it, and
 * until this a guest whose pre-order slipped had no way to cancel it, change
 * where it ships, or even see the new date outside the email. The token is a
 * MANAGE signature (`lib/payments/preorder-balance-link.ts`), which is not the
 * balance token from payment emails: it is checked here to decide what to
 * render, and again by every route an action on the page calls.
 *
 * It shows only what the actions need — dates, the delivery address, the
 * balance — never the order's items or history, so a forwarded link reveals as
 * little as it can while still being useful to the person it was sent to.
 */

export const metadata: Metadata = {
  title: "Manage your pre-order",
  // A capability URL has no business in a search index.
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ locale: string; token: string }>;
}

function Shell({
  locale,
  title,
  children,
}: {
  locale: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="container mx-auto max-w-lg px-4 py-12 sm:py-16">
      <h1 className="mb-6 text-2xl font-semibold">{title}</h1>
      {children}
      <div className="mt-8">
        <Button asChild variant="outline" className="rounded-full">
          <Link href={`/${locale}`}>Back to the store</Link>
        </Button>
      </div>
    </div>
  );
}

function InvalidLink({ locale }: { locale: string }) {
  // One message for a forged token and an unknown order alike: telling them
  // apart would make this page a way to ask whether an order id exists.
  return (
    <Shell locale={locale} title="Manage your pre-order">
      <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-4">
        <LinkIcon className="mt-0.5 h-5 w-5 text-muted-foreground" aria-hidden />
        <div>
          <p className="font-medium">This link is not valid</p>
          <p className="mt-1 text-sm text-muted-foreground">
            It may have been mistyped or truncated by an email client. Open it
            from your pre-order email again, or contact us and we will send a
            fresh one.
          </p>
        </div>
      </div>
    </Shell>
  );
}

function formatDay(value: unknown, locale: string) {
  if (!value) return undefined;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export default async function PreorderManagePage({ params }: PageProps) {
  const { locale, token } = await params;
  setRequestLocale(locale as Locale);

  const orderId = readPreorderManageToken(token);
  if (!orderId) return <InvalidLink locale={locale} />;

  await connectDB();
  const order = await Order.findById(orderId)
    .select(
      "orderNumber status paymentStatus paymentMethod total refundedTotal digitalOnly shippingAddress hasPreorder preorderStatus preorderPaymentMode preorderOutstandingAmount preorderBalancePaidAt preorderReleaseDate preorderOriginalReleaseDate preorderDelayReason preorderBalanceRequestedAt subOrders.status subOrders.fulfillment.method subOrders.items.preorderOutstandingAmount",
    )
    .lean();
  if (!order || !order.hasPreorder) return <InvalidLink locale={locale} />;

  const cancelled = order.status === ORDER_STATUS.CANCELLED;
  const balanceDue = getPreorderBalanceDue(order);
  const settings = await getSettings();
  const deadline =
    balanceDue > 0
      ? getPreorderBalanceDeadline(
          order,
          resolvePreorderPolicy(settings.preorder).expiryGraceDays,
        )
      : null;
  // Minted here, not accepted from anywhere: holding the manage link already
  // entitles the shopper to pay, and the balance routes only take the balance
  // token — so capabilities stay separate at the API even on one page.
  const balanceToken = balanceDue > 0 ? createPreorderBalanceToken(orderId) : undefined;

  return (
    <Shell locale={locale} title={`Pre-order #${order.orderNumber}`}>
      <PreorderManageView
        locale={locale}
        manageToken={token}
        balanceToken={balanceToken}
        order={{
          _id: String(order._id),
          orderNumber: order.orderNumber,
          cancelled,
          // The same statuses the account route cancels from.
          canCancel:
            order.status === ORDER_STATUS.PENDING ||
            order.status === ORDER_STATUS.PREORDERED,
          addressBlocker: order.digitalOnly
            ? "This order has nothing to ship"
            : preorderAddressChangeBlocker(order),
          releaseDateLabel: formatDay(order.preorderReleaseDate, locale),
          originalReleaseDateLabel: order.preorderOriginalReleaseDate
            ? formatDay(order.preorderOriginalReleaseDate, locale)
            : undefined,
          delayReason: order.preorderDelayReason || undefined,
          shippingAddress: order.digitalOnly
            ? undefined
            : (order.shippingAddress as React.ComponentProps<
                typeof PreorderManageView
              >["order"]["shippingAddress"]),
          balance:
            balanceDue > 0
              ? {
                  _id: String(order._id),
                  status: String(order.status || ""),
                  paymentStatus: String(order.paymentStatus || ""),
                  hasPreorder: true,
                  preorderStatus: order.preorderStatus,
                  preorderPaymentMode: order.preorderPaymentMode,
                  preorderOutstandingAmount: order.preorderOutstandingAmount,
                  // Worked out here: the card cannot see which part of the
                  // balance belongs to a consignment a vendor called off.
                  preorderBalanceDue: balanceDue,
                  preorderPaidSoFar: getPreorderPaidSoFar(order),
                  preorderBalanceDeadline: deadline?.toISOString(),
                  total: Number(order.total || 0),
                }
              : undefined,
        }}
      />
    </Shell>
  );
}
