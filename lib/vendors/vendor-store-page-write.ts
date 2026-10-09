import "server-only";

import { mongoose } from "@/lib/db";
import { Coupon, Product } from "@/models";
import { MERCHANT_COUPON_FILTER } from "@/models/coupon.model";
import { getSectionDefinition } from "@/lib/storefront/sections/registry";
import {
  prepareSectionsForWrite,
  SectionWriteError,
} from "@/lib/storefront/sections/write";
import type {
  BlockInstance,
  Field,
  SectionInstance,
} from "@/lib/storefront/sections/types";
import {
  isInternalLink,
  isVendorPageSectionType,
  VENDOR_PAGE_HIDDEN_FIELDS,
  VENDOR_PAGE_MAX_SECTIONS,
} from "@/lib/vendors/vendor-store-page";
import { ValidationError } from "@/lib/api/errors";
import type { SliderSlide } from "@/lib/sliders/types";
import { vendorCategoryPool } from "@/lib/vendors/vendor-category-source";
import { ownedApprovedReviewIds } from "@/lib/vendors/vendor-review-highlights";
import {
  existingVendorSliderHandles,
  vendorSlides,
} from "@/lib/vendors/vendor-sliders";
import { getVendorStoreTaxonomy } from "@/lib/vendors/vendor-store-taxonomy";

/**
 * The write gate for a vendor's landing page. The engine's own gate
 * (`prepareSectionsForWrite`, landing-page rules, the vendor surface) runs
 * first, so shape, caps, placement and rich-text sanitising are exactly the
 * admin's. On top of it, the vendor's own rules:
 *
 * - only the sections a vendor is offered (`VENDOR_PAGE_SECTION_TYPES`);
 * - a lower section cap;
 * - fields the vendor builder does not offer go back to their defaults
 *   (`VENDOR_PAGE_HIDDEN_FIELDS`, empty today: vendors get the admin's
 *   fields);
 * - every link is a path on this marketplace — a slide's links too;
 * - every picked product, discount code and slider is the vendor's own,
 *   every picked review an approved review of the vendor's products, every
 *   picked category one the store sells in (or a top-level one above it),
 *   and a slide binds only the vendor's products. A foreign one is dropped,
 *   not refused: only a hand-built request can carry one, and the
 *   storefront scopes those sections to the vendor anyway.
 *
 * Throws SectionWriteError with a reason the editor can show.
 */
export async function prepareVendorSectionsForWrite(
  raw: unknown,
  vendorId: string,
): Promise<SectionInstance[]> {
  if (Array.isArray(raw) && raw.length > VENDOR_PAGE_MAX_SECTIONS) {
    throw new SectionWriteError(
      `your landing page holds at most ${VENDOR_PAGE_MAX_SECTIONS} sections`,
    );
  }

  const sections = prepareSectionsForWrite(raw, {
    purpose: "page",
    surface: "vendor",
  });

  for (const section of sections) {
    if (!isVendorPageSectionType(section.type)) {
      throw new SectionWriteError(
        `the "${section.type}" section is not available on vendor pages`,
      );
    }
  }

  const shaped = sections.map(resetHiddenFields);

  for (const section of shaped) {
    assertInternalLinks(section);
  }

  return keepOwnReferences(await keepSlidesOnStore(shaped, vendorId), vendorId);
}

/**
 * Inline slides (the promotional banner's) under the vendor slider rules:
 * links stay on this marketplace and a slide binds only the vendor's own
 * products — the same rules its saved sliders follow.
 */
async function keepSlidesOnStore(
  sections: SectionInstance[],
  vendorId: string,
): Promise<SectionInstance[]> {
  return Promise.all(
    sections.map(async (section) => {
      const slideFields = fieldsOf(section).fields.filter(
        (field) => field.type === "slides",
      );
      if (slideFields.length === 0) return section;
      const settings = { ...section.settings };
      for (const field of slideFields) {
        const value = settings[field.key];
        if (!Array.isArray(value) || value.length === 0) continue;
        try {
          settings[field.key] = await vendorSlides(value as SliderSlide[], vendorId);
        } catch (error) {
          if (error instanceof ValidationError) {
            throw new SectionWriteError(
              "links on your landing page must point to a page on this store, starting with /",
            );
          }
          throw error;
        }
      }
      return { ...section, settings };
    }),
  );
}

function fieldsOf(section: SectionInstance) {
  const def = getSectionDefinition(section.type);
  return {
    fields: def?.fields ?? [],
    blockFields: new Map(
      (def?.blocks ?? []).map((block) => [block.type, block.fields]),
    ),
  };
}

function eachFieldValue(
  section: SectionInstance,
  visit: (
    field: Field,
    value: unknown,
    write: (next: unknown) => void,
  ) => void,
): SectionInstance {
  const { fields, blockFields } = fieldsOf(section);
  const settings = { ...section.settings };
  for (const field of fields) {
    visit(field, settings[field.key], (next) => {
      settings[field.key] = next;
    });
  }
  const blocks = section.blocks?.map((block): BlockInstance => {
    const blockSettings = { ...block.settings };
    for (const field of blockFields.get(block.type) ?? []) {
      visit(field, blockSettings[field.key], (next) => {
        blockSettings[field.key] = next;
      });
    }
    return { ...block, settings: blockSettings };
  });
  return { ...section, settings, ...(blocks ? { blocks } : {}) };
}

function resetHiddenFields(section: SectionInstance): SectionInstance {
  const hidden = VENDOR_PAGE_HIDDEN_FIELDS[section.type];
  if (!hidden) return section;
  return eachFieldValue(section, (field, _value, write) => {
    if (!hidden.includes(field.key)) return;
    const fallback = "default" in field ? field.default : undefined;
    write(fallback !== undefined ? fallback : []);
  });
}

function assertInternalLinks(section: SectionInstance) {
  eachFieldValue(section, (field, value) => {
    if (field.type !== "url") return;
    if (!isInternalLink(value)) {
      throw new SectionWriteError(
        "links on your landing page must point to a page on this store, starting with /",
      );
    }
  });
}

async function keepOwnReferences(
  sections: SectionInstance[],
  vendorId: string,
): Promise<SectionInstance[]> {
  const products = new Set<string>();
  const codes = new Set<string>();
  const sliders = new Set<string>();
  const reviews = new Set<string>();
  let pickedCategories = false;
  for (const section of sections) {
    eachFieldValue(section, (field, value) => {
      if (field.type === "productList" && Array.isArray(value)) {
        for (const id of value) if (typeof id === "string") products.add(id);
      }
      if (field.type === "reviewList" && Array.isArray(value)) {
        for (const id of value) if (typeof id === "string") reviews.add(id);
      }
      if (field.type === "categoryList" && Array.isArray(value) && value.length > 0) {
        pickedCategories = true;
      }
      if (field.type === "product" && typeof value === "string" && value) {
        products.add(value);
      }
      if (field.type === "coupon" && typeof value === "string" && value.trim()) {
        codes.add(value.trim().toUpperCase());
      }
      if (field.type === "slider" && typeof value === "string" && value) {
        sliders.add(value);
      }
    });
  }

  const vendorObjectId = new mongoose.Types.ObjectId(vendorId);
  const productIds = [...products].filter((id) => mongoose.isValidObjectId(id));
  const [ownedProducts, ownedCodes, ownedSliders, ownedReviews, ownedCategories] = await Promise.all([
    productIds.length > 0
      ? Product.find({ _id: { $in: productIds }, vendorId: vendorObjectId })
          .select("_id")
          .lean<{ _id: unknown }[]>()
          .then((rows) => new Set(rows.map((row) => String(row._id))))
      : new Set<string>(),
    codes.size > 0
      ? Coupon.find({
          code: { $in: [...codes] },
          vendorId: vendorObjectId,
          // An offer code is one shopper's; it is never something to advertise.
          ...MERCHANT_COUPON_FILTER,
        })
          .select("code")
          .lean<{ code: string }[]>()
          .then((rows) => new Set(rows.map((row) => row.code.toUpperCase())))
      : new Set<string>(),
    existingVendorSliderHandles(vendorId, [...sliders]),
    reviews.size > 0
      ? ownedApprovedReviewIds(vendorId, [...reviews])
      : new Set<string>(),
    pickedCategories
      ? getVendorStoreTaxonomy(vendorId).then(
          (taxonomy) =>
            new Set(vendorCategoryPool(taxonomy).map((category) => category.id)),
        )
      : new Set<string>(),
  ]);

  return sections.map((section) =>
    eachFieldValue(section, (field, value, write) => {
      if (field.type === "productList" && Array.isArray(value)) {
        write(
          value.filter((id) => typeof id === "string" && ownedProducts.has(id)),
        );
      }
      if (field.type === "product" && typeof value === "string" && value) {
        write(ownedProducts.has(value) ? value : "");
      }
      if (field.type === "coupon" && typeof value === "string" && value.trim()) {
        write(ownedCodes.has(value.trim().toUpperCase()) ? value : "");
      }
      if (field.type === "slider" && typeof value === "string" && value) {
        write(ownedSliders.has(value) ? value : "");
      }
      if (field.type === "reviewList" && Array.isArray(value)) {
        write(
          value.filter((id) => typeof id === "string" && ownedReviews.has(id)),
        );
      }
      if (field.type === "categoryList" && Array.isArray(value)) {
        write(
          value.filter((id) => typeof id === "string" && ownedCategories.has(id)),
        );
      }
    }),
  );
}
