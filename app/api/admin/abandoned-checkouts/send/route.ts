import { onAppOrigin } from "@/lib/app-url";
import { mongoose } from "@/lib/db";
import { AbandonedCheckout, Cart } from "@/models";
import { getSettings } from "@/models/settings.model";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import {
  sendAbandonedCheckoutRecoveryEmail,
  upsertAbandonedCheckoutSnapshot,
} from "@/lib/orders/abandoned-checkouts";
import { withApi } from "@/lib/api/handler";
import * as z from "zod";
import { validateOptionalBody } from "@/lib/api/validate";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { mergeScopeFilter } from "@/lib/access/staff-scope";
import {
  abandonedCheckoutScopeFilter,
  abandonedCheckoutViewerForStaff,
  type AbandonedCheckoutViewer,
} from "@/lib/orders/abandoned-checkout-list";

type CheckoutMailTarget = {
  _id: unknown;
  checkoutToken?: string;
  recoveryToken?: string;
  checkoutUrl?: string;
  customerLocale?: string;
  recoveryEmailStatus?: string;
  abandonedAt?: Date;
  emailSentAt?: Date;
  save: () => Promise<unknown>;
};

function compactQueries(queries: Array<Record<string, unknown>>) {
  return queries.filter(
    (query) => !Object.values(query).some((value) => value === undefined),
  );
}

async function findCheckoutMailTarget(checkoutId: string) {
  const objectId = mongoose.isValidObjectId(checkoutId)
    ? checkoutId
    : undefined;

  const snapshot = await AbandonedCheckout.findOne({
    $or: compactQueries([
      { _id: objectId },
      { cartId: objectId },
      { checkoutToken: checkoutId },
      { recoveryToken: checkoutId },
    ]),
  });

  if (snapshot) return { target: snapshot, source: "snapshot" as const };

  const cart = await Cart.findOne({
    $or: compactQueries([
      { _id: objectId },
      { checkoutToken: checkoutId },
      { recoveryToken: checkoutId },
    ]),
  });

  if (cart) return { target: cart, source: "cart" as const };

  return null;
}

/**
 * Whether the reader's list shows this checkout. A scoped staff member reaches
 * only the snapshots in their scope; a live cart abandoned before snapshots
 * existed carries no seller or scope to match, so it stays the store's.
 */
async function isWithinScope(
  resolved: NonNullable<Awaited<ReturnType<typeof findCheckoutMailTarget>>>,
  viewer: AbandonedCheckoutViewer,
) {
  const scopeFilter = abandonedCheckoutScopeFilter(viewer);
  if (!scopeFilter) return true;
  if (resolved.source === "cart") return false;
  const id = (resolved.target as { _id?: unknown })._id;
  return Boolean(
    await AbandonedCheckout.exists(mergeScopeFilter({ _id: id }, scopeFilter)),
  );
}

const SendCheckoutRecoverySchema = z.object({
  checkoutId: z.string().max(64).optional(),
  locale: z.string().max(10).optional(),
});

/**
 * POST /api/admin/abandoned-checkouts/send — email a shopper their recovery
 * link now. Staff need `manage_abandoned_checkouts`, and reach only the
 * checkouts their own list shows: anything outside their scope answers as
 * missing, not as forbidden, so an id cannot be used to probe for one.
 */
export const POST = withApi(
  {
    auth: "admin-or-staff",
    staffPermissions: [STAFF_PERMISSIONS.MANAGE_ABANDONED_CHECKOUTS],
  },
  async ({ request, staff }) => {
    const viewer = abandonedCheckoutViewerForStaff(staff);
    const body = await validateOptionalBody(request, SendCheckoutRecoverySchema);
    if (!body.checkoutId) throw new ValidationError("checkoutId is required");

    const resolved = await findCheckoutMailTarget(body.checkoutId);
    if (!resolved) return notFoundResponse("Checkout");
    if (!(await isWithinScope(resolved, viewer))) {
      return notFoundResponse("Checkout");
    }

    const target = resolved.target as CheckoutMailTarget;
    const settings = await getSettings();

    const { outcome, suppression } = await sendAbandonedCheckoutRecoveryEmail({
      cart: target,
      settings,
      locale: body.locale || target.customerLocale || "en",
      // Asked for by a person, so it goes out even where the automatic ladder
      // has already sent that rung: "they say it never arrived" is the whole
      // reason this button exists.
      dedupe: false,
    });

    if (resolved.source === "cart") {
      await upsertAbandonedCheckoutSnapshot(target, {
        abandonedAt: target.abandonedAt,
        status: "open",
      });
    } else if (target.checkoutToken || target.recoveryToken) {
      await Cart.findOneAndUpdate(
        {
          $or: compactQueries([
            { checkoutToken: target.checkoutToken },
            { recoveryToken: target.recoveryToken },
          ]),
        },
        {
          $set: {
            recoveryEmailStatus: target.recoveryEmailStatus,
            ...(outcome === "sent"
              ? { emailSentAt: target.emailSentAt || new Date() }
              : {}),
          },
        },
      ).catch(() => undefined);
    }

    // More answers than sent/failed: a mail the outbox is retrying has not
    // failed, and telling the merchant it had sent them to check a mail server
    // that was about to deliver it anyway. Nor has one to a shopper who
    // unsubscribed — there is nothing for the merchant to fix there.
    return successResponse(
      {
        sent: outcome === "sent" || outcome === "queued",
        outcome,
        ...(suppression ? { suppression } : {}),
        // Rebuilt only when a mail went out; one stored before recovery links
        // stopped following the request's origin can name any site.
        checkoutUrl: onAppOrigin(target.checkoutUrl),
        recoveryEmailStatus: target.recoveryEmailStatus,
      },
      outcome === "sent"
        ? "Recovery email sent"
        : outcome === "queued"
          ? "Recovery email queued — delivery is being retried"
          : outcome === "suppressed"
            ? suppression === "pending"
              ? "Not sent — the shopper has not confirmed their subscription yet"
              : "Not sent — the shopper unsubscribed from these emails"
            : "Recovery email could not be sent",
    );
  },
);
