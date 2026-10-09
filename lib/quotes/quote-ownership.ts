import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { QuoteRequest } from "@/models";

/** A vendor id as a save hands it over: bare, or populated with its store. */
function vendorIdOf(value: unknown): string | null {
  if (!value) return null;
  const id =
    typeof value === "object" && (value as { _id?: unknown })._id
      ? String((value as { _id: unknown })._id)
      : String(value);
  return Types.ObjectId.isValid(id) ? id : null;
}

/**
 * A product handed to another seller takes its open quote requests with it.
 *
 * A quote records the product's seller when it is asked (`vendorId`), and
 * that is whose Quotes page lists it. Left alone, the new seller would never
 * see the requests about a product that is now theirs, and the old one would
 * keep answering for a product they no longer sell.
 *
 * Open means not closed as lost and not spent on an order: those stay with
 * the seller who worked them, as the record of what happened under them.
 * Nothing moves unless both sides of the save name a seller and they differ.
 */
export async function moveOpenQuotesWithProduct(
  productId: string,
  fromVendor: unknown,
  toVendor: unknown,
): Promise<number> {
  const from = vendorIdOf(fromVendor);
  const to = vendorIdOf(toVendor);
  if (!from || !to || from === to || !Types.ObjectId.isValid(productId)) return 0;

  await connectDB();
  const result = await QuoteRequest.updateMany(
    {
      productId: new Types.ObjectId(productId),
      vendorId: new Types.ObjectId(from),
      status: { $ne: "lost" },
      orderId: { $exists: false },
    },
    { $set: { vendorId: new Types.ObjectId(to) } },
  );
  return result.modifiedCount ?? 0;
}
