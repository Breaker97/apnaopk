import type {
  ProductEditorFields,
  UploadTarget,
} from "@/contracts/mobile/biz/v1";
import type { BizWorkspaceGrant } from "@/lib/api-core/biz/actor";
import { resolveBizUpload } from "@/lib/api-next/biz-upload";
import { parseExternalVideoUrl } from "@/lib/products/external-video";
import {
  editorRefusal,
  type EditorDocument,
} from "@/lib/products/business-editor";
import { BizProductWrite } from "@/models/biz-product-write.model";
import { storedEditorMedia } from "./editor-stored-media";

/** IDs resolve server-side; a caller cannot attach arbitrary public URLs or private keys. */
export async function resolveEditorMedia(input: {
  changes: Partial<ProductEditorFields>;
  before?: EditorDocument;
  actorId: string;
  grant: BizWorkspaceGrant;
  target: UploadTarget;
}): Promise<EditorDocument> {
  const changes: EditorDocument = { ...input.changes };
  const beforeMedia = storedEditorMedia(input.before);
  const resolve = (
    id: string,
    purpose: "product_media" | "digital_asset" | "digital_preview",
  ) =>
    resolveBizUpload({
      id,
      actorId: input.actorId,
      grant: input.grant,
      request: { target: input.target, purpose },
    });
  if (input.changes.media) {
    const ids = new Set<string>();
    changes.media = await Promise.all(
      input.changes.media.map(async (media, position) => {
        if (ids.has(media.id))
          editorRefusal(
            "PRODUCT_FIELD_NOT_ALLOWED",
            "Media IDs must be unique.",
            "media",
          );
        ids.add(media.id);
        if (media.type === "external_video") {
          const parsed = parseExternalVideoUrl(media.url || "");
          if (!parsed)
            editorRefusal(
              "PRODUCT_FIELD_NOT_ALLOWED",
              "Select a valid YouTube or Vimeo URL.",
              "media",
            );
          return {
            _id: media.id,
            type: media.type,
            ...parsed,
            alt: media.alt,
            position,
          };
        }
        if (media.uploadId) {
          const upload = await resolve(media.uploadId, "product_media");
          const value = upload.value!;
          const type = value.mimeType.startsWith("image/")
            ? "image"
            : value.mimeType.startsWith("video/")
              ? "video"
              : ["model/gltf-binary", "model/gltf+json"].includes(
                    value.mimeType,
                  )
                ? "model"
                : null;
          if (!type || type !== media.type || !value.url || upload.private)
            editorRefusal(
              "PRODUCT_FIELD_NOT_ALLOWED",
              "This upload does not match the media type.",
              "media",
            );
          return {
            _id: media.id,
            type,
            url: value.url,
            filename: value.filename,
            mimeType: value.mimeType,
            size: value.size,
            alt: media.alt,
            fit: media.fit,
            position,
          };
        }
        const existing = beforeMedia.find(
          (item: EditorDocument) => String(item._id) === media.id,
        );
        if (
          !existing ||
          existing.url !== media.url ||
          existing.type !== media.type
        )
          editorRefusal(
            "PRODUCT_FIELD_NOT_ALLOWED",
            "Use an authorized upload for new media.",
            "media",
          );
        return {
          ...existing,
          alt: media.alt ?? existing.alt,
          fit: media.fit ?? existing.fit,
          position,
        };
      }),
    );
    changes.images = changes.media
      .filter((media: EditorDocument) => media.type === "image")
      .map((media: EditorDocument) => media.url);
  } else if (input.changes.images) {
    const existing = new Set<string>(input.before?.images || []);
    if (input.changes.images.some((url) => !existing.has(url)))
      editorRefusal(
        "PRODUCT_FIELD_NOT_ALLOWED",
        "Use the media list and scoped uploads for new images.",
        "images",
      );
    changes.media = input.changes.images.map((url, position) => {
      const media = beforeMedia.find(
        (item: EditorDocument) => item.type === "image" && item.url === url,
      );
      if (!media)
        editorRefusal(
          "PRODUCT_FIELD_NOT_ALLOWED",
          "Reload existing media before changing image order.",
          "images",
        );
      return { ...media, position };
    });
  }
  if (input.changes.digitalAssets) {
    const ids = new Set<string>();
    changes.digitalAssets = await Promise.all(
      input.changes.digitalAssets.map(async (asset, position) => {
        if (ids.has(asset.id))
          editorRefusal(
            "PRODUCT_FIELD_NOT_ALLOWED",
            "Digital asset IDs must be unique.",
            "digitalAssets",
          );
        ids.add(asset.id);
        if (asset.uploadId) {
          const upload = await resolve(asset.uploadId, "digital_asset");
          if (!upload.private)
            editorRefusal(
              "PRODUCT_FIELD_NOT_ALLOWED",
              "Digital deliverables require private storage.",
              "digitalAssets",
            );
          if (
            await BizProductWrite.exists({
              "before.digitalAssets.storageKey": upload.storageKey,
              "after.digitalAssets.storageKey": { $ne: upload.storageKey },
            })
          )
            editorRefusal(
              "PRODUCT_FIELD_NOT_ALLOWED",
              "This digital upload was removed. Upload the file again before attaching it.",
              "digitalAssets",
            );
          return {
            _id: asset.id,
            storageKey: upload.storageKey,
            filename: upload.value!.filename,
            size: upload.value!.size,
            mimeType: upload.value!.mimeType,
            position,
          };
        }
        const existing = input.before?.digitalAssets?.find(
          (item: EditorDocument) => String(item._id) === asset.id,
        );
        if (!existing)
          editorRefusal(
            "PRODUCT_FIELD_NOT_ALLOWED",
            "Use an authorized upload for a new digital file.",
            "digitalAssets",
          );
        return { ...existing, position };
      }),
    );
  }
  if (input.changes.digitalPreview) {
    if (input.changes.digitalPreview.uploadId) {
      const upload = await resolve(
        input.changes.digitalPreview.uploadId,
        "digital_preview",
      );
      if (upload.private || !upload.value?.url)
        editorRefusal(
          "PRODUCT_FIELD_NOT_ALLOWED",
          "A preview needs a public scoped upload.",
          "digitalPreview",
        );
      changes.digitalPreview = {
        url: upload.value.url,
        filename: upload.value.filename,
        size: upload.value.size,
        mimeType: upload.value.mimeType,
      };
    } else {
      if (
        input.changes.digitalPreview.url !== input.before?.digitalPreview?.url
      )
        editorRefusal(
          "PRODUCT_FIELD_NOT_ALLOWED",
          "Use an authorized upload for a new preview.",
          "digitalPreview",
        );
      changes.digitalPreview = input.before?.digitalPreview;
    }
  }
  const media = changes.media || beforeMedia;
  for (const variant of input.changes.variants || []) {
    if (
      variant.mediaId &&
      !media.some((item: EditorDocument) => item._id === variant.mediaId)
    )
      editorRefusal(
        "PRODUCT_FIELD_NOT_ALLOWED",
        "Select media attached to this product.",
        "variants",
      );
    if (
      variant.image &&
      !media.some(
        (item: EditorDocument) =>
          item.url === variant.image && item.type === "image",
      )
    )
      editorRefusal(
        "PRODUCT_FIELD_NOT_ALLOWED",
        "Select a product image for this variant.",
        "variants",
      );
  }
  return changes;
}
