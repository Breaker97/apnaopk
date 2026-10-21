import "server-only";
import { Types } from "mongoose";
import { Vendor, VendorRepayment } from "@/models";
import { ValidationError } from "@/lib/api/errors";
import { quantizeToCurrency } from "@/lib/intl/money";
import { audit, type AuditContext } from "@/lib/audit";
import { fetchVendorOverpaymentBalance } from "@/lib/vendors/vendor-earnings";
import { VENDOR_REPAYMENT_ACCOUNTS } from "@/models/vendorRepayment.model";
import { financeQuery, financeSession } from "./transaction";
import { runFinanceOperation, staleFinance, touchVendorFinance } from "./operations";
import { vendorRepaymentPostings } from "./postings";
import type { LedgerPosting } from "./ledger";

/**
 * Recording money a seller paid back by hand.
 *
 * Capped at what they owe back right now, in that currency: a repayment larger
 * than the debt would turn into money the store owes them, with no payout
 * behind it to carry it.
 */
export async function recordVendorRepayment(input: {
  vendorId: string;
  currency: string;
  amount: number;
  receivedInto: string;
  reference?: string;
  note?: string;
  receivedAt?: string;
  actorId: string;
  requestKey: string;
  auditContext: AuditContext;
}) {
  if (!Types.ObjectId.isValid(input.vendorId)) throw new ValidationError("Valid vendorId is required");
  const currency = String(input.currency || "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new ValidationError({ currency: ["Choose a valid currency"] });
  if (!(VENDOR_REPAYMENT_ACCOUNTS as readonly string[]).includes(input.receivedInto)) {
    throw new ValidationError({ receivedInto: ["Choose bank, cash or gateway"] });
  }
  const amount = quantizeToCurrency(Number(input.amount), currency);
  if (!(amount > 0)) throw new ValidationError({ amount: ["Enter the amount received"] });
  const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
  if (!Number.isFinite(receivedAt.getTime()) || receivedAt > new Date()) {
    throw new ValidationError({ receivedAt: ["Choose the day the money arrived"] });
  }

  return runFinanceOperation({
    action: "repayment:create",
    actorId: input.actorId,
    requestKey: input.requestKey,
    fingerprint: { vendorId: input.vendorId, currency, amount, receivedInto: input.receivedInto, reference: input.reference, note: input.note, receivedAt: input.receivedAt },
    work: async () => {
      const vendor = await financeQuery(Vendor.findById(input.vendorId)).select("storeName").lean<{ storeName?: string } | null>();
      if (!vendor) throw new ValidationError("Vendor not found");
      await touchVendorFinance(input.vendorId, currency);
      const owed = await fetchVendorOverpaymentBalance({ vendorId: input.vendorId, currency });
      if (amount > owed) {
        throw new ValidationError({ amount: [owed > 0 ? `This seller owes back ${owed} ${currency}` : "This seller owes nothing back in this currency"] });
      }
      const [repayment] = await VendorRepayment.create([{
        vendorId: new Types.ObjectId(input.vendorId), currency, amount, receivedInto: input.receivedInto,
        reference: input.reference?.trim() || undefined, note: input.note?.trim() || undefined, receivedAt,
        status: "recorded", createdBy: input.actorId,
      }], { session: financeSession() });
      const postings: LedgerPosting[] = vendorRepaymentPostings(repayment.toObject());
      await audit(input.auditContext, {
        action: "CREATE",
        resource: "payout",
        resourceId: String(repayment._id),
        resourceName: `Repayment from ${vendor.storeName || "a seller"}`,
        changes: {
          after: { vendorId: input.vendorId, currency, amount, receivedInto: input.receivedInto, reference: input.reference ?? null },
          summary: `${vendor.storeName || "A seller"} paid back ${amount} ${currency} by ${input.receivedInto}`,
        },
      });
      return { result: { repaymentId: String(repayment._id), amount, currency }, postings, sourceId: repayment._id, vendorId: input.vendorId };
    },
  });
}

/** Undo a repayment recorded by mistake, or one whose money bounced. */
export async function voidVendorRepayment(input: {
  vendorId: string;
  repaymentId: string;
  reason: string;
  actorId: string;
  requestKey: string;
  auditContext: AuditContext;
}) {
  if (!input.reason?.trim()) throw new ValidationError({ reason: ["Say why it is being undone"] });
  return runFinanceOperation({
    action: `repayment:void:${input.repaymentId}`,
    actorId: input.actorId,
    requestKey: input.requestKey,
    fingerprint: { reason: input.reason },
    work: async () => {
      const repayment = await financeQuery(VendorRepayment.findOne({ _id: input.repaymentId, vendorId: input.vendorId }));
      if (!repayment) throw new ValidationError("Repayment not found");
      if (repayment.status !== "recorded") throw staleFinance();
      await touchVendorFinance(input.vendorId, repayment.currency);
      const now = new Date();
      repayment.status = "voided"; repayment.voidedAt = now; repayment.voidedBy = input.actorId; repayment.voidReason = input.reason.trim();
      await repayment.save({ session: financeSession() });
      const postings = vendorRepaymentPostings(repayment.toObject()).map((entry) => ({
        ...entry, date: now, debit: entry.credit, credit: entry.debit, key: `${entry.key}:reversal`, note: "Repayment undone",
      }));
      await audit(input.auditContext, {
        action: "UPDATE",
        resource: "payout",
        resourceId: String(repayment._id),
        resourceName: "Seller repayment",
        changes: { before: { status: "recorded" }, after: { status: "voided", reason: input.reason.trim() }, summary: `A repayment of ${repayment.amount} ${repayment.currency} was undone: ${input.reason.trim()}` },
      });
      return { result: { repaymentId: String(repayment._id) }, postings, sourceId: repayment._id, vendorId: input.vendorId };
    },
  });
}

/** The recorded repayments, newest first, for the admin's vendor screen. */
export async function listVendorRepayments(vendorId: string, currency?: string) {
  return VendorRepayment.find({ vendorId, ...(currency ? { currency: currency.toUpperCase() } : {}) })
    .sort({ receivedAt: -1, _id: -1 })
    .limit(50)
    .lean();
}
