"use client";

import { IOrder } from "@/types";
import { useTranslations } from "next-intl";
import { Separator } from "@/components/ui/separator";
import { Mail, Phone, CreditCard, Store } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface OrderCustomerProps {
  order: IOrder & {
    customerId?: {
      _id: string;
      name: string;
      email: string;
      phone?: string;
      image?: string;
      createdAt?: string | Date;
    } | string;
    /**
     * Resolved by `GET /api/admin/orders/[id]` from the stored `posLocationId`,
     * which is a bare string and cannot be populated. Absent for online orders
     * and for a counter sale rung up on shared stock.
     */
    posLocationName?: string;
  };
}

export function OrderCustomer({ order }: OrderCustomerProps) {
  const t = useTranslations("admin");

  const customer = typeof order.customerId === 'object' ? order.customerId : null;
  const shipping = order.shippingAddress;
  const billing = order.billingAddress || shipping;
  const getAddressName = (address: typeof shipping) =>
    address.fullName ||
    [address.firstName, address.lastName].filter(Boolean).join(" ");
  // The signup year, not "now". This read `new Date().getFullYear()`, so every
  // customer on every order appeared to have joined the current year.
  const customerSinceYear = customer?.createdAt
    ? new Date(customer.createdAt).getFullYear()
    : null;

  return (
    <div className="space-y-6">
      <Card className="gap-4">
        <CardHeader>
          <CardTitle>{t("orderDetails.customer")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <Avatar className="h-12 w-12">
              <AvatarImage src={customer?.image} />
              <AvatarFallback>
                {customer?.name?.charAt(0).toUpperCase() || "C"}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="font-medium">{customer?.name || t("orderDetails.guestCheckout")}</p>
              {customerSinceYear ? (
                <p className="text-sm text-muted-foreground">
                  {t("orderDetails.customerSince")} {customerSinceYear}
                </p>
              ) : null}
            </div>
          </div>

          <Separator className="my-4" />

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-muted-foreground">{t("orderDetails.contactInfo")}</h4>
            </div>
            <div className="grid gap-2 text-sm">
              {/* Guest orders carry the checkout email on the order itself —
                  customerId points at the guest's cart and populates nothing. */}
              {(customer?.email || order.guestEmail) && (
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <a
                    href={`mailto:${customer?.email || order.guestEmail}`}
                    className="hover:underline"
                  >
                    {customer?.email || order.guestEmail}
                  </a>
                </div>
              )}
              {(customer?.phone || shipping.phone) && (
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <a href={`tel:${customer?.phone || shipping.phone}`} className="hover:underline">
                    {customer?.phone || shipping.phone}
                  </a>
                </div>
              )}
            </div>

            <Separator className="my-4" />

            {/* Digital-only checkouts never collect a shipping address —
                `shippingAddress` there is a copy of the billing address, so
                labelling it "Shipping" invents a delivery that never happens. */}
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-muted-foreground">
                {order.digitalOnly
                  ? t("orderDetails.digitalOnlyOrder")
                  : t("orderDetails.shippingAddress")}
              </h4>
            </div>
            {order.digitalOnly ? (
              <p className="text-sm text-muted-foreground">
                {t("orderDetails.noShippingRequired")}
              </p>
            ) : (
              <div className="text-sm">
                {getAddressName(shipping) ? <p>{getAddressName(shipping)}</p> : null}
                <p>{shipping.street}</p>
                {shipping.apartment ? <p>{shipping.apartment}</p> : null}
                <p>{shipping.city}, {shipping.state} {shipping.postalCode}</p>
                <p>{shipping.country}</p>
              </div>
            )}

            <Separator className="my-4" />

            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-muted-foreground">{t("orderDetails.billingAddress")}</h4>
            </div>
            <div className="text-sm">
              {getAddressName(billing) ? <p>{getAddressName(billing)}</p> : null}
              <p>{billing.street}</p>
              {billing.apartment ? <p>{billing.apartment}</p> : null}
              <p>{billing.city}, {billing.state} {billing.postalCode}</p>
              <p>{billing.country}</p>
            </div>

            <Separator className="my-4" />

             <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-muted-foreground">{t("orderDetails.payment")}</h4>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <CreditCard className="h-4 w-4 text-muted-foreground" />
              <span className="capitalize">
                {(order.paymentMethod || "").replace(/_/g, " ")}
              </span>
            </div>
            {/* An in-store sale and a web order looked identical here. Naming
                the counter matters as much as naming the channel: "POS sale" is
                true of every till the merchant runs, and a return has to be
                traced to the branch whose stock the units actually left. */}
            {order.channel === "pos" ? (
              <div className="flex items-center gap-2 text-sm">
                <Store className="h-4 w-4 text-muted-foreground" />
                <span>
                  {t("orderDetails.posSale")}
                  {order.posLocationName ? (
                    <span className="text-muted-foreground">
                      {" · "}
                      {order.posLocationName}
                    </span>
                  ) : null}
                </span>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Internal notes were captured on the order but had nowhere to surface,
          so anything a cashier or admin wrote was effectively write-only. */}
      {order.notes ? (
        <Card className="gap-4">
          <CardHeader>
            <CardTitle>{t("orderDetails.internalNotes")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {order.notes}
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
