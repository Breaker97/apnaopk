import { mongoose } from "@/lib/db";
import type { Document } from "mongoose";
import {
  parseStorePageKey,
  type ParsedStorePageKey,
  type StoreGroupType,
  type StorePageKind,
  type StoreTemplateType,
} from "@/lib/storefront/pages/handles";

const { Schema, models, model } = mongoose;

/**
 * A storefront page built from theme-engine sections.
 *
 * Identity is the canonical `key` (unique):
 *   template:<type>:<variant>  — template pages (home today, P6 adds the rest)
 *   landing:<handle>           — URL-addressed landing pages (/pages/<handle>)
 *   group:<header|footer>      — shared section groups (P8)
 * `kind`/`templateType`/`handle` are denormalized FROM the key by
 * `buildStorePageIdentity` — writers construct identity only through it, so
 * the fields can never disagree. Only landing pages carry a URL handle.
 *
 * `sections` trees are stored as Mixed and validated with zod at every
 * boundary (`sanitizeSectionInstances`) — the Menu.items precedent — because
 * section settings are shaped by the code-side registry, not by this schema.
 *
 * Draft and published live on the SAME document so publishing is one atomic
 * update: push published → history, copy draft → published, trim history.
 * Content here is deliberately theme-agnostic: no field references a theme.
 */

export {
  HOME_TEMPLATE_KEY,
} from "@/lib/storefront/pages/handles";
/** Rollback depth for published snapshots. */
export const STORE_PAGE_HISTORY_LIMIT = 10;

interface IStorePageDraft {
  sections: unknown[];
  updatedAt?: Date;
  updatedBy?: string;
}

interface IStorePagePublished {
  sections: unknown[];
  publishedAt?: Date;
  publishedBy?: string;
}

interface IStorePage extends Document {
  kind: StorePageKind;
  /** Canonical unique identity — see the module doc. */
  key: string;
  templateType?: StoreTemplateType;
  group?: StoreGroupType;
  /** URL slug under /pages/ — landing pages only. */
  handle?: string;
  /** LocalizedText — admin-facing page name. */
  title?: unknown;
  seo?: {
    title?: unknown;
    description?: unknown;
    image?: string;
  };
  draft?: IStorePageDraft;
  /** null until first publish; the storefront renders only this. */
  published?: IStorePagePublished | null;
  history: IStorePagePublished[];
  createdAt: Date;
  updatedAt: Date;
}

interface StorePageIdentity {
  kind: StorePageKind;
  key: string;
  templateType?: StoreTemplateType;
  group?: StoreGroupType;
  handle?: string;
}

/**
 * The ONLY way identity fields are built. Takes a canonical key, returns the
 * full denormalized field set; throws on a malformed key so a typo can never
 * mint an unreachable document.
 */
export function buildStorePageIdentity(key: string): StorePageIdentity {
  const parsed = parseStorePageKey(key);
  if (!parsed) {
    throw new Error(`Invalid store-page key: ${key}`);
  }
  return identityFromParsed(parsed, key);
}

function identityFromParsed(
  parsed: ParsedStorePageKey,
  key: string,
): StorePageIdentity {
  switch (parsed.kind) {
    case "template":
      return { kind: "template", key, templateType: parsed.templateType };
    case "landing":
      return { kind: "landing", key, handle: parsed.handle };
    case "group":
      return { kind: "group", key, group: parsed.group };
  }
}

const DraftSchema = new Schema<IStorePageDraft>(
  {
    sections: { type: Schema.Types.Mixed, default: [] },
    updatedAt: Date,
    updatedBy: String,
  },
  { _id: false },
);

const PublishedSchema = new Schema<IStorePagePublished>(
  {
    sections: { type: Schema.Types.Mixed, default: [] },
    publishedAt: Date,
    publishedBy: String,
  },
  { _id: false },
);

const StorePageSchema = new Schema<IStorePage>(
  {
    kind: {
      type: String,
      enum: ["template", "landing", "group"],
      required: true,
      index: true,
    },
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 160,
    },
    templateType: String,
    group: String,
    handle: {
      type: String,
      lowercase: true,
      trim: true,
      maxlength: 100,
    },
    title: Schema.Types.Mixed,
    seo: {
      type: new Schema(
        {
          title: Schema.Types.Mixed,
          description: Schema.Types.Mixed,
          image: String,
        },
        { _id: false },
      ),
    },
    draft: { type: DraftSchema },
    published: { type: PublishedSchema, default: null },
    history: { type: [PublishedSchema], default: [] },
  },
  { timestamps: true },
);

// Belt-and-braces on document creates (updateOne paths bypass validators;
// they all construct identity through buildStorePageIdentity instead).
StorePageSchema.pre("validate", async function () {
  const expected = buildStorePageIdentity(this.key);
  if (
    expected.kind !== this.kind ||
    expected.templateType !== (this.templateType || undefined) ||
    expected.group !== (this.group || undefined) ||
    expected.handle !== (this.handle || undefined)
  ) {
    throw new Error(
      `StorePage identity fields disagree with key "${this.key}" — build them with buildStorePageIdentity()`,
    );
  }
});

if (models.StorePage) {
  delete models.StorePage;
}

export const StorePage = model<IStorePage>("StorePage", StorePageSchema);
