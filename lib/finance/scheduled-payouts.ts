import "server-only";
import { Types } from "mongoose";
import { Payout, Vendor, getSettings } from "@/models";
import { ScheduledPayoutRun } from "@/models/scheduledPayoutRun.model";
import { VENDOR_STATUS } from "@/config/app.config";
import { createSystemAuditContext } from "@/lib/audit";
import { getExternalVendorFilter } from "@/lib/vendors/multi-vendor";
import { createPayout, listPayoutCurrencies, quotePayout } from "./payout-service";

/**
 * Payouts drawn up on each seller's own schedule.
 *
 * A seller picks weekly, every two weeks or monthly in their settings, and a
 * minimum. Nothing used to read either — every payout waited for an admin to
 * remember. On the seller's day this prepares the payout (status `pending`),
 * exactly as an admin pressing Create would; the store still sends the money
 * and marks it paid.
 *
 * A run has a time budget, and a store with many sellers may not get through
 * them all on the day. So a payout day is picked up for a few days after it
 * (`SCHEDULE_CATCH_UP_DAYS`), and each seller done for that day is marked
 * (`ScheduledPayoutRun`): the next run skips them and carries on with those
 * that have no mark. Idempotent per seller, currency and payout day (the
 * request key), so nothing is ever drawn up twice.
 */

export type PayoutSchedule = "weekly" | "biweekly" | "monthly";

const DAY_MS = 24 * 60 * 60 * 1000;
/** A Monday, from which "every other Monday" is counted. */
const BIWEEKLY_EPOCH = Date.UTC(2024, 0, 1);
/** How many days a payout day, and the day after it, are still picked up. */
export const SCHEDULE_CATCH_UP_DAYS = 3;

/** Whether `date` (read in UTC) is a payout day for this schedule. */
export function isPayoutDay(schedule: string | null | undefined, date: Date): boolean {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  switch (schedule) {
    case "monthly":
      return day.getUTCDate() === 1;
    case "biweekly": {
      if (day.getUTCDay() !== 1) return false;
      const weeks = Math.round((day.getTime() - BIWEEKLY_EPOCH) / (7 * DAY_MS));
      return weeks % 2 === 0;
    }
    case "weekly":
    default:
      return day.getUTCDay() === 1;
  }
}

/**
 * The payout day (`YYYY-MM-DD`, UTC) this run is still working on for a
 * schedule: today if it is one, else the latest one within the catch-up days.
 */
export function latestPayoutDay(
  schedule: string | null | undefined,
  now: Date,
  catchUpDays = SCHEDULE_CATCH_UP_DAYS,
): string | null {
  for (let back = 0; back < catchUpDays; back++) {
    const day = new Date(now.getTime() - back * DAY_MS);
    if (isPayoutDay(schedule, day)) return day.toISOString().slice(0, 10);
  }
  return null;
}

/**
 * The calendar day before a payout day, in UTC: a scheduled payout covers
 * sales up to it, whichever day within the catch-up days the run happens on.
 * Given a date rather than a day, the day before that date.
 */
export function scheduledPeriodEnd(dueDay: Date | string): string {
  const due = typeof dueDay === "string" ? new Date(`${dueDay}T00:00:00Z`) : dueDay;
  return new Date(due.getTime() - DAY_MS).toISOString().slice(0, 10);
}

export type ScheduledPayoutOutcome = {
  created: Array<{ vendorId: string; currency: string; payoutId: string }>;
  skipped: Array<{ vendorId: string; currency?: string; reason: string }>;
  stoppedEarly: boolean;
};

export async function runScheduledPayouts(params: { now?: Date; budgetMs?: number } = {}): Promise<ScheduledPayoutOutcome> {
  const now = params.now ?? new Date();
  const started = Date.now();
  const budgetMs = params.budgetMs ?? 45_000;
  const outcome: ScheduledPayoutOutcome = { created: [], skipped: [], stoppedEarly: false };
  const overBudget = () => Date.now() - started > budgetMs;

  const settings = await getSettings();
  if (!settings.multiVendorMode?.enabled) return outcome;
  if (settings.orders?.commission?.autoPayoutDrafts === false) return outcome;
  const storeCurrency = String(settings.general?.defaultCurrency || "USD").toUpperCase();

  let lastId: Types.ObjectId | null = null;
  for (;;) {
    const vendors: Array<{
      _id: Types.ObjectId;
      payoutSettings?: { schedule?: string; minimumAmount?: number } | null;
    }> = await Vendor.find({
      ...getExternalVendorFilter(),
      status: VENDOR_STATUS.APPROVED,
      ...(lastId ? { _id: { $gt: lastId } } : {}),
    })
      .select("_id payoutSettings")
      .sort({ _id: 1 })
      .limit(200)
      .lean();
    if (vendors.length === 0) break;
    lastId = vendors[vendors.length - 1]._id;

    // Whose payout day this run is still on, and which of them are already done
    // for it — in one read per payout day rather than one per seller.
    const dueDayOf = new Map<string, string>();
    const idsByDay = new Map<string, Types.ObjectId[]>();
    for (const vendor of vendors) {
      const dueDay = latestPayoutDay(vendor.payoutSettings?.schedule, now);
      if (!dueDay) continue;
      dueDayOf.set(String(vendor._id), dueDay);
      idsByDay.set(dueDay, [...(idsByDay.get(dueDay) ?? []), vendor._id]);
    }
    const done = new Set<string>();
    for (const [dueDay, ids] of idsByDay) {
      const marks: Array<{ vendorId: unknown }> = await ScheduledPayoutRun.find({ dueDay, vendorId: { $in: ids } })
        .select("vendorId")
        .lean();
      for (const mark of marks) done.add(`${dueDay}:${String(mark.vendorId)}`);
    }

    for (const vendor of vendors) {
      if (overBudget()) {
        outcome.stoppedEarly = true;
        return outcome;
      }
      const vendorId = String(vendor._id);
      const dueDay = dueDayOf.get(vendorId);
      if (!dueDay || done.has(`${dueDay}:${vendorId}`)) continue;
      const periodEnd = scheduledPeriodEnd(dueDay);

      let currencies: string[];
      let openCurrencies: Set<string>;
      try {
        currencies = await listPayoutCurrencies(vendorId);
        openCurrencies = new Set(
          (await Payout.distinct("currency", { vendorId: vendor._id, status: { $in: ["pending", "processing"] } })).map((code: unknown) => String(code).toUpperCase()),
        );
      } catch (error) {
        outcome.skipped.push({ vendorId, reason: error instanceof Error ? error.message : "quote failed" });
        continue;
      }

      // Marked once every currency is dealt with. A seller cut off by the budget
      // half-way, or one whose draft failed for a reason that may pass, is left
      // unmarked so the next run takes them again.
      let finished = true;
      let created = 0;
      let skipped = 0;
      for (const currency of currencies) {
        if (overBudget()) {
          outcome.stoppedEarly = true;
          return outcome;
        }
        // One payout at a time per seller and currency: an open one is still
        // the admin's to send, and a second would only take what is left. Found
        // without a quote, which scans the seller's orders.
        if (openCurrencies.has(currency)) {
          outcome.skipped.push({ vendorId, currency, reason: "A payout is already open" });
          skipped++;
          continue;
        }
        try {
          const quote = await quotePayout({ vendorId, currency, periodEnd, now });
          // The seller's own minimum, in the store's currency, on top of the store's.
          const sellerMinimum =
            currency === storeCurrency ? Math.max(0, Number(vendor.payoutSettings?.minimumAmount) || 0) : 0;
          if (!quote.canCreate) {
            outcome.skipped.push({ vendorId, currency, reason: quote.eligibilityReason || "Not eligible" });
            skipped++;
            continue;
          }
          // The minimum is about money leaving; a payout that sends nothing has none.
          if (!quote.settlesWithoutTransfer && quote.netAmount < sellerMinimum) {
            outcome.skipped.push({ vendorId, currency, reason: "Below the seller's own minimum" });
            skipped++;
            continue;
          }
          const draft = await createPayout({
            vendorId,
            currency,
            periodEnd,
            note: `Prepared on the seller's ${vendor.payoutSettings?.schedule || "weekly"} payout schedule`,
            requestKey: `schedule:${vendorId}:${currency}:${dueDay}`,
            actorId: "system",
            expectedCalculationVersion: quote.calculationVersion,
            auditContext: createSystemAuditContext(),
          });
          const data = draft.data as { payoutId?: string };
          outcome.created.push({ vendorId, currency, payoutId: String(data.payoutId || "") });
          created++;
        } catch (error) {
          outcome.skipped.push({ vendorId, currency, reason: error instanceof Error ? error.message : "create failed" });
          finished = false;
        }
      }
      if (finished) {
        await ScheduledPayoutRun.updateOne(
          { dueDay, vendorId: vendor._id },
          { $set: { created, skipped, doneAt: now } },
          { upsert: true },
        );
      }
    }
  }
  return outcome;
}
