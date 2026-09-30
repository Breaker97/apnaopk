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
 * one that matches the uptime of a cron. Whether a template dated in the past
 * owes its past is decided when it is switched on (`nextDueAt`), not here.
 *
 * The calendar arithmetic lives in `recurring-schedule`, which the form shares.
 */

import { Types } from "mongoose";
import { Expense } from "@/models/expense.model";
import { postExpense } from "@/lib/finance/post-events";
import {
  dueDateFor,
  nextOccurrence,
  type RecurringInterval,
} from "@/lib/finance/recurring-schedule";

export { dueDateFor, nextOccurrence };

/** A second insert of the same copy, refused by the unique index. */
function isDuplicateKey(error: unknown): boolean {
  return (error as { code?: number } | null)?.code === 11000;
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
    const endsAt = template.recurring?.endsAt ?? null;
    let due = dueDateFor(template);
    let madeForThisTemplate = 0;

    while (
      due <= now &&
      (!endsAt || due <= endsAt) &&
      madeForThisTemplate < maxPerTemplate
    ) {
      // One copy per template per due date. The check skips the work on a
      // re-run; the unique index on (template, date) is what actually holds
      // when two runs overlap, since a check and an insert are two steps.
      const exists = await Expense.exists({
        "recurring.templateId": template._id,
        date: due,
      });

      if (!exists) {
        try {
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
            // start generating its own children and the store would drown. It
            // does not inherit a payment either: each month's bill is paid on
            // its own.
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
        } catch (error) {
          // Another run made this copy between the check and the insert.
          if (!isDuplicateKey(error)) throw error;
        }
      }

      due = nextOccurrence(due, interval, anchorDay);
      madeForThisTemplate += 1;
    }

    // Move the clock forward even when nothing was created, so a template whose
    // copies already exist is not re-examined on every tick forever. A series
    // past its end date is switched off, so the list stops calling it one.
    const ended = Boolean(endsAt && due > endsAt);
    await Expense.updateOne(
      { _id: template._id },
      {
        $set: {
          "recurring.nextDueAt": due,
          ...(ended ? { "recurring.enabled": false } : {}),
        },
      },
    );
  }

  return { templates: templates.length, created };
}
