import { NextRequest, NextResponse } from "next/server";
import { handleApiError, ValidationError } from "@/lib/api/errors";
import { validateBody } from "@/lib/api/validate";
import { InventoryLocationBodySchema } from "@/lib/validations";
import { connectDB } from "@/lib/db";
import { locationOwnerFilter } from "@/lib/inventory/inventory-location-scope";
import { InventoryLocation } from "@/models/inventory-location.model";
import { getDemoModeMutationResponse } from "@/lib/demo-mode";
import {
  counterFieldsFromBody,
  dispatchFieldsFromBody,
  pickupAddressError,
  pickupFieldsFromBody,
  requireScope,
  resolveLocationGeo,
} from "@/lib/locations/location-api";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * A location that belongs to another merchant answers 404, never 403: a
 * different status would confirm that someone else's location exists at that
 * id, which is exactly what scoping these away is meant to prevent.
 */

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const authResult = await requireScope("read");
    if (!authResult.ok) return authResult.response;

    await connectDB();
    const { id } = await params;

    const location = await InventoryLocation.findOne(
      locationOwnerFilter(authResult.scope, { _id: id }),
    ).lean();

    if (!location) {
      return NextResponse.json(
        { success: false, message: "Location not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: location,
    });
  } catch (error) {
    console.error("Failed to fetch location:", error);
    return NextResponse.json(
      { success: false, message: "Failed to fetch location" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await requireScope("write");
    if (!authResult.ok) return authResult.response;

    await connectDB();
    const { id } = await params;
    const body = await validateBody(request, InventoryLocationBodySchema);

    const { name, address, isDefault, isActive } = body;

    // Scoped, so one merchant cannot rename or deactivate another's location.
    const existing = await InventoryLocation.findOne(
      locationOwnerFilter(authResult.scope, { _id: id }),
    );
    if (!existing) {
      return NextResponse.json(
        { success: false, message: "Location not found" },
        { status: 404 }
      );
    }

    // Validate name if provided
    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length === 0) {
        return NextResponse.json(
          { success: false, message: "Location name cannot be empty" },
          { status: 400 }
        );
      }
      existing.name = name.trim();
    }

    // Update address if provided
    if (address !== undefined) {
      existing.address = address?.trim() || "";
    }

    // Update isActive if provided
    if (isActive !== undefined) {
      existing.isActive = Boolean(isActive);
    }

    if ("pickupEnabled" in body) {
      // Checked against the address as it will be after this save, so turning
      // collection on for a branch that already has an address is allowed while
      // clearing the address of a collection point is not.
      const addressError = pickupAddressError(body, existing.address);
      if (addressError) {
        return NextResponse.json(
          { success: false, message: addressError },
          { status: 400 },
        );
      }
      Object.assign(existing, pickupFieldsFromBody(body));
    }

    Object.assign(existing, dispatchFieldsFromBody(body));
    Object.assign(existing, counterFieldsFromBody(body));

    // Re-resolved whenever the address changes or a map link is pasted: a
    // branch that moved must stop being found at the old point.
    //
    // The stored link is passed as the fallback so an address typo fix, which
    // sends no `mapsUrl`, re-derives the merchant's own pin instead of quietly
    // reverting the branch to the vendor's registered address.
    if ("mapsUrl" in body || address !== undefined) {
      const resolved = await resolveLocationGeo(
        body,
        String(existing.vendorId ?? authResult.scope.vendorId),
        existing.mapsUrl,
      );
      existing.mapsUrl = resolved.mapsUrl;
      existing.geo = resolved.geo;
    }

    // Handle isDefault change
    if (isDefault !== undefined) {
      if (isDefault) {
        // Clearing the other defaults is the schema's pre-save hook's job, and
        // it scopes the sweep to this owner. Doing it here as well was how one
        // merchant's save used to un-default everybody else's.
        existing.isDefault = true;
      } else {
        // Only this owner's defaults count — another merchant's default must
        // not be what keeps this one from being unset.
        const defaultCount = await InventoryLocation.countDocuments(
          locationOwnerFilter(authResult.scope, { isDefault: true }),
        );
        if (defaultCount <= 1 && existing.isDefault) {
          return NextResponse.json(
            {
              success: false,
              message: "Cannot unset the only default location",
            },
            { status: 400 }
          );
        }
        existing.isDefault = false;
      }
    }

    await existing.save();

    return NextResponse.json({
      success: true,
      data: existing.toObject(),
      message: "Location updated successfully",
    });
  } catch (error) {
    if (error instanceof ValidationError) return handleApiError(error);
    console.error("Failed to update location:", error);
    return NextResponse.json(
      { success: false, message: "Failed to update location" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const authResult = await requireScope("write");
    if (!authResult.ok) return authResult.response;
    const demoBlock = getDemoModeMutationResponse();
    if (demoBlock) return demoBlock;

    await connectDB();
    const { id } = await params;

    const location = await InventoryLocation.findOne(
      locationOwnerFilter(authResult.scope, { _id: id }),
    );

    if (!location) {
      return NextResponse.json(
        { success: false, message: "Location not found" },
        { status: 404 }
      );
    }

    // Prevent deleting the default location
    if (location.isDefault) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Cannot delete the default location. Set another location as default first.",
        },
        { status: 400 }
      );
    }

    // Block deletion while stock or open transfers still reference this
    // location. Deleting anyway would leave ghost locationInventory entries
    // that keep counting as sellable stock (and let in-flight transfers
    // complete against a location that no longer exists).
    //
    // Deliberately NOT scoped to the owner. Stock rows carry a bare location id
    // with no ownership of their own, so a store upgraded from the platform-wide
    // model can still hold another merchant's units here. Scoping the check
    // would let this delete silently destroy them.
    const { Product, Transfer } = await import("@/models");
    const [productWithStock, openTransfer] = await Promise.all([
      Product.exists({
        $or: [
          {
            locationInventory: {
              $elemMatch: { locationId: id, quantity: { $gt: 0 } },
            },
          },
          {
            "variants.locationInventory": {
              $elemMatch: { locationId: id, quantity: { $gt: 0 } },
            },
          },
        ],
      }),
      Transfer.exists({
        $or: [{ fromLocationId: id }, { toLocationId: id }],
        status: { $in: ["draft", "ready_to_ship", "in_transit"] },
      }),
    ]);
    if (productWithStock) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Cannot delete: products still hold stock at this location. Transfer or zero out that stock first.",
        },
        { status: 400 }
      );
    }
    if (openTransfer) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Cannot delete: open transfers reference this location. Complete or cancel them first.",
        },
        { status: 400 }
      );
    }

    await InventoryLocation.findByIdAndDelete(id);

    // Clean up zero-quantity references so nothing points at a ghost location.
    await Promise.allSettled([
      Product.updateMany(
        { "locationInventory.locationId": id },
        { $pull: { locationInventory: { locationId: id } } },
      ),
      Product.updateMany(
        { "variants.locationInventory.locationId": id },
        { $pull: { "variants.$[].locationInventory": { locationId: id } } },
      ),
    ]);

    return NextResponse.json({
      success: true,
      message: "Location deleted successfully",
    });
  } catch (error) {
    console.error("Failed to delete location:", error);
    return NextResponse.json(
      { success: false, message: "Failed to delete location" },
      { status: 500 }
    );
  }
}
