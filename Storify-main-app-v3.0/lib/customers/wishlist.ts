import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { CustomerProfile, Product, Wishlist } from "@/models";
import { ValidationError } from "@/lib/api/errors";
import {
  isStorefrontMultiVendorEnabled,
  isStorefrontProductSourceAllowed,
} from "@/lib/catalog/product-visibility";
import {
  PRODUCT_CARD_SELECT,
  serializeProductCards,
  type StorefrontProductCard,
} from "@/lib/products/storefront-product-cards";

/**
 * A shopper's wishlist: the one place it is read and changed, for the web
 * (app/api/wishlist) and the mobile API alike. Adding a product already
 * there, or removing one that is not, changes nothing.
 */

/** Keep the profile's wishlist count in step; it is a display figure, so best effort. */
function recordWishlistCount(userId: string, count: number): void {
  CustomerProfile.updateOne(
    { userId },
    { $set: { "stats.totalWishlistItems": count } },
  ).catch(() => {});
}

type PopulatedItem = {
  productId:
    | (Record<string, unknown> & {
        _id: unknown;
        status?: string;
        productSource?: string;
      })
    | null;
  addedAt?: Date;
};

/**
 * The saved products the store still sells, in the order they were saved,
 * each with the fields the web's wishlist page shows.
 */
export async function readWishlistProducts(userId: string) {
  await connectDB();
  const isMultiVendorEnabled = await isStorefrontMultiVendorEnabled();

  const wishlist = await Wishlist.findOne({ userId })
    .populate({
      path: "items.productId",
      select:
        "name slug price comparePrice images stock status featured rating reviewCount options variants createdAt productSource",
      populate: {
        path: "vendorId",
        select: "storeName slug",
      },
    })
    .lean();
  if (!wishlist) return [];

  // `populate` swapped the ObjectId for the product document (or null when
  // the product was deleted).
  const populated = (wishlist.items || []) as unknown as PopulatedItem[];
  return populated
    .filter(
      (item): item is PopulatedItem & { productId: NonNullable<PopulatedItem["productId"]> } =>
        item.productId !== null &&
        item.productId.status === "active" &&
        isStorefrontProductSourceAllowed(item.productId.productSource, isMultiVendorEnabled),
    )
    .map((item) => ({
      productId: item.productId._id,
      product: item.productId,
      addedAt: item.addedAt,
    }));
}

type SavedItem = { productId: unknown; addedAt?: Date };

/**
 * One page of the saved products, newest first, as the storefront's product
 * cards (`PRODUCT_CARD_SELECT`, trimmed by `serializeProductCards`, the
 * seller's name and slug joined in), for the app's wishlist.
 *
 * Paged over everything saved, so the pages stay put when a product leaves
 * the store; a product the store no longer sells is left out of its page, by
 * the same rule as the web's list (`readWishlistProducts`). A sold-out product
 * stays: the shopper saved it to come back to.
 */
export async function readWishlistCards(
  userId: string,
  { page, limit }: { page: number; limit: number },
): Promise<{
  items: Array<{ product: StorefrontProductCard; addedAt: Date }>;
  totalPages: number;
}> {
  await connectDB();
  const wishlist = await Wishlist.findOne({ userId })
    .select("items createdAt")
    .lean<{ items?: SavedItem[]; createdAt?: Date }>();
  // Saved in order, so newest first is the list read backwards.
  const saved = [...(wishlist?.items ?? [])].reverse();
  const totalPages = Math.max(1, Math.ceil(saved.length / limit));
  const pageItems = saved.slice((page - 1) * limit, page * limit);
  if (pageItems.length === 0) return { items: [], totalPages };

  const [isMultiVendorEnabled, products] = await Promise.all([
    isStorefrontMultiVendorEnabled(),
    Product.find({
      _id: { $in: pageItems.map((item) => item.productId) },
      status: "active",
    })
      .select(`${PRODUCT_CARD_SELECT} productSource`)
      .populate("vendorId", "storeName slug")
      .populate("category", "name slug")
      .lean(),
  ]);
  const cards = new Map(
    serializeProductCards(
      products.filter((product) =>
        isStorefrontProductSourceAllowed(
          (product as { productSource?: unknown }).productSource,
          isMultiVendorEnabled,
        ),
      ),
    ).map((card) => [String(card._id), card]),
  );

  const items = pageItems.flatMap((item) => {
    const product = cards.get(String(item.productId));
    if (!product) return [];
    // `addedAt` has a default; the list's own start is the fallback for an
    // entry written without one.
    const addedAt = item.addedAt ?? wishlist?.createdAt ?? new Date();
    return [{ product, addedAt: new Date(addedAt) }];
  });
  return { items, totalPages };
}

/**
 * Save a product. Refuses one that does not exist or is not for sale.
 * Answers how many products the wishlist holds.
 */
export async function addToWishlist(
  userId: string,
  productId: string,
): Promise<{ itemCount: number }> {
  await connectDB();
  const isMultiVendorEnabled = await isStorefrontMultiVendorEnabled();

  const product = await Product.findById(productId).select("status productSource").lean();
  if (!product) {
    throw new ValidationError({ productId: ["Product not found"] });
  }
  if (
    product.status !== "active" ||
    !isStorefrontProductSourceAllowed(
      (product as { productSource?: unknown }).productSource,
      isMultiVendorEnabled,
    )
  ) {
    throw new ValidationError({ productId: ["Product is not available"] });
  }

  // Get or create wishlist. `userId` is unique at the DB level, so a
  // concurrent first-add races into a duplicate-key error — retry once
  // against the winner's document instead of failing the request.
  let wishlist = await Wishlist.findOne({ userId });
  if (!wishlist) {
    wishlist = new Wishlist({ userId, items: [] });
  }

  const existingIndex = wishlist.items.findIndex(
    (item: { productId: { toString: () => string } }) => item.productId.toString() === productId,
  );
  if (existingIndex === -1) {
    wishlist.items.push({
      productId: new Types.ObjectId(productId),
      addedAt: new Date(),
    });
    try {
      await wishlist.save();
    } catch (err) {
      const isDuplicate =
        typeof err === "object" && err !== null && (err as { code?: number }).code === 11000;
      if (!isDuplicate) throw err;
      // Guard by items.productId, not $addToSet of the whole subdocument —
      // the winner's entry has a different addedAt, so $addToSet would treat
      // it as distinct and insert a duplicate row for the same product.
      await Wishlist.updateOne(
        { userId, "items.productId": { $ne: productId } },
        { $push: { items: { productId, addedAt: new Date() } } },
      );
      wishlist = await Wishlist.findOne({ userId });
      if (!wishlist) throw err;
    }
    recordWishlistCount(userId, wishlist.items.length);
  }

  return { itemCount: wishlist.items.length };
}

/** Take a product out. Answers how many products the wishlist still holds. */
export async function removeFromWishlist(
  userId: string,
  productId: string,
): Promise<{ itemCount: number }> {
  await connectDB();
  const wishlist = await Wishlist.findOne({ userId });
  if (wishlist) {
    wishlist.items = wishlist.items.filter(
      (item: { productId: { toString: () => string } }) => item.productId.toString() !== productId,
    );
    await wishlist.save();
    recordWishlistCount(userId, wishlist.items.length);
  }
  return { itemCount: wishlist?.items.length || 0 };
}

/** Whether this product is saved: the product page's heart. */
export async function isInWishlist(userId: string, productId: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(productId)) return false;
  await connectDB();
  const found = await Wishlist.exists({
    userId,
    "items.productId": new Types.ObjectId(productId),
  });
  return Boolean(found);
}

/** The ids of every saved product, in the order they were saved. */
export async function wishlistProductIds(userId: string): Promise<string[]> {
  await connectDB();
  const wishlist = await Wishlist.findOne({ userId })
    .select("items.productId")
    .lean<{ items?: Array<{ productId: unknown }> }>();
  return (wishlist?.items ?? []).map((item) => String(item.productId));
}
