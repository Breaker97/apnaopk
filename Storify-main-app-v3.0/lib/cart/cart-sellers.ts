/**
 * Cart lines, grouped by who is actually selling them.
 *
 * A marketplace cart is not one order. It splits per vendor at checkout, ships
 * separately, and — the reason this exists — loses local collection entirely
 * the moment it holds two sellers, because `resolvePickupEligibility` answers
 * `multi_vendor`. Until now the shopper learned that on the checkout screen,
 * after filling in an address.
 *
 * Grouping is what makes the explanation self-evidencing: the sentence says
 * "items from 2 sellers" and the list above it shows exactly two groups.
 */

import type { CartItem } from "@/types";

type CartSellerGroup = {
  /** Absent for a line whose product was deleted after it was added. */
  vendorId?: string;
  /** Falls back to a neutral label rather than printing a raw id. */
  vendorName: string;
  items: CartItem[];
};

/**
 * Group in first-appearance order, never alphabetically.
 *
 * Groups EVERY seller with a line in the bag, including one selling only a
 * download. That is deliberately a wider set than `countCartSellers`, which
 * looks at physical lines only because that is what decides collection — so
 * these two numbers can legitimately differ, and any copy printed next to the
 * groups must count the groups, not the sellers.
 *
 * The shopper built this list; reordering it under them makes the cart look
 * like it changed on its own. Lines within a group keep their original order
 * for the same reason.
 */
export function groupCartItemsBySeller(
  items: CartItem[],
  fallbackName: string,
): CartSellerGroup[] {
  const groups = new Map<string, CartSellerGroup>();

  for (const item of items) {
    // Lines whose product is gone share one bucket rather than each becoming
    // its own nameless group — several deleted products must not look like
    // several sellers.
    const key = item.vendorId ?? "";
    const existing = groups.get(key);

    if (existing) {
      existing.items.push(item);
      continue;
    }

    groups.set(key, {
      vendorId: item.vendorId,
      vendorName: item.vendorName?.trim() || fallbackName,
      items: [item],
    });
  }

  return [...groups.values()];
}
