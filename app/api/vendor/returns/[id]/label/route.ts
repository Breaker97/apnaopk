import { withApi } from "@/lib/api/handler";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";
import { notifyReturnRequestCustomer } from "@/lib/notifications/notifications";
import { RETURN_METHOD_CHANGEABLE_STATUSES } from "@/lib/returns/return-shipping";
import { loadReturnForRoute } from "@/lib/returns/return-route-access";
import {
  attachReturnLabel,
  returnLabelResponse,
} from "@/lib/returns/return-label-file";

/**
 * A return's label, as the seller handles it: open the uploaded file, or upload
 * one. Uploading replaces any label before it.
 */

export const GET = withApi<{ id: string }>(
  {
    auth: "user",
    rateLimit: { action: "vendor:returns:label:view", preset: "lenient" },
  },
  async ({ params, session }) => {
    await connectDB();
    const returnRequest = await loadReturnForRoute({
      scope: "vendor",
      user: session.user,
      id: params.id,
      mode: "read",
    });
    if (!returnRequest?.shipment?.labelFileKey) {
      return notFoundResponse("Return label");
    }
    return returnLabelResponse(
      returnRequest.shipment.labelFileKey,
      returnRequest.shipment.labelFileName,
    );
  },
);

export const POST = withApi<{ id: string }>(
  {
    auth: "user",
    rateLimit: { action: "vendor:returns:label:upload", preset: "moderate" },
  },
  async ({ request, params, session }) => {
    await connectDB();
    const returnRequest = await loadReturnForRoute({
      scope: "vendor",
      user: session.user,
      id: params.id,
      mode: "write",
    });
    if (!returnRequest) return notFoundResponse("Return request");

    const formData = await request.formData();
    const updated = await attachReturnLabel({
      returnRequest,
      file: formData.get("file"),
      userId: session.user.id,
    });
    // A new label on a return the shopper was already told to send with one:
    // they hear again, so the label they print is the current one.
    if (
      updated.returnMethod === "label" &&
      (RETURN_METHOD_CHANGEABLE_STATUSES as readonly string[]).includes(
        String(updated.status),
      )
    ) {
      await notifyReturnRequestCustomer(
        updated,
        String(updated.status),
        await getSettings(),
        { shippingUpdated: true },
      ).catch((err) =>
        console.error("Failed to tell the shopper about a new return label:", err),
      );
    }
    return successResponse(
      {
        labelFileName: updated.shipment?.labelFileName,
        labelAddedAt: updated.shipment?.labelAddedAt,
      },
      "Label uploaded",
    );
  },
);
