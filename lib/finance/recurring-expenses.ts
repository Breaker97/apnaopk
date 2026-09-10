/**
 * Recurring expenses: the copies a template owes.
 *
 * Rent, salaries and hosting arrive on a schedule, and re-typing them every
 * month is how a store's costs quietly stop being recorded. A template is just
 * an expense with `recurring.enabled`; this creates the next copy when it falls
 * due and moves the template's clock forward.
 *
 * **Catches up rather than skipping.** A store whose cron was down for two
 * months gets both months, each dated when it was actually due — not one row
 * dated today. That is the difference between a ledger that matches reality and
 * one that matches the uptime of a cron.
 */

import { Types } from "mongoose";
import { Expense } from "@/models/expense.model";
import { postExpense } from "@/lib/finance/post-events";

type RecurringInterval = "weekly" | "monthly" | "quarterly" | "yearly";

/**
 * The next occurrence after `from`. Months step by calendar, not by 30 days.
 *
 * `anchorDay` is the day of the month the template was set up on, and it has to
 * be passed along the whole chain rather than read off the previous occurrence.
 * Rent due on the 31st falls to the 28th in February — that part is unavoidable
 * — but if the next step then measures from the 28th, the 31st is gone for
 * good and the template quietly pays on the 28th for the rest of its life. The
 * anchor is what lets it climb back to the 31st in March.
 */
export function nextOccurrence(
  from: Date,
  interval: RecurringInterval,
  anchorDay = from.getUTCDate(),
): Date {
  if (interval === "weekly") {
    // A week is always seven days; no month-end reasoning applies.
    const next = new Date(from);
    next.setUTCDate(next.getUTCDate() + 7);
    return next;
  }
  const months = interval === "quarterly" ? 3 : interval === "yearly" ? 12 : 1;
  return addMonths(from, months, anchorDay);
}

/**
 * `from` plus `months`, landing on `anchorDay` or the last day of that month.
 *
 * Built from the target month rather than by nudging the date, because
 * `setUTCMonth` overflows: 31 January plus a month is 3 March, since February
 * has no 31st. Asking the target month how many days it has and taking the
 * smaller of the two is what a calendar means by "monthly".
 */
function addMonths(from: Date, months: number, anchorDay: number): Date {
  const target = new Date(
    Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth() + months,
      1,
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
      from.getUTCMilliseconds(),
    ),
  );
  // Day 0 of the following month is the last day of this one.
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(anchorDay, lastDay));
  return target;
}

/** A template that has never run is due one interval after its own date. */
export function dueDateFor(template: {
  date: Date;
  recurring?: { interval?: RecurringInterval; nextDueAt?: Date | null } | null;
}): Date {
  const interval = template.recurring?.interval ?? "monthly";
  return (
    template.recurring?.nextDueAt ?? nextOccurrence(template.date, interval)
  );
}

/**
 * Create every copy that has fallen due, up to `now`.
 *
 * `maxPerTemplate` bounds the catch-up: a template dated years ago with the
 * feature only just switched on would otherwise mint a hundred rows in one
 * tick. Whatever is left is created by the next run, which is slow but never
 * surprising.
 */
export async function runRecurringExpenses(
  now = new Date(),
  { limit = 100, maxPerTemplate = 12 } = {},
): Promise<{ templates: number; created: number }> {
  const templates = await Expense.find({
    "recurring.enabled": true,
    scope: { $ne: "vendor" },
  })
    // Most overdue first. `limit` is a per-tick ceiling, and without an order
    // the same arbitrary hundred would be returned every run — a store past the
    // ceiling would have the same templates skipped forever rather than caught
    // up on the next tick.
    .sort({ "recurring.nextDueAt": 1, _id: 1 })
    .limit(limit)
    .lean();

  let created = 0;

  for (const template of templates) {
    const interval = (template.recurring?.interval ??
      "monthly") as RecurringInterval;
    // The day the merchant actually set up, carried through every step. Taking
    // it from the previous occurrence instead lets one February pull a rent
    // template down to the 28th permanently.
    const anchorDay = template.date.getUTCDate();
    let due = dueDateFor(template);
    let madeForThisTemplate = 0;

    while (due <= now && madeForThisTemplate < maxPerTemplate) {
      // Idempotent by construction: one copy per template per due date, so a
      // tick that runs twice — or a retry after a crash mid-loop — collides on
      // the same query rather than duplicating a month's rent.
      const exists = await Expense.exists({
        "recurring.templateId": template._id,
        date: due,
      });

      if (!exists) {
        const copy = await Expense.create({
          date: due,
          book: template.book,
          scope: "platform",
          category: template.category,
          amount: template.amount,
          currency: template.currency,
          description: template.description,
          payee: template.payee ?? null,
          paidFrom: template.paidFrom,
          vendorId: template.vendorId ?? null,
          note: template.note ?? null,
          // Copied, not re-derived: a copy must post to the same account its
          // template did, or a stock template would start splitting its costs
          // across two accounts the day the mapping is touched.
          debitAccount: template.debitAccount ?? "operating_expense",
          // The copy is NOT itself a template — otherwise every month would
          // start generating its own children and the store would drown.
          recurring: {
            enabled: false,
            interval,
            nextDueAt: null,
            templateId: template._id as Types.ObjectId,
          },
          createdBy: template.createdBy,
        });

        await postExpense({
          _id: copy._id,
          date: copy.date,
          book: copy.book,
          category: copy.category,
          amount: copy.amount,
          currency: copy.currency,
          description: copy.description,
          paidFrom: copy.paidFrom,
          vendorId: copy.vendorId,
          revision: 0,
          debitAccount: copy.debitAccount,
        });
        created += 1;
      }

      due = nextOccurrence(due, interval, anchorDay);
      madeForThisTemplate += 1;
    }

    // Move the clock forward even when nothing was created, so a template whose
    // copies already exist is not re-examined on every tick forever.
    await Expense.updateOne(
      { _id: template._id },
      { $set: { "recurring.nextDueAt": due } },
    );
  }

  return { templates: templates.length, created };
}
