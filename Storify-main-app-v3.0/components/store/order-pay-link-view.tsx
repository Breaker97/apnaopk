"use client";

import { useRouter } from "@/hooks/use-locale-navigation";
import { PreorderBalanceCard } from "@/components/account/preorder-balance-card";

/**
 * The payment card, on the page a "pay now" link opens.
 *
 * It exists only to hand the card a `router.refresh()` — a Server Component
 * cannot pass a function — and to pin the mode. One payment form serves this
 * page and the pre-order balance both; see the card itself for why.
 */
export function OrderPayLinkView({
  order,
  locale,
  accessToken,
}: {
  order: React.ComponentProps<typeof PreorderBalanceCard>["order"];
  locale: string;
  accessToken: string;
}) {
  const router = useRouter();
  return (
    <PreorderBalanceCard
      order={order}
      locale={locale}
      accessToken={accessToken}
      mode="order_pay"
      onPaid={() => router.refresh()}
    />
  );
}
