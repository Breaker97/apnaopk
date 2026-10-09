import { NextResponse } from "next/server";
import * as z from "zod";
import {
  SMS_DELIVERY_STATUSES,
  SmsDelivery,
  TERMINAL_SMS_STATUSES,
  type SmsDeliveryStatus,
} from "@/models/sms-delivery.model";
import { getSettingsLean } from "@/models/settings.model";
import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { appBaseUrl } from "@/lib/app-url";
import { smsDeliveryReceiptsEnabled } from "@/lib/sms/sms";
import {
  DELIVERY_LOG_RANGES,
  countDeliveryLogGroups,
  deliveryLogFilter,
  isDeliveryLogGroup,
  statusesInGroup,
} from "@/lib/notifications/delivery-log-groups";

/** What the log's search looks in. */
const SEARCH_FIELDS = ["to", "body", "category"] as const;
/** "Failed" in the tabs and the retry action: the provider or the carrier said no. */
const FAILED_STATUSES: SmsDeliveryStatus[] = statusesInGroup("failed", SMS_DELIVERY_STATUSES);
/** What "Clear sent" deletes. */
const SENT_STATUSES: SmsDeliveryStatus[] = statusesInGroup("sent", SMS_DELIVERY_STATUSES);

/**
 * GET /api/admin/sms-deliveries — the SMS delivery log (Settings → SMS).
 *
 * `range` and `search` pick the rows; `group` (sent, failed, waiting) is the
 * tab. The counts per tab are taken over the range and search, so they match
 * the table whichever tab is open.
 */
export const GET = withApi({ auth: "admin" }, async ({ request }) => {
  const params = request.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(params.get("limit")) || 10, 5), 50);
  const page = Math.max(Number(params.get("page")) || 1, 1);
  const base = deliveryLogFilter({
    range: params.get("range"),
    search: params.get("search"),
    searchFields: SEARCH_FIELDS,
  });

  const filter: Record<string, unknown> = { ...base };
  const group = params.get("group");
  const status = params.get("status");
  if (isDeliveryLogGroup(group)) {
    filter.status = { $in: statusesInGroup(group, SMS_DELIVERY_STATUSES) };
  } else if (status && SMS_DELIVERY_STATUSES.includes(status as SmsDeliveryStatus)) {
    filter.status = status;
  }

  const [deliveries, total, byStatus, clearable, settings] = await Promise.all([
    SmsDelivery.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select(
        "to body category status attempts maxAttempts segments errorCode lastError createdAt sentAt deliveredAt",
      )
      .lean(),
    SmsDelivery.countDocuments(filter),
    SmsDelivery.aggregate<{ _id: string; count: number }>([
      { $match: base },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    // "Clear sent" deletes every sent text, whatever the filters show.
    SmsDelivery.countDocuments({ status: { $in: SENT_STATUSES } }),
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
      stats: countDeliveryLogGroups(byStatus),
      clearable,
      retentionDays: settings.sms?.logRetentionDays ?? 30,
      // Without a public https address Twilio has nowhere to post its receipts,
      // so every text stays at "sent" and the log should say why.
      receipts: { enabled: smsDeliveryReceiptsEnabled(), origin: appBaseUrl() },
    },
  });
});

const RetrySchema = z.object({
  action: z.literal("retry_failed"),
  ids: z.array(z.string().regex(/^[a-f0-9]{24}$/i)).max(100).optional(),
  // Without ids: every failed text the log is showing, by its range and search.
  range: z.enum(DELIVERY_LOG_RANGES).optional(),
  search: z.string().max(200).optional(),
});

/**
 * POST /api/admin/sms-deliveries — queue failed texts for the next cron run.
 * Every retried text is billed again, so it is refused on a demo.
 */
export const POST = withApi(
  { auth: "admin", demo: "block-mutations" },
  async ({ request }) => {
    const { ids, range, search } = await validateBody(request, RetrySchema);
    const filter: Record<string, unknown> = ids?.length
      ? { _id: { $in: ids } }
      : deliveryLogFilter({ range, search, searchFields: SEARCH_FIELDS });
    filter.status = { $in: FAILED_STATUSES };

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
    filter = { status: { $in: SENT_STATUSES } };
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
