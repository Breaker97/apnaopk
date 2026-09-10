import { Types } from "mongoose";
import { z } from "zod";
import { LedgerEntry, LEDGER_SOURCE_KIND } from "@/models/ledger-entry.model";
import { getSettings } from "@/models/settings.model";
import { successResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { validateBody, validateQuery } from "@/lib/api/validate";
import { CreateAdjustmentSchema } from "@/lib/validations";
import { auditCreate, createAuditContext } from "@/lib/audit";
import { currencyMinimumPrice, quantizeToCurrency } from "@/lib/intl/money";
import { postAdjustment } from "@/lib/finance/post-events";
import { getLedgerCurrencies } from "@/lib/finance/reports";
import { LEDGER_ACCOUNT, LEDGER_BOOK } from "@/lib/finance/accounts";

const AdjustmentListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * GET /api/admin/finance/adjustments
 *
 * The corrections that have been posted, newest first. Read straight off the
 * ledger rather than from a table of its own: the entry IS the adjustment, and
 * a second copy of it in another collection is a second thing that can disagree
 * with the balance it was written to explain.
 */
export const GET = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:finance:adjustments:list", preset: "lenient" },
  },
  async ({ request }) => {
    const query = validateQuery(request, AdjustmentListQuerySchema);
    const entries = await LedgerEntry.find({
      "source.kind": LEDGER_SOURCE_KIND.ADJUSTMENT,
    })
      .sort({ date: -1, _id: -1 })
      .limit(query.limit)
      .lean();

    return successResponse(entries);
  },
);

/**
 * POST /api/admin/finance/adjustments
 *
 * Post a correcting or transferring entry by hand.
 *
 * The two things this exists for, and neither had any other way in:
 *
 * Money the platform moved between its own accounts. Settling a gateway balance
 * into a bank account happens at the bank, and nothing here hears about it — so
 * `cash_bank` was only ever credited, by payouts and carrier labels, and could
 * do nothing but fall below zero.
 *
 * A balance that has gone impossible. A liability below zero means more was
 * handed over than was ever owed. The entries behind it are facts and the
 * ledger is append-only, so what resolves it is another entry, not an edit.
 *
 * Posted in the same request rather than fire-and-forget, for the same reason
 * an expense is: the entry is the entire point of the call, so failing to write
 * it is failing to do what was asked, and the admin should hear so.
 */
export const POST = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:finance:adjustments:create", preset: "moderate" },
    // Blocked on a demo. Every other finance write is either reversible or
    // ordinary business data; this one writes an unmediated entry to the books.
    demo: "block-mutations",
  },
  async ({ request, session }) => {
    const body = await validateBody(request, CreateAdjustmentSchema);

    if (body.debit === body.credit) {
      throw new ValidationError({
        credit: ["An entry has to move between two different accounts"],
      });
    }

    /**
     * A vendor account cannot be moved without naming the vendor.
     *
     * The two screens that report these balances read them differently: the
     * overview sums every entry, while Receivables and the vendor's own
     * statement filter on `vendorId`. So an unattributed correction moves the
     * headline figure and leaves the per-vendor rows — the ones that are
     * actually wrong — untouched, and the two screens start disagreeing about
     * the same money. Refused rather than defaulted: there is no sensible
     * vendor to guess.
     */
    const VENDOR_ACCOUNTS: readonly string[] = [
      LEDGER_ACCOUNT.VENDOR_PAYABLE,
      LEDGER_ACCOUNT.COMMISSION_RECEIVABLE,
    ];
    const touchesVendorAccount =
      VENDOR_ACCOUNTS.includes(body.debit) ||
      VENDOR_ACCOUNTS.includes(body.credit);
    if (touchesVendorAccount && !body.vendorId) {
      throw new ValidationError({
        vendorId: [
          "Choose the vendor — this entry moves a balance that is reported per vendor",
        ],
      });
    }

    const settings = await getSettings();
    const storeCurrency = (
      settings.general?.defaultCurrency || "USD"
    ).toUpperCase();
    const currency = (body.currency || storeCurrency).toUpperCase();

    // A currency the books have never held is a typo, not a correction: posting
    // in it opens a fresh balance in a denomination nothing else uses, while
    // the balance that was actually wrong stays wrong. The store's own currency
    // is always allowed — it is where a first entry would legitimately land.
    if (currency !== storeCurrency) {
      const known = await getLedgerCurrencies();
      if (!known.includes(currency)) {
        throw new ValidationError({
          currency: [
            known.length
              ? `The ledger holds ${known.join(", ")} — nothing is recorded in ${currency}`
              : `Nothing is recorded in ${currency}`,
          ],
        });
      }
    }

    // Same floor as an expense: store only what the currency can express, then
    // refuse what rounds away to nothing. A zero-decimal currency turns 0.4
    // into 0, and an adjustment of zero moves no balance while looking on the
    // audit trail exactly like one that did.
    const amount = quantizeToCurrency(body.amount, currency);
    if (amount < currencyMinimumPrice(currency)) {
      throw new ValidationError({
        amount: [
          `Amount must be at least ${currencyMinimumPrice(currency)} ${currency}`,
        ],
      });
    }

    // A marketplace-scoped correction only makes sense on a marketplace, the
    // same rule an expense follows — otherwise a single-vendor store grows a
    // second book its own finance screens never show it.
    const multiVendor = Boolean(settings.multiVendorMode?.enabled);
    const book =
      multiVendor && body.book === LEDGER_BOOK.MARKETPLACE
        ? LEDGER_BOOK.MARKETPLACE
        : LEDGER_BOOK.OWN;

    // The id is generated here and carried into the posting key, so the entry
    // is addressable afterwards and two submissions of the same correction are
    // two entries rather than one silently swallowed by the unique index — a
    // hand-entered adjustment repeated on purpose is a legitimate thing to do.
    const adjustmentId = new Types.ObjectId();
    // Kept whenever it was supplied. Gating it on `multiVendor` would drop the
    // id the check above just insisted on, on a store that had switched the
    // flag off after accruing vendor balances.
    const vendorId = body.vendorId ? new Types.ObjectId(body.vendorId) : null;

    await postAdjustment({
      _id: adjustmentId,
      date: body.date,
      book,
      debit: body.debit,
      credit: body.credit,
      amount,
      currency,
      vendorId,
      reason: body.reason.trim(),
    });

    const record = {
      _id: String(adjustmentId),
      date: body.date,
      book,
      debit: body.debit,
      credit: body.credit,
      amount,
      currency,
      vendorId: vendorId ? String(vendorId) : null,
      reason: body.reason.trim(),
    };

    const auditContext = createAuditContext(request, session);
    await auditCreate(
      auditContext,
      "ledgerAdjustment",
      String(adjustmentId),
      record as unknown as Record<string, unknown>,
    );

    return successResponse(record, "Adjustment posted", 201);
  },
);
