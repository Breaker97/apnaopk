import { NextRequest, NextResponse } from "next/server";
import { handleApiError, ValidationError } from "@/lib/api/errors";
import { validateBody } from "@/lib/api/validate";
import { InventoryLocationBodySchema } from "@/lib/validations";
import { connectDB } from "@/lib/db";
import { locationOwnerFilter } from "@/lib/inventory/inventory-location-scope";
import { InventoryLocation } from "@/models/inventory-location.model";
// Shared with the `[id]` route. They cannot live in this file: a `route.ts` may
// only export HTTP handlers and the framework's config keys, and anything else
// fails the generated route types at build time.
import {
  counterFieldsFromBody,
  dispatchFieldsFromBody,
  pickupAddressError,
  pickupFieldsFromBody,
  requireScope,
  resolveLocationGeo,
} from "@/lib/locations/location-api";

/**
 * Inventory locations for the caller's own store.
 *
 * One endpoint serves all three dashboards — admin, staff, and vendor — because
 * every one of them (product form, POS, transfers, settings) needs the same
 * list, and duplicating the CRUD would mean two surfaces to keep in step. What
 * differs is *whose* locations come back: `resolveLocationScope` answers that
 * once, and every query here goes through it. A vendor sees only their own
 * places; an admin sees the house store's; staff see what they are scoped to.
 *
 * Managing your own locations is an inherent right of an approved merchant, so
 * there is no separate permission for it — a vendor who can list products can
 * say where those products are kept.
 */

export async function GET(request: Request) {
  try {
    const authResult = await requireScope("read");
    if (!authResult.ok) return authResult.response;

    await connectDB();

    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get("includeInactive") === "true";

    const locations = await InventoryLocation.find(
      locationOwnerFilter(
        authResult.scope,
        includeInactive ? {} : { isActive: true },
      ),
    )
      .sort({ isDefault: -1, name: 1 })
      .lean();

    return NextResponse.json({
      success: true,
      data: locations,
    });
  } catch (error) {
    console.error("Failed to fetch locations:", error);
    return NextResponse.json(
      { success: false, message: "Failed to fetch locations" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireScope("write");
    if (!authResult.ok) return authResult.response;

    await connectDB();

    const body = await validateBody(request, InventoryLocationBodySchema);
    const { name, address, isDefault } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json(
        { success: false, message: "Location name is required" },
        { status: 400 }
      );
    }

    const addressError = pickupAddressError(body);
    if (addressError) {
      return NextResponse.json(
        { success: false, message: addressError },
        { status: 400 },
      );
    }

    // Staff pinned to a fixed set of locations are being told which places they
    // may work in; letting them mint another would step around that.
    if (authResult.scope.locationIds.length > 0) {
      return NextResponse.json(
        {
          success: false,
          message: "Your account is limited to specific locations",
        },
        { status: 403 },
      );
    }

    const location = await InventoryLocation.create({
      vendorId: authResult.scope.vendorId,
      name: name.trim(),
      address: address?.trim() || "",
      isDefault: Boolean(isDefault),
      isActive: true,
      // A new branch goes to the END of the dispatch order unless the client
      // said otherwise. Merchants add their overflow shop after their main
      // warehouse, and silently promoting it to first choice would redirect
      // every order the moment it was created.
      fulfillmentPriority: await InventoryLocation.countDocuments({
        vendorId: authResult.scope.vendorId,
      }),
      ...pickupFieldsFromBody(body),
      ...dispatchFieldsFromBody(body),
      ...counterFieldsFromBody(body),
      ...(await resolveLocationGeo(body, authResult.scope.vendorId)),
    });

    return NextResponse.json(
      {
        success: true,
        data: location.toObject(),
        message: "Location created successfully",
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof ValidationError) return handleApiError(error);
    console.error("Failed to create location:", error);
    return NextResponse.json(
      { success: false, message: "Failed to create location" },
      { status: 500 }
    );
  }
}
