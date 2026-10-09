import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { connectDB } from "@/lib/db";
import { USER_ROLES } from "@/config/app.config";
import {
  EmailDelivery,
  type EmailDeliveryStatus,
} from "@/models/email-delivery.model";
import { getSettings } from "@/models/settings.model";
import {
  getDemoModeMutationResponse,
  isDemoModeEnabled,
} from "@/lib/demo-mode";
import {
  DELIVERY_LOG_RANGES,
  countDeliveryLogGroups,
  deliveryLogFilter,
  isDeliveryLogGroup,
  statusesInGroup,
} from "@/lib/notifications/delivery-log-groups";
import * as z from "zod";

const DELIVERY_STATUSES: EmailDeliveryStatus[] = [
  "queued",
  "sending",
  "retrying",
  "sent",
  "failed",
];
/** Finished rows, which may be deleted; "cancelled" is an email an admin called off. */
const TERMINAL_STATUSES: string[] = ["sent", "failed", "cancelled"];
/** What the log's search looks in. */
const SEARCH_FIELDS = ["to", "subject", "category"] as const;

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json(
      { success: false, message: "Authentication required" },
      { status: 401 },
    );
  }
  if (session.user.role !== USER_ROLES.ADMIN) {
    return NextResponse.json(
      { success: false, message: "Admin access required" },
      { status: 403 },
    );
  }
  return null;
}

const RetryDeliveriesSchema = z.object({
  action: z.string().max(40).optional(),
  ids: z.array(z.string().max(64)).max(500).optional(),
  // Without ids: every failed email the log is showing, by its range and search.
  range: z.enum(DELIVERY_LOG_RANGES).optional(),
  search: z.string().max(200).optional(),
});

export async function GET(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  await connectDB();
  const params = request.nextUrl.searchParams;
  const requestedLimit = Number(params.get("limit") || 10);
  const requestedPage = Number(params.get("page") || 1);
  const limit = Math.min(Math.max(requestedLimit || 10, 5), 50);
  const page = Math.max(requestedPage || 1, 1);
  const status = params.get("status");
  const group = params.get("group");
  // The range and search pick the rows; `group` is the tab. The tab counts are
  // taken over the range and search, so they match the table under them.
  const base = deliveryLogFilter({
    range: params.get("range"),
    search: params.get("search"),
    searchFields: SEARCH_FIELDS,
  });

  const filter: Record<string, unknown> = { ...base };
  if (isDeliveryLogGroup(group)) {
    filter.status = { $in: statusesInGroup(group, DELIVERY_STATUSES) };
  } else if (status && DELIVERY_STATUSES.includes(status as EmailDeliveryStatus)) {
    filter.status = status;
  }

  // Migrate older successful records to metadata-only retention as they are read.
  const settings = await getSettings();
  const retentionDays = settings.email?.logRetentionDays ?? 30;
  if (!isDemoModeEnabled()) {
    await EmailDelivery.updateMany(
      {
        status: "sent",
        $or: [
          { html: { $exists: true } },
          { text: { $exists: true } },
          { attachments: { $exists: true } },
          { expiresAt: { $exists: false } },
        ],
      },
      {
        $unset: { html: 1, text: 1, attachments: 1 },
        $set: {
          expiresAt: new Date(
            Date.now() + retentionDays * 24 * 60 * 60 * 1000,
          ),
        },
      },
    );
  }

  const [deliveries, total, byStatus, clearable] = await Promise.all([
    EmailDelivery.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select(
        "to subject category status attempts maxAttempts lastError providerMessageId createdAt lastAttemptAt sentAt nextAttemptAt expiresAt",
      )
      .lean(),
    EmailDelivery.countDocuments(filter),
    EmailDelivery.aggregate<{ _id: string; count: number }>([
      { $match: base },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    // "Clear sent" deletes every sent email, whatever the filters show.
    EmailDelivery.countDocuments({ status: "sent" }),
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
      retentionDays,
    },
  });
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const demoBlock = getDemoModeMutationResponse();
  if (demoBlock) return demoBlock;
  await connectDB();

  const body = RetryDeliveriesSchema.parse(await request.json().catch(() => ({})));
  if (body.action !== "retry_failed") {
    return NextResponse.json(
      { success: false, message: "Invalid action" },
      { status: 400 },
    );
  }

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === "string").slice(0, 100)
    : [];
  const filter: Record<string, unknown> = ids.length
    ? { _id: { $in: ids } }
    : deliveryLogFilter({
        range: body.range,
        search: body.search,
        searchFields: SEARCH_FIELDS,
      });
  filter.status = "failed";

  const result = await EmailDelivery.updateMany(filter, {
    $set: { status: "queued", attempts: 0, nextAttemptAt: new Date() },
    $unset: { lastError: 1, expiresAt: 1 },
  });
  return NextResponse.json({
    success: true,
    message: `${result.modifiedCount} failed email${result.modifiedCount === 1 ? "" : "s"} queued for retry.`,
    data: { queued: result.modifiedCount },
  });
}

export async function DELETE(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const demoBlock = getDemoModeMutationResponse();
  if (demoBlock) return demoBlock;
  await connectDB();

  const body = (await request.json()) as { scope?: string; ids?: unknown };
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === "string").slice(0, 100)
    : [];

  let filter: Record<string, unknown>;
  if (body.scope === "sent") {
    filter = { status: "sent" };
  } else if (ids.length) {
    filter = { _id: { $in: ids }, status: { $in: TERMINAL_STATUSES } };
  } else {
    return NextResponse.json(
      { success: false, message: "No terminal logs selected" },
      { status: 400 },
    );
  }

  const result = await EmailDelivery.deleteMany(filter);
  return NextResponse.json({
    success: true,
    message: `${result.deletedCount} log${result.deletedCount === 1 ? "" : "s"} deleted.`,
    data: { deleted: result.deletedCount },
  });
}
