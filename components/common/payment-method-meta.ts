import {
  Banknote,
  CreditCard,
  Smartphone,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { useTranslations } from "next-intl";

/**
 * The label and icon an order's payment method is shown with — the admin and
 * vendor dashboards' recent-orders cards and every order detail page. A raw
 * `capitalize` of the stored value read "Cod".
 *
 * Shared with the storefront account page, so its message sub-trees are in
 * `STOREFRONT_BACK_OFFICE_PATHS` (lib/i18n/surface-messages.ts).
 *
 * Cash on delivery and cash taken at the register are different things, and
 * both used to read "Cash on Delivery" — so every POS cash sale was labelled as
 * a delivery.
 */
export function getPaymentMethodMeta(
  t: ReturnType<typeof useTranslations>,
  paymentMethod?: string,
): { label: string; Icon: LucideIcon } {
  const key = (paymentMethod || "card").toLowerCase();

  if (key.includes("cod")) {
    return {
      label: t("admin.dashboardPage.payment.cashOnDelivery"),
      Icon: Banknote,
    };
  }
  if (key.includes("cash")) {
    return {
      label: t("admin.paymentTransactionsPage.providers.cash"),
      Icon: Banknote,
    };
  }
  if (key.includes("card")) {
    return { label: t("admin.dashboardPage.payment.creditCard"), Icon: CreditCard };
  }
  if (key === "stripe") return { label: "Stripe", Icon: CreditCard };
  if (key.includes("paypal")) {
    return { label: t("admin.dashboardPage.payment.paypal"), Icon: Wallet };
  }
  if (key.includes("razorpay")) return { label: "Razorpay", Icon: Wallet };
  if (key.includes("paystack")) return { label: "Paystack", Icon: Wallet };
  if (key.includes("pesapal")) return { label: "Pesapal", Icon: Wallet };
  if (key.includes("iotec")) return { label: "ioTec Pay", Icon: Wallet };
  if (key.includes("orange_money")) {
    return { label: "Orange Money", Icon: Smartphone };
  }
  if (key.includes("mtn_momo")) return { label: "MTN MoMo", Icon: Smartphone };
  if (key === "manual" || key === "manual_pending") {
    return {
      label: t(`admin.paymentTransactionsPage.providers.${key}`),
      Icon: Wallet,
    };
  }
  if (key.includes("upi")) {
    return { label: t("admin.dashboardPage.payment.upi"), Icon: Smartphone };
  }
  return {
    label: paymentMethod
      ? humanizeMethod(paymentMethod)
      : t("admin.dashboardPage.payment.card"),
    Icon: CreditCard,
  };
}

/** "bank_transfer" → "Bank Transfer", for a method with no label of its own. */
function humanizeMethod(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
