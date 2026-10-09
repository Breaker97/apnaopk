import { Types } from "mongoose";
import * as z from "zod";
import { connectDB } from "@/lib/db";
import { CustomerProfile } from "@/models";
import { getSettings } from "@/models/settings.model";
import { AuthorizationError, ValidationError } from "@/lib/api/errors";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { withApi } from "@/lib/api/handler";
import { canIssueRefunds } from "@/lib/access/rbac";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import {
  issueStoreCredit,
  storeCreditHistory,
  storeCreditSummary,
} from "@/lib/store-credit/store-credit";
import { notifyStoreCreditIssued } from "@/lib/store-credit/store-credit-notify";
import { createAuditContext } from "@/lib/audit";
import { auditStoreCreditIssued } from "@/lib/finance/audit-money";

/** The shopper behind a customer profile — store credit is theirs. */
async function customerUserId(profileId: string): Promise<string | null> {
  if (!Types.ObjectId.isValid(profileId)) return null;
  const profile = await CustomerProfile.findById(profileId)
    .select("userId")
    .lean<{ userId?: unknown } | null>();
  const userId = String(profile?.userId || "");
  return Types.ObjectId.isValid(userId) ? userId : null;
}

/**
 * A customer's store credit on their admin page (R8): balance per currency,
 * the next part to expire, and every change. Staff who can see customers can
 * read it; only an admin can give credit (D3).
 */
export const GET = withApi<{ id: string }>(
  { auth: "user", rateLimit: { action: "admin:customers:store-credit", preset: "lenient" } },
  async ({ params, session }) => {
    await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [STAFF_PERMISSIONS.VIEW_CUSTOMERS],
    );
    await connectDB();
    const userId = await customerUserId(params.id);
    if (!userId) return notFoundResponse("Customer");
    const [balances, history] = await Promise.all([
      storeCreditSummary(userId),
      storeCreditHistory(userId, { limit: 100 }),
    ]);
    return successResponse({
      balances,
      history,
      canIssue: canIssueRefunds(session.user),
    });
  },
);

const GiveStoreCreditSchema = z.object({
  amount: z.coerce.number().positive().max(1_000_000_000),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/, "Choose a currency"),
  /** A day, `YYYY-MM-DD`; absent, the credit never expires. */
  expiresOn: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  note: z.string().trim().max(500).optional(),
  /** One per opening of the dialog, so a double click gives credit once. */
  requestId: z.string().trim().min(8).max(100),
});

/** Give a customer store credit with no refund behind it — goodwill (R8). */
export const POST = withApi<{ id: string }>(
  { auth: "user", rateLimit: { action: "admin:customers:store-credit:give", preset: "moderate" } },
  async ({ request, params, session }) => {
    if (!canIssueRefunds(session.user)) {
      throw new AuthorizationError("Only admins can give store credit");
    }
    const body = await validateBody(request, GiveStoreCreditSchema);
    await connectDB();
    const userId = await customerUserId(params.id);
    if (!userId) return notFoundResponse("Customer");

    const settings = await getSettings();
    const currency = body.currency.toUpperCase();
    const storeCurrency = String(settings.general?.defaultCurrency || "USD").toUpperCase();
    if (currency !== storeCurrency) {
      // Spent only on orders in the same currency, and the store sells in its own.
      throw new ValidationError(`Store credit is given in the store's currency, ${storeCurrency}`);
    }
    // The end of the chosen day, in UTC.
    const expiresAt = body.expiresOn ? new Date(`${body.expiresOn}T23:59:59.999Z`) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new ValidationError("Choose an expiry date in the future");
    }

    const startedAt = Date.now();
    const lot = await issueStoreCredit({
      customerId: userId,
      currency,
      amount: body.amount,
      expiresAt,
      source: "goodwill",
      note: body.note,
      createdBy: session.user.id,
      idempotencyKey: `goodwill:${userId}:${body.requestId}`,
    });
    // A double click sends the same `requestId` and gets back the lot the first
    // click made, so only a lot made during this request earns a row.
    if (!lot.createdAt || new Date(lot.createdAt).getTime() >= startedAt) {
      await auditStoreCreditIssued(createAuditContext(request, session), lot);
    }
    // A cost of the store's own promotion, owed to the shopper until spent.
    const { postStoreCreditEventSafely } = await import("@/lib/finance/post-events");
    postStoreCreditEventSafely(lot);
    await notifyStoreCreditIssued({
      customerId: userId,
      lotId: String(lot._id),
      amount: lot.amount,
      currency,
      expiresAt: lot.expiresAt ?? null,
      reason: "goodwill",
      note: body.note,
    }).catch((error) => console.error("Failed to tell a customer about store credit:", error));

    return successResponse({ lot, balances: await storeCreditSummary(userId) });
  },
);
