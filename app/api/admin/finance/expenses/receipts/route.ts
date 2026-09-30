/**
 * Expense receipts, kept private.
 *
 * GET  ?key=… — show a receipt to an admin: S3/R2 installs get a 302 to a
 *               short-lived signed URL, local storage streams the bytes. A
 *               legacy receipt saved as a public URL never reaches this route
 *               (the list links to it directly).
 * POST         — store a receipt privately and return its key, which the
 *               expense then carries in `receiptUrl`.
 *
 * Private because a receipt is an invoice, a salary slip or a bank transfer —
 * names, amounts and account numbers. The public media upload put them on the
 * public bucket and in the Media Library beside product photos.
 */

import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ValidationError } from "@/lib/api/errors";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { getStorageService } from "@/lib/storage";
import {
  EXPENSE_RECEIPT_KEY_PREFIX,
  EXPENSE_RECEIPT_MAX_SIZE_MB,
  EXPENSE_RECEIPT_MIME_TYPES,
  isExpenseReceiptKey,
} from "@/lib/finance/expense-receipts";

const VIEW_URL_TTL_SECONDS = 300;

/** What a streamed receipt is served as, read off the extension the key keeps. */
const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/** RFC 6266 Content-Disposition with a UTF-8 fallback for non-ASCII names. */
function inlineDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export const GET = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:expense-receipts:view", preset: "lenient" },
  },
  async ({ request }) => {
    const key = new URL(request.url).searchParams.get("key") || "";

    // The prefix and segment check is the authorization boundary inside
    // private storage: vendor identity documents and digital product files
    // live in the same store.
    if (!isExpenseReceiptKey(key)) {
      throw new ValidationError("Invalid receipt key");
    }

    const storage = await getStorageService();
    const filename = key.split("/").pop() || "receipt";

    let download;
    try {
      download = await storage.getPrivateDownload(key, {
        expiresInSeconds: VIEW_URL_TTL_SECONDS,
        filename,
        disposition: "inline",
      });
    } catch (error) {
      // Local storage stats the file before streaming — a removed receipt
      // should read as missing, not as a server error.
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        return notFoundResponse("Receipt");
      }
      throw error;
    }

    if (download.kind === "redirect") {
      return NextResponse.redirect(download.url, 302);
    }

    const extension = filename.split(".").pop()?.toLowerCase() ?? "";
    const headers = new Headers({
      // Only the four types the upload accepts are shown inline; anything else
      // is handed over as bytes, never interpreted on this origin.
      "Content-Type":
        CONTENT_TYPE_BY_EXTENSION[extension] ?? "application/octet-stream",
      "Content-Disposition": CONTENT_TYPE_BY_EXTENSION[extension]
        ? inlineDisposition(filename)
        : "attachment",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    });
    if (download.size) headers.set("Content-Length", String(download.size));
    return new Response(download.body, { headers });
  },
);

export const POST = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:expense-receipts:upload", preset: "moderate" },
  },
  async ({ request, session }) => {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      throw new ValidationError("No file provided");
    }

    const mimeType = file.type || "application/octet-stream";
    if (!(EXPENSE_RECEIPT_MIME_TYPES as readonly string[]).includes(mimeType)) {
      throw new ValidationError("Use a PDF, PNG, JPG or WebP file");
    }
    if (file.size > EXPENSE_RECEIPT_MAX_SIZE_MB * 1024 * 1024) {
      throw new ValidationError(
        `That file is larger than ${EXPENSE_RECEIPT_MAX_SIZE_MB} MB`,
      );
    }

    // Deliberately not the Media Library's type allowlist: a store that took
    // PDF out of its public media can still keep a PDF invoice here.
    const storage = await getStorageService();
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await storage.uploadPrivateFile(buffer, {
      fileName: file.name,
      contentType: mimeType,
      fileSize: file.size,
      customPath: EXPENSE_RECEIPT_KEY_PREFIX,
      metadata: {
        uploadedBy: session.user.id,
        originalName: file.name,
        purpose: "expense-receipt",
      },
    });

    return successResponse({
      key: result.key,
      filename: file.name,
      mimeType,
      size: file.size,
    });
  },
);
