import "server-only";

import { isValidObjectId } from "mongoose";
import { connectDB } from "@/lib/db";
import { uploadMediaFile } from "@/lib/media-upload/upload-file";
import {
  SHOPPER_IMAGE_TYPE_LIST,
  isShopperImageType,
  shopperPhotoLimitBytes,
} from "@/lib/media-upload/upload-policy";
import { getStorageConfig, getStorageService, validateUpload } from "@/lib/storage";
import { ShopperUpload } from "@/models";
import type { IShopperUpload } from "@/models/shopper-upload.model";

/**
 * A shopper's photos uploaded from the app, named by id afterwards (a
 * review's photos, the profile picture). The file goes through the same
 * upload as the website's (`uploadMediaFile`, the shopper's rules); the row
 * records whose it is.
 */

/**
 * The most bytes one photo may have from the app. The proxy reads at most
 * 10 MB of a request to /api/mobile (proxy.ts), multipart framing included,
 * so the app's ceiling sits under it.
 */
const APP_PHOTO_CEILING_BYTES = 8 * 1024 * 1024;

/** The largest multipart body POST /uploads reads: one photo and its framing. */
export const APP_UPLOAD_BODY_BYTES = APP_PHOTO_CEILING_BYTES + 512 * 1024;

export interface ShopperUploadPolicy {
  maxBytes: number;
  allowedTypes: string[];
}

/** What a photo from the app may be, with the store's own limits applied. */
export async function shopperUploadPolicy(): Promise<ShopperUploadPolicy> {
  const config = await getStorageConfig();
  return {
    maxBytes: shopperPhotoLimitBytes(config, APP_PHOTO_CEILING_BYTES),
    // `image/jpg` is a spelling of `image/jpeg`; the app names the real one.
    allowedTypes: SHOPPER_IMAGE_TYPE_LIST.filter((type) => type !== "image/jpg"),
  };
}

export type ShopperUploadRefusal =
  | "UPLOAD_MISSING"
  | "UPLOAD_TOO_LARGE"
  | "UPLOAD_TYPE_NOT_ALLOWED"
  | "UPLOAD_UNREADABLE";

export class ShopperUploadError extends Error {
  constructor(
    readonly reason: ShopperUploadRefusal,
    message: string,
  ) {
    super(message);
    this.name = "ShopperUploadError";
  }
}

/** The image could not be decoded: refused as the file's fault, not the store's. */
const UNREADABLE = /Unable to read the uploaded image|Missing image dimensions|Unable to convert image/;

export type StoredShopperUpload = IShopperUpload & { _id: unknown };

export async function storeShopperUpload(
  userId: string,
  file: unknown,
): Promise<StoredShopperUpload> {
  if (!(file instanceof File) || file.size === 0) {
    throw new ShopperUploadError("UPLOAD_MISSING", "Send one photo in the form field \"file\".");
  }
  const [config, policy] = await Promise.all([getStorageConfig(), shopperUploadPolicy()]);
  if (!isShopperImageType(file.type)) {
    throw new ShopperUploadError(
      "UPLOAD_TYPE_NOT_ALLOWED",
      "Only photos can be uploaded (JPEG, PNG, GIF, WebP, AVIF or HEIC).",
    );
  }
  if (file.size > policy.maxBytes) {
    throw new ShopperUploadError(
      "UPLOAD_TOO_LARGE",
      `Photos can be at most ${Math.floor(policy.maxBytes / (1024 * 1024))} MB.`,
    );
  }
  const storeVerdict = validateUpload(config, file.size, file.type);
  if (!storeVerdict.valid) {
    throw new ShopperUploadError("UPLOAD_TYPE_NOT_ALLOWED", storeVerdict.error || "This store does not take this file.");
  }

  let stored;
  try {
    stored = await uploadMediaFile(file, {
      config,
      storage: await getStorageService(),
      uploadedBy: userId,
      shopper: true,
    });
  } catch (error) {
    if (error instanceof Error && UNREADABLE.test(error.message)) {
      throw new ShopperUploadError("UPLOAD_UNREADABLE", "This photo could not be read. Try another one.");
    }
    throw error;
  }

  await connectDB();
  const row = await ShopperUpload.create({
    userId,
    url: stored.url,
    key: stored.key,
    mimeType: stored.mimeType,
    size: stored.size,
    ...(stored.width !== undefined ? { width: stored.width } : {}),
    ...(stored.height !== undefined ? { height: stored.height } : {}),
  });
  return row.toObject() as StoredShopperUpload;
}

/**
 * The URLs of uploads, in the order asked, when every one is this shopper's;
 * null when any is not (unknown, or somebody else's), so a caller refuses
 * the whole change.
 */
export async function shopperUploadUrls(userId: string, ids: readonly string[]): Promise<string[] | null> {
  if (ids.length === 0) return [];
  if (!ids.every((id) => isValidObjectId(id))) return null;
  await connectDB();
  const rows = await ShopperUpload.find({ _id: { $in: ids }, userId })
    .select("_id url")
    .lean<Array<{ _id: unknown; url: string }>>();
  const byId = new Map(rows.map((row) => [String(row._id), row.url]));
  const urls = ids.map((id) => byId.get(id));
  return urls.every((url): url is string => typeof url === "string") ? urls : null;
}
