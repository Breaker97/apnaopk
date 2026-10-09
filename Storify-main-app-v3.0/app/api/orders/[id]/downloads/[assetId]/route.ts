/**
 * GET /api/orders/[id]/downloads/[assetId]
 *
 * Deliver one digital file from a paid order owned by the signed-in
 * customer. S3/R2 installs get a 302 to a short-lived always-signed URL;
 * local-storage installs stream the bytes directly (files live outside
 * public/ and have no URL of their own).
 */

import { NextResponse } from "next/server";
import { AuthorizationError } from "@/lib/api/errors";
import { isValidObjectId } from "@/lib/api/validate";
import { notFoundResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { Order, Product } from "@/models";
import { getStorageService } from "@/lib/storage";
import { DIGITAL_DOWNLOAD_URL_TTL_SECONDS } from "@/lib/products/digital-assets";
import {
  fullyRefundedLines,
  isOrderEntitledToDownloads,
  orderEntitledProductIds,
} from "@/lib/orders/order-digital-downloads";

/** RFC 6266 Content-Disposition with a UTF-8 fallback for non-ASCII names. */
function attachmentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export const GET = withApi<{ id: string; assetId: string }>(
  {
    auth: "user",
    rateLimit: { action: "orders:downloads:file", preset: "moderate" },
  },
  async ({ params, session }) => {
    const { id, assetId } = params;

    // Accept the Mongo _id or the orderNumber — the checkout success page
    // often only has the latter (mirrors the invoice route).
    const order = await Order.findOne({
      ...(isValidObjectId(id) ? { _id: id } : { orderNumber: id }),
      customerId: session.user.id,
    })
      .select("items status paymentStatus goodsRefundedAt digitalDownloads subOrders.vendorId subOrders.status subOrders.paymentStatus")
      .lean();
    if (!order) return notFoundResponse("Order");

    if (!isOrderEntitledToDownloads(order)) {
      throw new AuthorizationError(
        "Downloads become available once the order is paid",
      );
    }

    // The asset must belong to a product this order entitles the customer to
    // — which on a split order is narrower than "on the order": only the
    // consignments whose money has actually arrived. Shared with the listing
    // route so one rule cannot start admitting what the other refuses.
    const productIds = orderEntitledProductIds(
      order,
      await fullyRefundedLines(order),
    );
    const product = await Product.findOne({
      _id: { $in: productIds },
      "digitalAssets._id": assetId,
    })
      .select("digitalAssets digitalDelivery")
      .lean();
    const asset = product?.digitalAssets?.find(
      (a: { _id: string }) => a._id === assetId,
    );
    if (!product || !asset) return notFoundResponse("File");

    // The per-order download limit (0 = unlimited) is checked in the same
    // step that counts the download. Reading the count first and adding to it
    // after let parallel requests all read the same count and all get the
    // file, however low the limit.
    const downloadLimit = product.digitalDelivery?.downloadLimit ?? 0;
    const now = new Date();
    const countWithinLimit = async () =>
      (
        await Order.updateOne(
          {
            _id: order._id,
            digitalDownloads: {
              $elemMatch: {
                assetId,
                ...(downloadLimit > 0 ? { count: { $lt: downloadLimit } } : {}),
              },
            },
          },
          {
            $inc: { "digitalDownloads.$.count": 1 },
            $set: { "digitalDownloads.$.lastDownloadedAt": now },
          },
        )
      ).matchedCount > 0;

    let counted = await countWithinLimit();
    if (!counted) {
      // The file's first download creates its counter, guarded against a
      // concurrent first download inserting it twice.
      const pushed = await Order.updateOne(
        { _id: order._id, "digitalDownloads.assetId": { $ne: assetId } },
        {
          $push: {
            digitalDownloads: { assetId, count: 1, lastDownloadedAt: now },
          },
        },
      );
      // Lost that race: count against the row the other request created.
      counted = pushed.modifiedCount > 0 || (await countWithinLimit());
    }
    if (!counted) {
      throw new AuthorizationError(
        "The download limit for this file has been reached",
      );
    }

    const storage = await getStorageService();
    const download = await storage.getPrivateDownload(asset.storageKey, {
      expiresInSeconds: DIGITAL_DOWNLOAD_URL_TTL_SECONDS,
      filename: asset.filename,
    });

    if (download.kind === "redirect") {
      return NextResponse.redirect(download.url, 302);
    }

    const headers = new Headers({
      "Content-Type": asset.mimeType || "application/octet-stream",
      "Content-Disposition": attachmentDisposition(asset.filename),
      "Cache-Control": "private, no-store",
    });
    if (download.size) headers.set("Content-Length", String(download.size));
    return new Response(download.body, { headers });
  },
);
