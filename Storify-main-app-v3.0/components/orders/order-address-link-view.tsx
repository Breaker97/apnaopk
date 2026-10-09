"use client";

import { useRouter } from "@/hooks/use-locale-navigation";
import type { ComponentProps } from "react";
import { CustomerAddressHoldNotice } from "@/components/orders/customer-address-hold-notice";

/** The address-link page's form; a save re-renders the page from the server. */
export function OrderAddressLinkView(
  props: Omit<ComponentProps<typeof CustomerAddressHoldNotice>, "onChanged" | "inline">,
) {
  const router = useRouter();
  return <CustomerAddressHoldNotice {...props} inline onChanged={() => router.refresh()} />;
}
