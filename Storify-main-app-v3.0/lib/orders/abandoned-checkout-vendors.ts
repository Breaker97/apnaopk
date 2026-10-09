import { Types } from "mongoose";
import { Product } from "@/models";

/**
 * Which seller each line of a checkout belongs to, written onto the
 * abandoned-checkout record when it is saved.
 *
 * The record keeps the seller rather than looking it up through the product
 * when someone reads the list: a product deleted, or moved to another seller,
 * after the shopper left must not take the line with it — or hand the shopper
 * to a seller whose goods they never chose.
 */

type CheckoutLine = { productId?: unknown };

/** A line's product id, whether the cart holds it bare or populated. */
function productIdOf(line: CheckoutLine | null | undefined): string | null {
  const value = line?.productId;
  if (!value) return null;
  const id =
    typeof value === "object" && "_id" in value
      ? (value as { _id?: unknown })._id
      : value;
  const text = String(id ?? "");
  return Types.ObjectId.isValid(text) ? text : null;
}

/** A cart line as a plain object, so a field can be added to it. */
function plainLine<T>(line: T): T {
  const doc = line as unknown as { toObject?: () => T } | null;
  return doc && typeof doc.toObject === "function" ? doc.toObject() : line;
}

/**
 * The checkout's lines, each with its seller, and the sellers as a set.
 *
 * Null when the products could not be read. The caller then writes the lines
 * as they are and leaves the sellers recorded before in place, rather than
 * recording that nobody sells what is in the basket.
 */
export async function stampCheckoutLineVendors<T extends CheckoutLine>(
  lines: readonly T[],
): Promise<{
  items: Array<T & { vendorId?: Types.ObjectId }>;
  vendorIds: Types.ObjectId[];
} | null> {
  const productIds = Array.from(
    new Set(
      lines
        .map((line) => productIdOf(line))
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const owners = new Map<string, Types.ObjectId>();
  if (productIds.length > 0) {
    try {
      const products = await Product.find({ _id: { $in: productIds } })
        .select("vendorId")
        .lean<Array<{ _id: unknown; vendorId?: unknown }>>();
      for (const product of products) {
        const vendorId = String(product.vendorId ?? "");
        if (Types.ObjectId.isValid(vendorId)) {
          owners.set(String(product._id), new Types.ObjectId(vendorId));
        }
      }
    } catch {
      return null;
    }
  }

  const vendorIds = new Map<string, Types.ObjectId>();
  const items = lines.map((line) => {
    const plain = plainLine(line);
    const productId = productIdOf(line);
    const vendorId = productId ? owners.get(productId) : undefined;
    if (!vendorId) return plain;
    vendorIds.set(String(vendorId), vendorId);
    return { ...plain, vendorId };
  });

  return { items, vendorIds: Array.from(vendorIds.values()) };
}
