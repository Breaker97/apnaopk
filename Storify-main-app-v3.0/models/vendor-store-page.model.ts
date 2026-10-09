import { mongoose } from "@/lib/db";
import type { Document, Types } from "mongoose";

const { Schema, models, model } = mongoose;

/**
 * One vendor's landing page (the Home tab of /vendors/<slug>), built in the
 * Vendor CMS. Its own collection, apart from the admin's `StorePage`
 * documents: the marketplace's pages and a vendor's page share the section
 * engine and nothing else.
 *
 * Draft and published live on the same document, as on `StorePage`, so a
 * publish is one atomic update. `settings` are not drafted: the accent
 * colour, the tabs, the banner size, the announcement and the search
 * preview apply as soon as they are saved.
 *
 * `takedown` records the last time an admin unpublished the page, so the
 * vendor's editor can say why the Home tab went away.
 */
export const VENDOR_STORE_PAGE_HISTORY_LIMIT = 10;

interface IVendorStorePageDraft {
  sections: unknown[];
  updatedAt?: Date;
  updatedBy?: string;
}

interface IVendorStorePagePublished {
  sections: unknown[];
  publishedAt?: Date;
  publishedBy?: string;
}

interface IVendorStorePageSettings {
  accentColor?: string;
  showSimilarProducts?: boolean;
  defaultTab?: string;
  hideAboutTab?: boolean;
  hideShippingTab?: boolean;
  bannerSize?: string;
  defaultSort?: string;
  announcement?: {
    text?: string;
    link?: string;
    color?: string;
    startsAt?: string;
    endsAt?: string;
  };
  seo?: { title?: string; description?: string; image?: string };
}

interface IVendorStorePageTakedown {
  at?: Date;
  by?: string;
  reason?: string;
}

export interface IVendorStorePage extends Document {
  vendorId: Types.ObjectId;
  draft?: IVendorStorePageDraft;
  published?: IVendorStorePagePublished | null;
  history: IVendorStorePagePublished[];
  settings?: IVendorStorePageSettings;
  takedown?: IVendorStorePageTakedown | null;
  createdAt: Date;
  updatedAt: Date;
}

const DraftSchema = new Schema<IVendorStorePageDraft>(
  {
    sections: { type: Schema.Types.Mixed, default: [] },
    updatedAt: Date,
    updatedBy: String,
  },
  { _id: false },
);

const PublishedSchema = new Schema<IVendorStorePagePublished>(
  {
    sections: { type: Schema.Types.Mixed, default: [] },
    publishedAt: Date,
    publishedBy: String,
  },
  { _id: false },
);

// Every value is normalized before it is written and again when it is read
// (normalizeVendorPageSettings), so the schema only bounds the sizes.
const AnnouncementSchema = new Schema(
  {
    text: { type: String, default: "", maxlength: 200 },
    link: { type: String, default: "", maxlength: 500 },
    color: { type: String, default: "", maxlength: 7 },
    startsAt: { type: String, default: "", maxlength: 40 },
    endsAt: { type: String, default: "", maxlength: 40 },
  },
  { _id: false },
);

const SeoSchema = new Schema(
  {
    title: { type: String, default: "", maxlength: 100 },
    description: { type: String, default: "", maxlength: 200 },
    image: { type: String, default: "", maxlength: 1000 },
  },
  { _id: false },
);

const SettingsSchema = new Schema<IVendorStorePageSettings>(
  {
    accentColor: { type: String, default: "", maxlength: 7 },
    showSimilarProducts: { type: Boolean, default: true },
    defaultTab: { type: String, default: "home", maxlength: 20 },
    hideAboutTab: { type: Boolean, default: false },
    hideShippingTab: { type: Boolean, default: false },
    bannerSize: { type: String, default: "standard", maxlength: 20 },
    defaultSort: { type: String, default: "popular", maxlength: 20 },
    announcement: { type: AnnouncementSchema, default: () => ({}) },
    seo: { type: SeoSchema, default: () => ({}) },
  },
  { _id: false },
);

const TakedownSchema = new Schema<IVendorStorePageTakedown>(
  {
    at: Date,
    by: String,
    reason: { type: String, maxlength: 500 },
  },
  { _id: false },
);

const VendorStorePageSchema = new Schema<IVendorStorePage>(
  {
    vendorId: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
      unique: true,
    },
    draft: { type: DraftSchema },
    published: { type: PublishedSchema, default: null },
    history: { type: [PublishedSchema], default: [] },
    settings: { type: SettingsSchema, default: () => ({}) },
    takedown: { type: TakedownSchema, default: null },
  },
  { timestamps: true },
);

if (models.VendorStorePage) {
  delete models.VendorStorePage;
}

export const VendorStorePage = model<IVendorStorePage>(
  "VendorStorePage",
  VendorStorePageSchema,
);
