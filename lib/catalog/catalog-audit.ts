import { audit, type AuditContext } from "@/lib/audit";
import type { AuditResource } from "@/config/audit.config";

/**
 * Activity Log rows for catalog records: categories, brands, global variants,
 * collections, locations and products.
 *
 * Their routes all audit the same few moves — created, edited, deleted,
 * exported, imported — so the sentence, the no-op skip and the "never the whole
 * document" rule live here once instead of being rewritten in a dozen routes.
 *
 * What goes into `before` and `after` is a **snapshot**: the handful of fields a
 * person would want to see change, picked on purpose. A category or a product
 * carries images, SEO blocks, variant matrices and stock figures that would turn
 * every row into a copy of the record, and `auditUpdate` stores whatever it is
 * given. An update keeps only the fields that changed.
 *
 * Every function awaits `audit()`, which never throws, so none of them can fail
 * the request that called it.
 */

type Snapshot = Record<string, unknown>;

export interface CatalogAuditEntity {
  resource: AuditResource;
  /** Lower-case, as it reads inside a sentence: "category", "global variant". */
  noun: string;
  /** The record's name as the list should show it. */
  nameOf: (doc: unknown) => string | undefined;
  /** The fields worth keeping in before/after. */
  snapshot: (doc: unknown) => Snapshot;
  /** Short facts that make a creation readable at a glance. */
  facts?: (snapshot: Snapshot) => string[];
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

/**
 * A Mongoose document or a lean object, as a plain object. Without virtuals: a
 * snapshot reads stored fields only, and some of these schemas compute theirs.
 */
function plain(doc: unknown): Record<string, unknown> {
  if (!doc || typeof doc !== "object") return {};
  const withToObject = doc as {
    toObject?: (options?: { virtuals?: boolean }) => Record<string, unknown>;
  };
  return typeof withToObject.toObject === "function"
    ? withToObject.toObject({ virtuals: false })
    : (doc as Record<string, unknown>);
}

/**
 * Absent and empty are the same to a person reading a change, and a lean
 * "before" has no key where the saved "after" has an empty string. Without this
 * the second shows up as an edit.
 */
const blank = (value: unknown) =>
  value === undefined || value === null || value === "" ? null : value;

/** An ObjectId, or a populated document, as its id string. */
function idOf(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const populated = value as { _id?: unknown };
  return String(populated._id ?? value);
}

function seoSnapshot(value: unknown): Snapshot | null {
  const seo = (value ?? {}) as {
    pageTitle?: unknown;
    metaDescription?: unknown;
    tags?: unknown;
  };
  const tags = Array.isArray(seo.tags) ? seo.tags.map(String) : [];
  const snapshot = {
    pageTitle: blank(seo.pageTitle),
    metaDescription: blank(seo.metaDescription),
    ...(tags.length > 0 ? { tags } : {}),
  };
  return snapshot.pageTitle || snapshot.metaDescription || tags.length > 0
    ? snapshot
    : null;
}

/** Option names with their values: what a category hands to a new product. */
function optionsSnapshot(value: unknown): Array<{ name: unknown; values: string[] }> | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.map((option) => {
    const entry = (option ?? {}) as { name?: unknown; values?: unknown };
    return {
      name: entry.name ?? null,
      values: Array.isArray(entry.values)
        ? entry.values.map((v) => String((v as { value?: unknown })?.value ?? ""))
        : [],
    };
  });
}

export function categorySnapshot(doc: unknown): Snapshot {
  const c = plain(doc);
  return {
    name: blank(c.name),
    slug: blank(c.slug),
    description: blank(c.description),
    image: blank(c.image),
    icon: blank(c.icon),
    parentId: idOf(c.parentId),
    order: c.order ?? 0,
    isActive: c.isActive ?? true,
    featured: c.featured ?? false,
    seo: seoSnapshot(c.seo),
    options: optionsSnapshot(c.options),
  };
}

export function brandSnapshot(doc: unknown): Snapshot {
  const b = plain(doc);
  return {
    name: blank(b.name),
    slug: blank(b.slug),
    description: blank(b.description),
    logo: blank(b.logo),
    website: blank(b.website),
    order: b.order ?? 0,
    isActive: b.isActive ?? true,
    featured: b.featured ?? false,
    // A brand from before moderation existed has no status, and reads as approved.
    approvalStatus: b.approvalStatus ?? "approved",
    rejectionReason: blank(b.rejectionReason),
    ownerVendorId: idOf(b.ownerVendorId),
    archived: Boolean(b.deletedAt),
    seo: seoSnapshot(b.seo),
  };
}

export function globalVariantSnapshot(doc: unknown): Snapshot {
  const v = plain(doc);
  const values = Array.isArray(v.values) ? v.values : [];
  return {
    name: blank(v.name),
    type: blank(v.type),
    visual: blank(v.visual),
    position: v.position ?? 0,
    isActive: v.isActive ?? true,
    values: values.map((entry) => {
      const { value, colorCode } = (entry ?? {}) as { value?: unknown; colorCode?: unknown };
      return { value: value ?? null, ...(colorCode ? { colorCode } : {}) };
    }),
  };
}

/**
 * A collection as created. Its member products are a count: a manual collection
 * can hold hundreds, and the list of them is not what anyone audits.
 */
export function collectionSnapshot(doc: unknown): Snapshot {
  const c = plain(doc);
  const publishing = (c.publishing ?? {}) as { onlineStore?: unknown; pointOfSale?: unknown };
  const productCount =
    typeof c.productCount === "number"
      ? c.productCount
      : Array.isArray(c.products)
        ? c.products.length
        : 0;
  return {
    title: blank(c.title),
    slug: blank(c.slug),
    kind: c.kind ?? "collection",
    collectionType: blank(c.collectionType),
    status: blank(c.status),
    conditionMatch: blank(c.conditionMatch),
    sortOrder: blank(c.sortOrder),
    position: c.position ?? 0,
    onlineStore: publishing.onlineStore ?? true,
    pointOfSale: publishing.pointOfSale ?? false,
    productCount,
  };
}

export function locationSnapshot(doc: unknown): Snapshot {
  const l = plain(doc);
  return {
    name: blank(l.name),
    address: blank(l.address),
    isDefault: l.isDefault ?? false,
    isActive: l.isActive ?? true,
    fulfillsOnlineOrders: l.fulfillsOnlineOrders ?? true,
    sellsAtCounter: l.sellsAtCounter ?? true,
    acceptsReturns: l.acceptsReturns ?? false,
    fulfillmentPriority: l.fulfillmentPriority ?? 0,
    pickupEnabled: l.pickupEnabled ?? false,
    pickupArea: blank(l.pickupArea),
    instructions: blank(l.instructions),
    mapsUrl: blank(l.mapsUrl),
    weeklyHours:
      Array.isArray(l.weeklyHours) && l.weeklyHours.length > 0 ? l.weeklyHours : null,
  };
}

/** What identifies a product and what it sells for — never the whole document. */
export function productSnapshot(doc: unknown): Snapshot {
  const p = plain(doc);
  return {
    name: blank(p.name ?? p.title),
    sku: blank(p.sku),
    price: p.price ?? null,
    status: blank(p.status),
    vendorId: idOf(p.vendorId),
  };
}

const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);

export const CATEGORY_AUDIT: CatalogAuditEntity = {
  resource: "category",
  noun: "category",
  nameOf: (doc) => text(plain(doc).name),
  snapshot: categorySnapshot,
};

export const BRAND_AUDIT: CatalogAuditEntity = {
  resource: "brand",
  noun: "brand",
  nameOf: (doc) => text(plain(doc).name),
  snapshot: brandSnapshot,
  // A seller's brand is created for review, and that is the fact worth saying.
  facts: (s) => (s.approvalStatus && s.approvalStatus !== "approved" ? [`${s.approvalStatus} review`] : []),
};

export const GLOBAL_VARIANT_AUDIT: CatalogAuditEntity = {
  resource: "globalVariant",
  noun: "global variant",
  nameOf: (doc) => text(plain(doc).name),
  snapshot: globalVariantSnapshot,
  facts: (s) => {
    const count = Array.isArray(s.values) ? s.values.length : 0;
    return [`${count} value${count === 1 ? "" : "s"}`];
  },
};

export const COLLECTION_AUDIT: CatalogAuditEntity = {
  resource: "collection",
  noun: "collection",
  nameOf: (doc) => text(plain(doc).title),
  snapshot: collectionSnapshot,
  facts: (s) =>
    [s.kind === "look" ? "look" : undefined, text(s.collectionType), text(s.status)].filter(
      (fact): fact is string => Boolean(fact),
    ),
};

export const LOCATION_AUDIT: CatalogAuditEntity = {
  resource: "location",
  noun: "location",
  nameOf: (doc) => text(plain(doc).name),
  snapshot: locationSnapshot,
  facts: (s) => (s.isDefault ? ["default"] : []),
};

export const PRODUCT_AUDIT: CatalogAuditEntity = {
  resource: "product",
  noun: "product",
  nameOf: (doc) => {
    const p = plain(doc);
    return text(p.name) ?? text(p.title);
  },
  snapshot: productSnapshot,
  facts: (s) =>
    [
      text(s.sku) ? `SKU ${s.sku}` : undefined,
      typeof s.price === "number" ? `price ${s.price}` : undefined,
      text(s.status),
    ].filter((fact): fact is string => Boolean(fact)),
};

// ---------------------------------------------------------------------------
// Sentences
// ---------------------------------------------------------------------------

const SHORT_TEXT = 40;
const MAX_FIELDS_IN_SUMMARY = 6;
const MAX_FILTER_LENGTH = 60;

/** A value as it reads in "from → to", or undefined when it is too long to quote. */
function shown(value: unknown): string | undefined {
  if (value === null || value === undefined) return "none";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") return value.length <= SHORT_TEXT ? `"${value}"` : undefined;
  return undefined;
}

function describeChange(field: string, before: unknown, after: unknown) {
  const from = shown(before);
  const to = shown(after);
  return from !== undefined && to !== undefined ? `${field} ${from} → ${to}` : `${field} changed`;
}

function changedFields(before: Snapshot, after: Snapshot): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

function pick(snapshot: Snapshot, fields: string[]): Snapshot {
  return Object.fromEntries(fields.map((field) => [field, snapshot[field]]));
}

function named(entity: CatalogAuditEntity, name: string | undefined) {
  return `${entity.noun}${name ? ` "${name}"` : ""}`;
}

function idString(doc: unknown) {
  const id = plain(doc)._id;
  return id === undefined || id === null ? undefined : String(id);
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export function auditCatalogCreate(
  context: AuditContext,
  entity: CatalogAuditEntity,
  doc: unknown,
) {
  const after = entity.snapshot(doc);
  const name = entity.nameOf(doc);
  const facts = entity.facts?.(after) ?? [];
  return audit(context, {
    action: "CREATE",
    resource: entity.resource,
    resourceId: idString(doc),
    resourceName: name,
    changes: {
      after,
      summary: `Created ${named(entity, name)}${facts.length > 0 ? ` (${facts.join(", ")})` : ""}`,
    },
  });
}

/**
 * An edit, with the fields that changed and what they changed from and to.
 * Writes nothing when no audited field moved, so a save that changed only what
 * the snapshot leaves out (a cache stamp, a count) leaves no row.
 */
export async function auditCatalogUpdate(
  context: AuditContext,
  entity: CatalogAuditEntity,
  beforeDoc: unknown,
  afterDoc: unknown,
  options: { summary?: string } = {},
) {
  const before = entity.snapshot(beforeDoc);
  const after = entity.snapshot(afterDoc);
  const fields = changedFields(before, after);
  if (fields.length === 0) return null;

  const name = entity.nameOf(afterDoc) ?? entity.nameOf(beforeDoc);
  const shownFields = fields.slice(0, MAX_FIELDS_IN_SUMMARY);
  const more = fields.length - shownFields.length;
  const changes = [
    ...shownFields.map((field) => describeChange(field, before[field], after[field])),
    ...(more > 0 ? [`${more} more`] : []),
  ].join(", ");

  return audit(context, {
    action: "UPDATE",
    resource: entity.resource,
    resourceId: idString(afterDoc) ?? idString(beforeDoc),
    resourceName: name,
    changes: {
      before: pick(before, fields),
      after: pick(after, fields),
      fields,
      summary: options.summary ?? `Updated ${named(entity, name)} — ${changes}`,
    },
  });
}

/**
 * A record removed. `summary` is for a deletion that is not one: a brand that is
 * archived and can be restored should not read as gone.
 */
export function auditCatalogDelete(
  context: AuditContext,
  entity: CatalogAuditEntity,
  doc: unknown,
  options: { summary?: string; metadata?: Record<string, unknown> } = {},
) {
  const name = entity.nameOf(doc);
  return audit(context, {
    action: "DELETE",
    resource: entity.resource,
    resourceId: idString(doc),
    resourceName: name,
    changes: {
      before: entity.snapshot(doc),
      summary: options.summary ?? `Deleted ${named(entity, name)}`,
    },
    metadata: options.metadata,
  });
}

// ---------------------------------------------------------------------------
// Exports and imports
// ---------------------------------------------------------------------------

type CsvResource = "product" | "category" | "collection" | "brand";

const CSV_NOUNS: Record<CsvResource, { one: string; many: string }> = {
  product: { one: "product", many: "products" },
  category: { one: "category", many: "categories" },
  collection: { one: "collection", many: "collections" },
  brand: { one: "brand", many: "brands" },
};

/**
 * A catalog file leaving the system. `EXPORT` is the only record that a copy of
 * the catalog was taken, and by whom — the rows themselves are not worth
 * keeping, so the row says how many there were and what narrowed them.
 */
export function auditCatalogExport(
  context: AuditContext,
  resource: CsvResource,
  details: { rowCount: number; filters?: Record<string, string | undefined> },
) {
  // A search box is free text from a query string: capped, so one row cannot
  // carry a page of it.
  const filters = Object.fromEntries(
    Object.entries(details.filters ?? {})
      .filter((entry): entry is [string, string] => Boolean(entry[1]) && entry[1] !== "all")
      .map(([key, value]) => [key, value.slice(0, MAX_FILTER_LENGTH)]),
  );
  const nouns = CSV_NOUNS[resource];
  const narrowedBy = Object.entries(filters).map(([key, value]) => `${key} "${value}"`);
  return audit(context, {
    action: "EXPORT",
    resource,
    changes: {
      summary: `Exported ${details.rowCount} ${details.rowCount === 1 ? nouns.one : nouns.many} to CSV${
        narrowedBy.length > 0 ? ` (${narrowedBy.join(", ")})` : ""
      }`,
    },
    metadata: { format: "csv", rowCount: details.rowCount, filters },
  });
}

/**
 * A file of categories, collections or brands imported. One row per file, and
 * none for a file whose every row was refused, as for the product import.
 */
export async function auditCatalogImport(
  context: AuditContext,
  resource: Exclude<CsvResource, "product">,
  fileName: string,
  result: { created: number; updated: number; failed: number },
) {
  if (result.created === 0 && result.updated === 0) return null;
  return audit(context, {
    action: "BULK_ACTION",
    resource,
    changes: {
      summary: `Imported ${CSV_NOUNS[resource].many} from "${fileName}": ${result.created} created, ${result.updated} updated, ${result.failed} failed`,
    },
    metadata: {
      fileName,
      created: result.created,
      updated: result.updated,
      failed: result.failed,
    },
  });
}
