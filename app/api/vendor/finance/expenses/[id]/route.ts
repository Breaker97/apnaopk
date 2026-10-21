import * as z from "zod";
import { Expense } from "@/models/expense.model";
import { withApi } from "@/lib/api/handler";
import { AuthorizationError, NotFoundError, ValidationError } from "@/lib/api/errors";
import { successResponse } from "@/lib/api/response";
import { isValidObjectId, validateBody } from "@/lib/api/validate";
import { UpdateExpenseSchema } from "@/lib/validations";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { hasVendorPermission, isAdmin } from "@/lib/access/rbac";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { audit, createAuditContext } from "@/lib/audit";
import { auditExpenseUpdated } from "@/lib/finance/audit-expense";
import { expectedVersion, mutationKey, runFinanceOperation, staleFinance } from "@/lib/finance/operations";
import { financeQuery, financeVersionFilter } from "@/lib/finance/transaction";
import { currencyMinimumPrice, quantizeToCurrency } from "@/lib/intl/money";

const EditSchema = UpdateExpenseSchema.pick({ date: true, category: true, amount: true, description: true, payee: true })
  .strict().refine(body => Object.keys(body).length > 0, "Choose a field to change");
const VoidSchema = z.object({ reason: z.string().trim().min(3, "Say why this expense is being voided").max(500) }).strict();

function expenseMutation(action: "edit" | "void") {
  return withApi<{ id: string }>({ auth: "user", rateLimit: { action: `vendor:expenses:${action}`, preset: "moderate" } }, async ({ request, params, session }) => {
    if (!(await hasVendorPermission(session.user, VENDOR_PERMISSIONS.MANAGE_PAYOUTS)) && !isAdmin(session.user)) {
      throw new AuthorizationError("You do not have permission to manage expenses");
    }
    const vendor = await requireApprovedVendorByUserId(session.user.id);
    if (!isValidObjectId(params.id)) throw new NotFoundError("Expense");
    if (!request.headers.has("if-match")) throw new ValidationError("Reload the expense before changing it");
    const version = expectedVersion(request, 0);
    const edit = action === "edit" ? await validateBody(request, EditSchema) : null;
    const reason = action === "void" ? (await validateBody(request, VoidSchema)).reason : undefined;
    const context = createAuditContext(request, session, { vendorId: vendor._id });

    const outcome = await runFinanceOperation({
      action: `vendor:expense:${action}:${params.id}`, actorId: session.user.id, requestKey: mutationKey(request),
      fingerprint: { vendorId: String(vendor._id), version, edit, reason },
      work: async () => {
        const ownership = { _id: params.id, vendorId: vendor._id, scope: "vendor" as const };
        const original = await financeQuery(Expense.findOne(ownership)).lean();
        if (!original) throw new NotFoundError("Expense");
        if (original.voidedAt || (original.version ?? 0) !== version) throw staleFinance();
        const changes = { ...edit };
        if (changes.amount !== undefined) {
          changes.amount = quantizeToCurrency(changes.amount, original.currency);
          if (changes.amount < currencyMinimumPrice(original.currency)) throw new ValidationError({ amount: [`Amount must be at least ${currencyMinimumPrice(original.currency)} ${original.currency}`] });
        }
        if (changes.payee !== undefined) changes.payee = changes.payee.trim();
        const at = new Date();
        const before = { date: original.date, amount: original.amount, currency: original.currency, category: original.category, description: original.description, payee: original.payee, version };
        const updated = await financeQuery(Expense.findOneAndUpdate({ ...ownership, voidedAt: null, ...financeVersionFilter(version) }, {
          $set: { ...changes, version: version + 1, updatedBy: session.user.id,
            ...(action === "void" ? { voidedAt: at, voidedBy: session.user.id, voidReason: reason } : {}),
          },
          $push: { vendorHistory: { at, by: session.user.id, action, before, ...(reason ? { reason } : {}) } },
        }, { returnDocument: "after", runValidators: true })).lean();
        if (!updated) throw staleFinance();
        if (action === "edit") await auditExpenseUpdated(context, original, updated);
        else await audit(context, {
          action: "UPDATE", resource: "expense", resourceId: params.id, resourceName: original.description,
          changes: { before: { amount: original.amount, currency: original.currency, voided: false }, after: { voided: true }, summary: "Voided a vendor expense; its original values and reason remain in its history." },
        });
        // Vendor costs never post to the marketplace's ledger, including corrections.
        return { result: updated, sourceId: original._id, vendorId: vendor._id, postings: [] };
      },
    });
    return successResponse(outcome.data, action === "edit" ? "Expense updated" : "Expense voided");
  });
}

export const PUT = expenseMutation("edit");
export const DELETE = expenseMutation("void");
