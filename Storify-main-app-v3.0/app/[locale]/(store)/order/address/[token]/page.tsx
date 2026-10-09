import type { Metadata } from "next";
import Link from "@/components/language/link";
import { CheckCircle2, LinkIcon } from "lucide-react";
import { setRequestLocale } from "next-intl/server";
import { type Locale } from "@/config/i18n.config";
import { ORDER_STATUS } from "@/config/app.config";
import { connectDB } from "@/lib/db";
import { Order } from "@/models";
import { Button } from "@/components/ui/button";
import { readOrderAddressToken } from "@/lib/payments/preorder-balance-link";
import { isAddressHoldOpen, type AddressHold } from "@/lib/orders/address-hold-policy";
import { OrderAddressLinkView } from "@/components/orders/order-address-link-view";
import { RouteMessages } from "@/components/language/route-messages";

/**
 * Correct a delivery address without an account — the page the "we can't
 * deliver to your address" email links to.
 *
 * The token is an ADDRESS signature (`lib/payments/preorder-balance-link.ts`),
 * checked here to decide what to render and again by the routes the form calls.
 * It shows the address and the courier's reason, never the items or history, so
 * a forwarded link reveals as little as it can.
 */

export const metadata: Metadata = {
  title: "Correct your delivery address",
  // A capability URL has no business in a search index.
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ locale: string; token: string }>;
}

function Shell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="container mx-auto max-w-lg px-4 py-12 sm:py-16">
      <h1 className="mb-6 text-2xl font-semibold">{title}</h1>
      {children}
      <div className="mt-8">
        <Button asChild variant="outline" className="rounded-full">
          <Link href="/">Back to the store</Link>
        </Button>
      </div>
    </div>
  );
}

function Notice({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-4">
      {icon}
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function InvalidLink() {
  // One message for a forged token and an unknown order alike.
  return (
    <Shell title="Correct your delivery address">
      <Notice
        icon={<LinkIcon className="mt-0.5 h-5 w-5 text-muted-foreground" aria-hidden />}
        title="This link is not valid"
        body="It may have been mistyped or truncated by an email client. Open it from your email again, or contact us and we will help."
      />
    </Shell>
  );
}

export default async function OrderAddressPage({ params }: PageProps) {
  const { locale, token } = await params;
  setRequestLocale(locale as Locale);

  const orderId = readOrderAddressToken(token);
  if (!orderId) return <InvalidLink />;

  await connectDB();
  const order = await Order.findById(orderId)
    .select("orderNumber status shippingAddress addressHold")
    .lean<{
      _id: unknown;
      orderNumber: string;
      status?: string;
      shippingAddress?: Record<string, string | undefined>;
      addressHold?: AddressHold;
    } | null>();
  if (!order) return <InvalidLink />;

  const title = `Order #${order.orderNumber}`;

  if (order.status === ORDER_STATUS.CANCELLED) {
    return (
      <Shell title={title}>
        <Notice
          icon={<LinkIcon className="mt-0.5 h-5 w-5 text-muted-foreground" aria-hidden />}
          title="This order has been cancelled"
          body="There is nothing left to correct. If you were charged, the refund has been issued to your original payment method."
        />
      </Shell>
    );
  }

  if (!isAddressHoldOpen(order)) {
    return (
      <Shell title={title}>
        <Notice
          icon={<CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" aria-hidden />}
          title="Your delivery address is all set"
          body="Nothing needs correcting — your order ships to the address on file."
        />
      </Shell>
    );
  }

  const hold = order.addressHold!;
  return (
    <Shell title={title}>
      <RouteMessages namespaces={["orders"]}>
        <OrderAddressLinkView
          orderId={String(order._id)}
          orderNumber={order.orderNumber}
          accessToken={token}
          address={order.shippingAddress || {}}
          hold={{
            state: hold.state,
            message: hold.message,
            deadlineAt: hold.deadlineAt ? new Date(hold.deadlineAt).toISOString() : undefined,
            customerConfirmedAt: hold.customerConfirmedAt
              ? new Date(hold.customerConfirmedAt).toISOString()
              : undefined,
          }}
        />
      </RouteMessages>
    </Shell>
  );
}
