import type { NextRequest } from "next/server";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { Transfer } from "@/models";
import { AuthorizationError, ValidationError } from "@/lib/api/errors";
import { validateBody } from "@/lib/api/validate";
import type { ApiSession } from "@/lib/api/handler";
import { audit, createAuditContext } from "@/lib/audit";
import { fetchTransferList } from "@/lib/inventory/transfer-list";
import {
  cancelTransfer,
  createdTransferEvent,
  generateTransferNumber,
  loadTransferForCaller,
  markTransferReady,
  readSourceAvailability,
  receiveTransfer,
  releaseStuckTransferLock,
  requireTransferLocations,
  resolveTransferItems,
  resolveTransferLocationAccess,
  returnTransferToDraft,
  shipTransfer,
  transferActor,
  updateDraftTransfer,
} from "@/lib/inventory/transfers";
import {
  canTransitionTransferStatus,
  isTransferStatus,
} from "@/lib/inventory/transfer-rules";

/**
 * The transfer endpoints' work, shared by the admin routes and a vendor's own.
 * The routes differ only in who may call them; what a caller may see and do
 * with each transfer is decided here, from the locations they hold.
 */

const TransferCreateSchema = z.object({
  fromLocationId: z.string().max(64).optional(),
  toLocationId: z.string().max(64).optional(),
  note: z.string().max(2000).optional(),
  reference: z.string().max(200).optional(),
  items: z
    .array(
      z
        .object({
          productId: z.string().max(64).optional(),
          variantId: z.string().max(64).optional(),
          quantity: z.union([z.number(), z.string().max(20)]).optional(),
        })
        .loose(),
    )
    .max(500)
    .optional(),
});

const TransferActionSchema = z
  .object({
    action: z.string().max(40).optional(),
    note: z.string().max(2000).optional(),
    reference: z.string().max(200).optional(),
    status: z.string().max(40).optional(),
    fromLocationId: z.string().max(64).optional(),
    toLocationId: z.string().max(64).optional(),
    items: z.array(z.record(z.string(), z.unknown())).max(500).optional(),
    lines: z
      .array(
        z.object({
          productId: z.string().max(64),
          // Empty for a product without variants.
          variantId: z.string().max(64),
          accepted: z.number().int().min(0).max(1_000_000).optional(),
          rejected: z.number().int().min(0).max(1_000_000).optional(),
        }),
      )
      .max(500)
      .optional(),
  })
  .loose();

export async function listTransfersResponse(
  user: ApiSession["user"],
  searchParams: URLSearchParams,
) {
  const list = await fetchTransferList(
    searchParams,
    await resolveTransferLocationAccess(user),
  );
  return {
    items: list.items,
    pagination: {
      page: list.page,
      limit: list.limit,
      total: list.total,
      totalPages: list.totalPages,
    },
    counters: list.counters,
  };
}

export async function createTransferFromRequest(
  request: NextRequest,
  session: ApiSession,
) {
  const body = await validateBody(request, TransferCreateSchema);
  const fromLocationId = String(body.fromLocationId || "").trim();
  const toLocationId = String(body.toLocationId || "").trim();
  const note = typeof body.note === "string" ? body.note.trim() : "";
  const reference =
    typeof body.reference === "string" ? body.reference.trim() : "";

  await connectDB();

  const { fromLocation, toLocation, productOwnerIds } =
    await requireTransferLocations(session.user, fromLocationId, toLocationId);
  const items = await resolveTransferItems(
    fromLocationId,
    Array.isArray(body.items) ? body.items : [],
    productOwnerIds,
  );

  // The timestamp-based transfer number can collide when two transfers are
  // created in the same millisecond — retry with a fresh number instead of
  // surfacing the duplicate-key error.
  let transfer;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      transfer = await Transfer.create({
        transferNumber: await generateTransferNumber(),
        fromLocationId,
        fromLocationName: fromLocation.name,
        toLocationId,
        toLocationName: toLocation.name,
        status: "draft",
        note,
        reference,
        createdBy: String(session.user.id),
        items,
        events: [createdTransferEvent(session.user)],
      });
      break;
    } catch (err) {
      const isDuplicate =
        typeof err === "object" &&
        err !== null &&
        (err as { code?: number }).code === 11000;
      if (isDuplicate && attempt < 2) continue;
      throw err;
    }
  }
  if (!transfer) {
    throw new ValidationError("Failed to create transfer, please retry");
  }

  await audit(createAuditContext(request, session), {
    action: "CREATE",
    resource: "transfer",
    resourceId: String(transfer._id),
    resourceName: transfer.transferNumber,
    changes: {
      summary: `Created transfer ${transfer.transferNumber} from ${fromLocation.name} to ${toLocation.name}`,
    },
  });

  return { transferId: String(transfer._id) };
}

/** Unshipped transfers answer with what the source holds per line right now. */
export async function transferDetailResponse(
  user: ApiSession["user"],
  id: string,
) {
  const { transfer, access } = await loadTransferForCaller(id, user);

  const unshipped =
    transfer.status === "draft" || transfer.status === "ready_to_ship";
  const available = unshipped
    ? await readSourceAvailability(transfer.fromLocationId, transfer.items)
    : null;

  return {
    transfer: {
      ...transfer,
      _id: String(transfer._id),
      items: (transfer.items || []).map((item) => {
        const productId = String(item.productId || "");
        const variantId = String(item.variantId || "");
        return {
          ...item,
          productId,
          variantId,
          receivedQuantity: Number(item.receivedQuantity) || 0,
          rejectedQuantity: Number(item.rejectedQuantity) || 0,
          ...(available
            ? {
                availableAtSource:
                  available.get(`${productId}:${variantId}`) ?? 0,
              }
            : {}),
        };
      }),
      events: (transfer.events || []).map((event) => ({
        ...event,
        _id: String(event._id),
      })),
    },
    access,
  };
}

/** Run one PATCH action. Returns the success payload and message. */
export async function runTransferAction(
  request: NextRequest,
  session: ApiSession,
  id: string,
): Promise<{ data: Record<string, unknown>; message: string }> {
  const body = await validateBody(request, TransferActionSchema);
  const action = String(body.action || "").trim();
  if (!action) {
    throw new ValidationError("Action is required");
  }

  const { transfer, access } = await loadTransferForCaller(id, session.user);
  const actor = transferActor(session.user);
  const auditContext = createAuditContext(request, session);
  const auditSummary = (summary: string, extra?: Record<string, unknown>) =>
    audit(auditContext, {
      action: action === "update_details" ? "UPDATE" : "STATUS_CHANGE",
      resource: "transfer",
      resourceId: String(transfer._id),
      resourceName: transfer.transferNumber,
      changes: { summary },
      ...(extra ? { metadata: extra } : {}),
    });
  const done = { transferId: String(transfer._id) };

  // The caller can see this transfer through one of its ends, but the action
  // belongs to the other end's staff.
  const denied = () =>
    new AuthorizationError(
      "This action belongs to staff at the other location on this transfer",
    );

  if (action === "update_details") {
    if (!access.canEdit) throw denied();
    await updateDraftTransfer(transfer, session.user, {
      fromLocationId:
        typeof body.fromLocationId === "string"
          ? body.fromLocationId.trim()
          : undefined,
      toLocationId:
        typeof body.toLocationId === "string"
          ? body.toLocationId.trim()
          : undefined,
      note: body.note,
      reference: body.reference,
      items: body.items,
    });
    await auditSummary(`Edited draft transfer ${transfer.transferNumber}`);
    return { data: done, message: "Updated" };
  }

  if (action === "receive") {
    if (!access.canReceive) throw denied();
    if (transfer.status !== "in_transit") {
      throw new ValidationError("Only transfers in transit can be received");
    }
    const lines = (body.lines || []).map((line) => ({
      productId: line.productId,
      variantId: line.variantId,
      accepted: line.accepted ?? 0,
      rejected: line.rejected ?? 0,
    }));
    const note = typeof body.note === "string" ? body.note.trim() : "";
    const { completed } = await receiveTransfer(transfer, lines, note, actor);
    await auditSummary(
      `Received items on transfer ${transfer.transferNumber}${completed ? " (completed)" : ""}`,
      { lines },
    );
    return {
      data: { ...done, completed },
      message: completed ? "Transfer completed" : "Items received",
    };
  }

  if (action === "release_lock") {
    if (!access.canSend && !access.canReceive) throw denied();
    await releaseStuckTransferLock(transfer, actor);
    await auditSummary(
      `Released a stuck stock movement on transfer ${transfer.transferNumber}`,
    );
    return { data: done, message: "Released" };
  }

  if (action === "set_status") {
    const nextStatus = String(body.status || "").trim();
    if (!isTransferStatus(nextStatus)) {
      throw new ValidationError("Invalid transfer status");
    }
    const currentStatus = transfer.status;

    if (nextStatus === currentStatus) {
      return { data: done, message: "No changes" };
    }
    if (nextStatus === "completed" && currentStatus === "in_transit") {
      throw new ValidationError("Receive the items to complete this transfer");
    }
    if (!canTransitionTransferStatus(currentStatus, nextStatus)) {
      throw new ValidationError(
        `Cannot move transfer from ${currentStatus} to ${nextStatus}`,
      );
    }
    // Every status change is the sender's call; receiving is its own action.
    if (!access.canSend) throw denied();

    if (nextStatus === "ready_to_ship") {
      await markTransferReady(transfer, actor);
    } else if (nextStatus === "draft") {
      await returnTransferToDraft(transfer, actor);
    } else if (nextStatus === "in_transit") {
      await shipTransfer(transfer, actor);
    } else if (nextStatus === "cancelled") {
      await cancelTransfer(transfer, actor);
    }

    await auditSummary(
      `Transfer ${transfer.transferNumber} moved from ${currentStatus} to ${nextStatus}`,
    );
    return { data: done, message: "Status updated" };
  }

  throw new ValidationError("Unsupported action");
}
