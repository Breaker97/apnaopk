import { NextResponse } from "next/server";
import { z } from "zod";
import {
  SMS_DELIVERY_STATUSES,
  SmsDelivery,
  TERMINAL_SMS_STATUSES,
  type SmsDeliveryStatus,
} from "@/models/sms-delivery.model";
import { getSettingsLean } from "@/models/settings.model";
import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { escapeRegExp } from "@/lib/strings";

const PENDING_STATUSES: SmsDeliveryStatus[] = ["queued", "sending", "retrying"];
/** "Failed" in the stats and the retry action: the provider or the carrier said no. */
const FAILED_STATUSES: SmsDeliveryStatus[] = ["failed", "undelivered"];

function createdAfter(range: string | null) {
  const days = range === "today" ? 1 : Number(range?.replace("d", ""));
  if (![1, 7, 30, 90].includes(days)) return undefined;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * GET /api/admin/sms-deliveries — the SMS delivery log (Settings → SMS).
 */
export const GET = withApi({ auth: "admin" }, async ({ request }) => {
  const params = request.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(params.get("limit")) || 10, 5), 50);
  const page = Math.max(Number(params.get("page")) || 1, 1);
  const status = params.get("status");
  const search = params.get("search")?.trim().slice(0, 200);
  const after = createdAfter(params.get("range"));

  const filter: Record<string, unknown> = {};
  if (status && SMS_DELIVERY_STATUSES.includes(status as SmsDeliveryStatus)) {
    filter.status = status;
  }
  if (search) {
    const pattern = new RegExp(escapeRegExp(search), "i");
    filter.$or = [{ to: pattern }, { body: pattern }, { category: pattern }];
  }
  if (after) filter.createdAt = { $gte: after };

  const [deliveries, total, sent, failed, pending, settings] = await Promise.all([
    SmsDelivery.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select(
        "to body category status attempts maxAttempts segments errorCode lastError createdAt sentAt deliveredAt",
      )
      .lean(),
    SmsDelivery.countDocuments(filter),
    SmsDelivery.countDocuments({ status: { $in: ["sent", "delivered"] } }),
    SmsDelivery.countDocuments({ status: { $in: FAILED_STATUSES } }),
    SmsDelivery.countDocuments({ status: { $in: PENDING_STATUSES } }),
    getSettingsLean(),
  ]);

  return NextResponse.json({
    success: true,
    data: {
      deliveries,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
      stats: { total: sent + failed + pending, sent, failed, pending },
      retentionDays: settings.sms?.logRetentionDays ?? 30,
    },
  });
});

const RetrySchema = z.object({
  action: z.literal("retry_failed"),
  ids: z.array(z.string().regex(/^[a-f0-9]{24}$/i)).max(100).optional(),
});

/**
 * POST /api/admin/sms-deliveries — queue failed texts for the next cron run.
 * Every retried text is billed again, so it is refused on a demo.
 */
export const POST = withApi(
  { auth: "admin", demo: "block-mutations" },
  async ({ request }) => {
    const { ids } = await validateBody(request, RetrySchema);
    const filter: Record<string, unknown> = { status: { $in: FAILED_STATUSES } };
    if (ids?.length) filter._id = { $in: ids };

    const result = await SmsDelivery.updateMany(filter, {
      $set: { status: "queued", attempts: 0, nextAttemptAt: new Date() },
      $unset: { lastError: "", errorCode: "", expiresAt: "", providerMessageId: "" },
    });
    return NextResponse.json({
      success: true,
      message: `${result.modifiedCount} failed text${result.modifiedCount === 1 ? "" : "s"} queued for retry.`,
      data: { queued: result.modifiedCount },
    });
  },
);

const DeleteSchema = z.object({
  scope: z.literal("sent").optional(),
  ids: z.array(z.string().regex(/^[a-f0-9]{24}$/i)).max(100).optional(),
});

/**
 * DELETE /api/admin/sms-deliveries — clear finished log rows. A queued or
 * sending text is never deleted: that would lose a message mid-flight.
 */
export const DELETE = withApi({ auth: "admin" }, async ({ request }) => {
  const { scope, ids } = await validateBody(request, DeleteSchema);

  let filter: Record<string, unknown>;
  if (scope === "sent") {
    filter = { status: { $in: ["sent", "delivered"] } };
  } else if (ids?.length) {
    filter = { _id: { $in: ids }, status: { $in: TERMINAL_SMS_STATUSES } };
  } else {
    return NextResponse.json(
      { success: false, message: "No finished messages selected" },
      { status: 400 },
    );
  }

  const result = await SmsDelivery.deleteMany(filter);
  return NextResponse.json({
    success: true,
    message: `${result.deletedCount} log${result.deletedCount === 1 ? "" : "s"} deleted.`,
    data: { deleted: result.deletedCount },
  });
});
