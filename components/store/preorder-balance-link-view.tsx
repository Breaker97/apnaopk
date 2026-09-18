"use client";

import { useRouter } from "next/navigation";
import { PreorderBalanceCard } from "@/components/account/preorder-balance-card";

/**
 * The balance card, on the page a signed link opens.
 *
 * It exists only to hand the card a `router.refresh()` — a Server Component
 * cannot pass a function — and to keep the public page otherwise identical to
 * the one inside the account. One payment form, two ways of reaching it: a
 * second implementation would be a second place for a money bug to live.
 */
export function PreorderBalanceLinkView({
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
      onPaid={() => router.refresh()}
    />
  );
}
