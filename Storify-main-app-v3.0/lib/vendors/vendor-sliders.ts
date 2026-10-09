import "server-only";

import { revalidateTag, unstable_cache } from "next/cache";
import { ValidationError } from "@/lib/api/errors";
import { connectDB, mongoose } from "@/lib/db";
import { slugify } from "@/lib/strings";
import {
  normalizeSliderDocument,
  type SliderControls,
  type SliderDocument,
  type SliderSlide,
  type SliderTransition,
} from "@/lib/sliders/types";
import { isInternalLink } from "@/lib/vendors/vendor-store-page";
import { Product } from "@/models";
import { VendorSlider } from "@/models/vendor-slider.model";

/** A store's sliders are a handful; the cap keeps a runaway script bounded. */
export const VENDOR_SLIDER_LIMIT = 30;

export const vendorSlidersTag = (vendorId: string) => `vendor-sliders:${vendorId}`;

/** Expire one vendor's cached sliders after a live change. */
export function revalidateVendorSliders(vendorId: string) {
  revalidateTag(vendorSlidersTag(vendorId), { expire: 0 });
}

/**
 * One of the vendor's sliders by id or handle — never another vendor's,
 * whatever the request names.
 */
export function vendorSliderLookup(
  vendorId: unknown,
  key: string,
): { vendorId: string; _id: string } | { vendorId: string; handle: string } {
  const owner = String(vendorId);
  const decoded = decodeURIComponent(key).trim();
  if (mongoose.Types.ObjectId.isValid(decoded)) {
    return { vendorId: owner, _id: decoded };
  }
  const handle = slugify(decoded);
  if (!handle) throw new ValidationError("Invalid slider id or handle");
  return { vendorId: owner, handle };
}

/**
 * The vendor rules on top of the slider contract: every slide link stays on
 * this marketplace, and a slide binds only the vendor's own products (a
 * foreign id is cleared, so its price never shows on the store).
 */
export async function vendorSlides(
  slides: SliderSlide[],
  vendorId: string,
): Promise<SliderSlide[]> {
  for (const slide of slides) {
    if (!isInternalLink(slide.link) || !isInternalLink(slide.link2)) {
      throw new ValidationError(
        "Slide links must point to a page on this store, starting with /",
      );
    }
  }
  const ids = [
    ...new Set(
      slides
        .map((slide) => slide.productId)
        .filter((id) => id && mongoose.isValidObjectId(id)),
    ),
  ];
  const owned = new Set<string>();
  if (ids.length > 0) {
    const rows = await Product.find({
      _id: { $in: ids },
      vendorId: new mongoose.Types.ObjectId(vendorId),
    })
      .select("_id")
      .lean<{ _id: unknown }[]>();
    for (const row of rows) owned.add(String(row._id));
  }
  return slides.map((slide) =>
    slide.productId && !owned.has(slide.productId)
      ? { ...slide, productId: "" }
      : slide,
  );
}

export interface VendorStorefrontSlider {
  handle: string;
  transition: SliderTransition;
  autoplaySeconds: number;
  controls: SliderControls;
  slides: SliderDocument["slides"];
}

/**
 * A vendor's slider as their landing page draws it: the PUBLISHED content of
 * an active slider, normalized on read; anything else resolves to null and
 * the section renders nothing. Cached per vendor.
 */
export async function getVendorStorefrontSlider(
  vendorId: string,
  handle: string,
): Promise<VendorStorefrontSlider | null> {
  if (!handle || !mongoose.isValidObjectId(vendorId)) return null;
  return unstable_cache(
    async (): Promise<VendorStorefrontSlider | null> => {
      await connectDB();
      const raw = await VendorSlider.findOne({
        vendorId,
        handle,
        isActive: true,
      }).lean();
      if (!raw) return null;
      const doc = normalizeSliderDocument(raw);
      return {
        handle: doc.handle,
        transition: doc.transition,
        autoplaySeconds: doc.autoplaySeconds,
        controls: doc.controls,
        slides: doc.slides,
      };
    },
    ["vendor-storefront-slider", vendorId, handle],
    { tags: [vendorSlidersTag(vendorId)], revalidate: 300 },
  )();
}

/** The vendor's slider handles that exist — for the page write gate. */
export async function existingVendorSliderHandles(
  vendorId: string,
  handles: string[],
): Promise<Set<string>> {
  const wanted = [...new Set(handles.filter(Boolean))];
  if (wanted.length === 0) return new Set();
  const rows = await VendorSlider.find({ vendorId, handle: { $in: wanted } })
    .select("handle")
    .lean<{ handle: string }[]>();
  return new Set(rows.map((row) => row.handle));
}
