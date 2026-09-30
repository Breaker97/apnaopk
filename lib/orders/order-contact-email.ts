import { isValidObjectId } from "mongoose";
import { User } from "@/models";

/**
 * The address an order was placed under: the guest's own, or the account's.
 *
 * An order stores an email only for a guest (`guestEmail`); a signed-in
 * shopper's lives on their account, reached through `customerId`. Code that
 * read a `customerEmail` off the order found nothing for every registered
 * shopper — there is no such field — so they were never sent the "Payment
 * needed" email, an admin could not send them a pay link, and paying one
 * brought them no confirmation. A guest order's `customerId` is its cart, so
 * the account lookup finds nothing there and the guest address is the only
 * one.
 *
 * Never throws: an address that cannot be found must not fail whatever asked
 * for it — least of all a captured payment.
 */
export async function orderContactEmail(order: {
  guestEmail?: string | null;
  customerId?: unknown;
}): Promise<string | undefined> {
  const guestEmail = String(order.guestEmail || "").trim();
  if (guestEmail) return guestEmail;
  const customerId = String(order.customerId || "");
  if (!customerId || !isValidObjectId(customerId)) return undefined;
  try {
    const user = await User.findById(customerId)
      .select("email")
      .lean<{ email?: string } | null>();
    return user?.email?.trim() || undefined;
  } catch (err) {
    console.error("Failed to look up the order's account email:", err);
    return undefined;
  }
}
