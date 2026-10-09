import type { EditorDocument } from "@/lib/products/business-editor";

/** Legacy image-only products keep their existing URLs and stable server-issued IDs. */
export function storedEditorMedia(product?: EditorDocument): EditorDocument[] {
  if (product?.media?.length) return product.media;
  return (product?.images || []).map((url: string, position: number) => ({
    _id: `legacy-image-${position}`,
    type: "image",
    url,
    position,
  }));
}
