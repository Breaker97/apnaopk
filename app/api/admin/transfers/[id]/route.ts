import { NextRequest } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth/auth";
import { connectDB } from "@/lib/db";
import { Transfer } from "@/models";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import {
  AuthenticationError,
  NotFoundError,
  ValidationError,
  handleApiError,
} from "@/lib/api/errors";
import { successResponse } from "@/lib/api/response";
import {
  applyTransferInventory,
  canTransitionTransferStatus,
  type TransferLifecycleStatus,
} from "@/lib/inventory/transfers";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function parseStatus(value: unknown): TransferLifecycleStatus {
  const status = String(value || "").trim() as TransferLifecycleStatus;
  if (
    status === "draft" ||
    status === "ready_to_ship" ||
    status === "in_transit" ||
    status === "completed" ||
    status === "cancelled"
  ) {
    return status;
  }
  throw new ValidationError("Invalid transfer status");
}

const TransferActionSchema = z
  .object({
    action: z.string().max(40).optional(),
    note: z.string().max(2000).optional(),
    reference: z.string().max(200).optional(),
    status: z.string().max(40).optional(),
    items: z.array(z.record(z.string(), z.unknown())).max(500).optional(),
  })
  .loose();

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new AuthenticationError();

    await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [STAFF_PERMISSIONS.VIEW_INVENTORY],
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:transfers:detail",
      "lenient",
      session.user.role,
    );

    const { id } = await context.params;
    await connectDB();

    const transfer = await Transfer.findById(id).lean();
    if (!transfer) throw new NotFoundError("Transfer not found");

    return successResponse({
      transfer: {
        ...transfer,
        _id: String(transfer._id),
        items: Array.isArray(transfer.items)
          ? transfer.items.map((item: Record<string, unknown>) => ({
              ...item,
              productId: String(item.productId || ""),
            }))
          : [],
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new AuthenticationError();

    await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [
        STAFF_PERMISSIONS.EDIT_INVENTORY,
        STAFF_PERMISSIONS.MANAGE_INVENTORY,
      ],
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:transfers:update",
      "moderate",
      session.user.role,
    );

    const { id } = await context.params;
    const body = await validateBody(request, TransferActionSchema);
    const action = String(body.action || "").trim();

    if (!action) {
      throw new ValidationError("Action is required");
    }

    await connectDB();
    const transfer = await Transfer.findById(id);

    if (!transfer) {
      throw new NotFoundError("Transfer not found");
    }

    if (action === "update_details") {
      if (transfer.status !== "draft") {
        throw new ValidationError("Only draft transfers can be edited");
      }

      if (typeof body.note === "string") {
        transfer.note = body.note.trim();
      }

      if (typeof body.reference === "string") {
        transfer.reference = body.reference.trim();
      }

      if (Array.isArray(body.items)) {
        const normalizedItems = body.items
          .map((item: unknown) => {
            const row = item as Record<string, unknown>;
            return {
              productId: String(row.productId || "").trim(),
              variantId: String(row.variantId || "").trim(),
              quantity: Math.max(0, Number(row.quantity || 0)),
              productTitle:
                typeof row.productTitle === "string"
                  ? row.productTitle.trim()
                  : "",
              variantTitle:
                typeof row.variantTitle === "string"
                  ? row.variantTitle.trim()
                  : "",
              sku: typeof row.sku === "string" ? row.sku.trim() : "",
            };
          })
          .filter(
            (item: { productId: string; variantId: string; quantity: number }) =>
              item.productId && item.variantId && item.quantity > 0,
          );

        if (!normalizedItems.length) {
          throw new ValidationError("At least one item is required");
        }

        transfer.items = normalizedItems;
      }

      await transfer.save();

      return successResponse({ transferId: String(transfer._id) }, "Updated");
    }

    if (action === "set_status") {
      const nextStatus = parseStatus(body.status);
      const currentStatus = transfer.status as TransferLifecycleStatus;

      if (nextStatus === currentStatus) {
        return successResponse({ transferId: String(transfer._id) }, "No changes");
      }

      if (!canTransitionTransferStatus(currentStatus, nextStatus)) {
        throw new ValidationError(
          `Cannot move transfer from ${currentStatus} to ${nextStatus}`,
        );
      }

      // Atomically claim the transition so two concurrent requests (double-click
      // or a retry) can't both proceed to apply inventory. Only the request that
      // flips the status away from `currentStatus` wins; the loser matches
      // nothing and is rejected below.
      const timestampField =
        nextStatus === "completed"
          ? { completedAt: new Date() }
          : nextStatus === "cancelled"
            ? { cancelledAt: new Date() }
            : {};
      const claimed = await Transfer.findOneAndUpdate(
        { _id: transfer._id, status: currentStatus },
        { $set: { status: nextStatus, ...timestampField } },
        { new: true },
      );
      if (!claimed) {
        throw new ValidationError(
          "Transfer status changed concurrently; please retry",
        );
      }

      if (nextStatus === "completed") {
        try {
          await applyTransferInventory({
            fromLocationId: String(transfer.fromLocationId),
            toLocationId: String(transfer.toLocationId),
            items: (transfer.items || []).map(
              (item: {
                productId: string;
                variantId: string;
                quantity: number;
              }) => ({
                productId: String(item.productId),
                variantId: String(item.variantId),
                quantity: Number(item.quantity) || 0,
              }),
            ),
          });
        } catch (applyError) {
          // Revert the claim so the transfer can be retried rather than being
          // stuck "completed" with inventory only partially moved.
          await Transfer.updateOne(
            { _id: transfer._id, status: "completed" },
            { $set: { status: currentStatus }, $unset: { completedAt: "" } },
          ).catch((revertErr) =>
            console.error("Failed to revert transfer status:", revertErr),
          );
          throw applyError;
        }
      }

      return successResponse({ transferId: String(transfer._id) }, "Status updated");
    }

    throw new ValidationError("Unsupported action");
  } catch (error) {
    return handleApiError(error);
  }
}
