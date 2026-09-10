import { connectDB } from "@/lib/db";
import { InventoryLocation, Product, Transfer } from "@/models";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { ValidationError } from "@/lib/api/errors";
import { successResponse } from "@/lib/api/response";
import { generateTransferNumber } from "@/lib/inventory/transfers";
import { withApi } from "@/lib/api/handler";
import { fetchTransferList } from "@/lib/inventory/transfer-list";
import {
  locationOwnerFilter,
  resolveLocationScope,
} from "@/lib/inventory/inventory-location-scope";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";

type TransferCreateItem = {
  productId: string;
  variantId: string;
  quantity: number;
  productTitle?: string;
  variantTitle?: string;
  sku?: string;
};

async function validateItemsAtSourceLocation(
  fromLocationId: string,
  items: TransferCreateItem[],
) {
  const grouped = new Map<string, TransferCreateItem[]>();

  for (const item of items) {
    if (!grouped.has(item.productId)) {
      grouped.set(item.productId, []);
    }
    grouped.get(item.productId)!.push(item);
  }

  // One round trip for every product on the transfer, not one per product.
  const products = await Product.find({ _id: { $in: [...grouped.keys()] } })
    .select("title name variants")
    .lean();
  const productById = new Map(
    products.map((product) => [String(product._id), product]),
  );

  for (const [productId, lines] of grouped) {
    const product = productById.get(productId);
    if (!product) {
      throw new ValidationError("Selected product no longer exists");
    }

    for (const line of lines) {
      const variant = Array.isArray(product.variants)
        ? product.variants.find(
            (v: {
              _id?: { toString: () => string };
              locationInventory?: Array<{ locationId: string; quantity: number }>;
              stock?: number;
              name?: string;
              sku?: string;
            }) => String(v._id) === line.variantId,
          )
        : undefined;

      if (!variant) {
        throw new ValidationError("Selected variant no longer exists");
      }

      const sourceQty = (variant.locationInventory || []).find(
        (entry: { locationId: string; quantity: number }) =>
          String(entry.locationId) === fromLocationId,
      )?.quantity;

      if (typeof sourceQty !== "number" || sourceQty < line.quantity) {
        throw new ValidationError(
          `Insufficient stock at source location for ${(product.title || product.name || "item") as string}`,
        );
      }
    }
  }
}

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

/**
 * GET /api/admin/transfers
 */
export const GET = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [STAFF_PERMISSIONS.VIEW_INVENTORY],
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:transfers:list",
      "lenient",
      session.user.role,
    );

    const list = await fetchTransferList(new URL(request.url).searchParams);

    return successResponse({
      items: list.items,
      pagination: {
        page: list.page,
        limit: list.limit,
        total: list.total,
        totalPages: list.totalPages,
      },
      counters: list.counters,
    });
  },
);

/**
 * POST /api/admin/transfers
 */
export const POST = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [
        STAFF_PERMISSIONS.CREATE_INVENTORY,
        STAFF_PERMISSIONS.MANAGE_INVENTORY,
      ],
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:transfers:create",
      "moderate",
      session.user.role,
    );

    const body = await validateBody(request, TransferCreateSchema);
    const fromLocationId = String(body.fromLocationId || "").trim();
    const toLocationId = String(body.toLocationId || "").trim();
    const note = typeof body.note === "string" ? body.note.trim() : "";
    const reference =
      typeof body.reference === "string" ? body.reference.trim() : "";
    const rawItems = Array.isArray(body.items) ? body.items : [];

    if (!fromLocationId || !toLocationId) {
      throw new ValidationError("From and To locations are required");
    }

    if (fromLocationId === toLocationId) {
      throw new ValidationError("Source and destination must be different");
    }

    const items: TransferCreateItem[] = rawItems
      .map((item: unknown) => {
        const row = item as Record<string, unknown>;
        return {
          productId: String(row.productId || "").trim(),
          variantId: String(row.variantId || "").trim(),
          quantity: Math.max(0, Number(row.quantity || 0)),
          productTitle:
            typeof row.productTitle === "string" ? row.productTitle.trim() : "",
          variantTitle:
            typeof row.variantTitle === "string" ? row.variantTitle.trim() : "",
          sku: typeof row.sku === "string" ? row.sku.trim() : "",
        };
      })
      .filter(
        (item: TransferCreateItem) =>
          item.productId && item.variantId && item.quantity > 0,
      );

    if (!items.length) {
      throw new ValidationError("At least one transfer item is required");
    }

    await connectDB();

    // Both ends must belong to the caller's own store. A transfer moves units
    // out of one location and into another, so an unscoped destination would be
    // a way to push stock into another merchant's warehouse — or, in reverse,
    // to drain theirs.
    const scope = await resolveLocationScope(session.user, "write");
    const [fromLocation, toLocation] = await Promise.all([
      InventoryLocation.findOne(
        locationOwnerFilter(scope, { _id: fromLocationId, isActive: true }),
      )
        .select("name")
        .lean(),
      InventoryLocation.findOne(
        locationOwnerFilter(scope, { _id: toLocationId, isActive: true }),
      )
        .select("name")
        .lean(),
    ]);

    if (!fromLocation || !toLocation) {
      throw new ValidationError("One or more selected locations are invalid");
    }

    await validateItemsAtSourceLocation(fromLocationId, items);

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

    return successResponse(
      {
        transferId: String(transfer._id),
      },
      "Transfer created",
      201,
    );
  },
);
