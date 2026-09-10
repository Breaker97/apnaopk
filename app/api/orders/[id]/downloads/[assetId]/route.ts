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
      .select("items paymentStatus digitalDownloads subOrders.vendorId subOrders.status subOrders.paymentStatus")
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
    const productIds = orderEntitledProductIds(order);
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

    // Enforce the per-order download limit (0 = unlimited).
    const downloadLimit = product.digitalDelivery?.downloadLimit ?? 0;
    if (downloadLimit > 0) {
      const used =
        order.digitalDownloads?.find(
          (d: { assetId: string }) => d.assetId === assetId,
        )?.count ?? 0;
      if (used >= downloadLimit) {
        throw new AuthorizationError(
          "The download limit for this file has been reached",
        );
      }
    }

    // Count the download atomically: bump the existing counter, or create it
    // guarded against a concurrent first download double-inserting.
    const now = new Date();
    const bumped = await Order.updateOne(
      { _id: order._id, "digitalDownloads.assetId": assetId },
      {
        $inc: { "digitalDownloads.$.count": 1 },
        $set: { "digitalDownloads.$.lastDownloadedAt": now },
      },
    );
    if (bumped.matchedCount === 0) {
      const pushed = await Order.updateOne(
        { _id: order._id, "digitalDownloads.assetId": { $ne: assetId } },
        {
          $push: {
            digitalDownloads: { assetId, count: 1, lastDownloadedAt: now },
          },
        },
      );
      if (pushed.modifiedCount === 0) {
        // Lost the race to another first download — bump the row it created.
        await Order.updateOne(
          { _id: order._id, "digitalDownloads.assetId": assetId },
          {
            $inc: { "digitalDownloads.$.count": 1 },
            $set: { "digitalDownloads.$.lastDownloadedAt": now },
          },
        );
      }
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
