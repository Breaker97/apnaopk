import * as z from "zod";
import { SafeSearchSchema } from "@/lib/validations/list-query";
import { ValidationError } from "@/lib/api/errors";
import type {
  AccountEmailSkipCounts,
  AccountEmailSkipReason,
} from "@/models/account-email-job.model";
import type { AccountEmailSelection } from "@/lib/customers/account-email-recipients";
import type { AdminCustomerListFilter } from "@/lib/customers/customer-list";

/**
 * The body of the customers screen's account email calls: the rows an admin
 * ticked, or the list filter they had on — the same query string the list
 * page reads, never a list of ids for "everyone matching".
 */

const FilterSchema = z
  .object({
    search: SafeSearchSchema,
    status: z.string().max(20).optional(),
    loyaltyTier: z.enum(["bronze", "silver", "gold", "platinum"]).optional(),
    subscription: z
      .enum([
        "not_subscribed",
        "pending",
        "subscribed",
        "unsubscribed",
        "invalid",
        "redacted",
      ])
      .optional(),
    tag: z.string().max(50).optional(),
    minSpent: z.number().min(0).optional(),
    maxSpent: z.number().min(0).optional(),
  })
  .strict();

const RequestSchema = z.union([
  z.object({ profileIds: z.array(z.string().max(64)).min(1).max(500) }).strict(),
  z.object({ filter: FilterSchema }).strict(),
]);

/** Whether a filter narrows the list at all. "All" plus nothing is everyone. */
export function isNarrowingFilter(filter: AdminCustomerListFilter): boolean {
  return Boolean(
    filter.search ||
      (filter.status && filter.status !== "all") ||
      filter.loyaltyTier ||
      filter.subscription ||
      filter.tag ||
      filter.minSpent !== undefined ||
      filter.maxSpent !== undefined,
  );
}

export function parseAccountEmailSelection(body: unknown): AccountEmailSelection {
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Pick some customers, or a filter to send to.");
  }
  if ("profileIds" in parsed.data) return { profileIds: parsed.data.profileIds };
  const filter = parsed.data.filter;
  // Every customer the store has is a send of its own kind, and not one this
  // screen offers: "Send to all matching" appears only while a filter is on.
  if (!isNarrowingFilter(filter)) {
    throw new ValidationError("Choose a tag or filter before sending to everyone it matches.");
  }
  return { filter };
}

/** What the single-customer button answers when the customer is left out. */
export const ACCOUNT_EMAIL_REFUSAL_MESSAGES: Record<
  AccountEmailSkipReason | "missing",
  string
> = {
  nonCustomer: "This account belongs to a seller or a team member.",
  banned: "This customer is banned.",
  inactive: "This customer's account is inactive.",
  noEmail: "This customer has no email address.",
  recent: "An account email went to this customer less than 15 minutes ago.",
  duplicate: "This customer was listed twice.",
  missing: "Customer not found",
};

export function totalSkipped(skipped: AccountEmailSkipCounts): number {
  return Object.values(skipped).reduce((sum, count) => sum + (count ?? 0), 0);
}
