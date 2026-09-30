import { withApi } from "@/lib/api/handler";
import { notFoundResponse } from "@/lib/api/response";
import { isValidObjectId } from "@/lib/api/validate";
import { connectDB } from "@/lib/db";
import { ReturnRequest } from "@/models";
import { returnLabelResponse } from "@/lib/returns/return-label-file";

/**
 * The shopper's own return label — the file the store uploaded when it approved
 * the return. Only ever their own return, and only while there is a parcel to
 * send.
 */
export const GET = withApi<{ id: string }>(
  {
    auth: "user",
    rateLimit: { action: "returns:label:view", preset: "lenient" },
  },
  async ({ params, session }) => {
    if (!isValidObjectId(params.id)) return notFoundResponse("Return label");
    await connectDB();
    const returnRequest = await ReturnRequest.findOne({
      _id: params.id,
      customerId: session.user.id,
      returnMethod: "label",
    })
      .select("shipment.labelFileKey shipment.labelFileName")
      .lean<{ shipment?: { labelFileKey?: string; labelFileName?: string } } | null>();
    if (!returnRequest?.shipment?.labelFileKey) {
      return notFoundResponse("Return label");
    }
    return returnLabelResponse(
      returnRequest.shipment.labelFileKey,
      returnRequest.shipment.labelFileName,
    );
  },
);
