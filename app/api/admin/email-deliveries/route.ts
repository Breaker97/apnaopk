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
import { escapeRegExp } from "@/lib/strings";
import { z } from "zod";

const DELIVERY_STATUSES: EmailDeliveryStatus[] = [
  "queued",
  "sending",
  "retrying",
  "sent",
  "failed",
];
const TERMINAL_STATUSES: EmailDeliveryStatus[] = ["sent", "failed"];

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

function getCreatedAfter(range: string | null) {
  const days = range === "today" ? 1 : Number(range?.replace("d", ""));
  if (![1, 7, 30, 90].includes(days)) return undefined;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

const RetryDeliveriesSchema = z.object({
  action: z.string().max(40).optional(),
  ids: z.array(z.string().max(64)).max(500).optional(),
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
  const search = params.get("search")?.trim().slice(0, 200);
  const createdAfter = getCreatedAfter(params.get("range"));

  const filter: Record<string, unknown> = {};
  if (status && DELIVERY_STATUSES.includes(status as EmailDeliveryStatus)) {
    filter.status = status;
  }
  if (search) {
    const pattern = new RegExp(escapeRegExp(search), "i");
    filter.$or = [{ to: pattern }, { subject: pattern }, { category: pattern }];
  }
  if (createdAfter) filter.createdAt = { $gte: createdAfter };

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

  const [deliveries, total, sent, failed, pending] = await Promise.all([
    EmailDelivery.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select(
        "to subject category status attempts maxAttempts lastError providerMessageId createdAt lastAttemptAt sentAt nextAttemptAt expiresAt",
      )
      .lean(),
    EmailDelivery.countDocuments(filter),
    EmailDelivery.countDocuments({ status: "sent" }),
    EmailDelivery.countDocuments({ status: "failed" }),
    EmailDelivery.countDocuments({
      status: { $in: ["queued", "sending", "retrying"] },
    }),
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
  const filter: Record<string, unknown> = { status: "failed" };
  if (ids.length) filter._id = { $in: ids };

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
