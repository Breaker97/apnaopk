import { mongoose } from "@/lib/db";
import { Brand } from "@/models";
import { ValidationError } from "@/lib/api/errors";
import { revalidateBrandContent } from "@/lib/cache-invalidation";
import {
  csvFileResponse,
  csvLine,
  datedCsvFilename,
  parseCsv,
} from "@/lib/catalog/csv";
import {
  APPROVED_BRAND_CONDITION,
  BRAND_APPROVAL_STATUS,
  isApprovedBrand,
  slugifyBrand,
  vendorBrandEditNeedsReview,
} from "@/lib/catalog/brands";
import { MAX_IMPORT_ROWS } from "@/lib/products/import-limits";
import { escapeRegExp, legacySlugify } from "@/lib/strings";
import type { VendorBrandRow } from "@/lib/vendors/vendor-brand-list";

/**
 * Brand CSV export and import, shared by the admin and vendor routes.
 *
 * The two roles get different files and different import rules, because a brand
 * has two kinds of owner:
 *
 * - An **admin** exports every brand in the tab they are looking at, and an
 *   import creates platform-owned, approved brands or updates any existing one,
 *   moderation included.
 * - A **vendor** exports what their own Brands table shows (the approved catalog
 *   plus the brands they created), and an import can only create brands that
 *   enter the review queue, or update brands they own. Everything else is
 *   refused row by row, with the same rules `POST /api/vendor/brands` and
 *   `PUT /api/vendor/brands/[id]` apply.
 *
 * A row that matches an existing brand (by id, then by URL handle) updates it
 * instead of creating a second one, so importing the same file twice changes
 * nothing the second time.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BrandImportScope =
  | { role: "admin" }
  | { role: "vendor"; vendorId: string; canCreate: boolean; canEdit: boolean };

export interface BrandImportResult {
  created: number;
  updated: number;
  /** Rows that matched a brand and changed nothing. */
  unchanged: number;
  failed: number;
  errors: { row: number; message: string }[];
}

/** A brand as read from the database (`.lean()`), reduced to what the CSV uses. */
export interface StoredBrand {
  _id: unknown;
  name?: string;
  slug?: string;
  description?: string;
  logo?: string;
  website?: string;
  order?: number;
  isActive?: boolean;
  featured?: boolean;
  ownerVendorId?: unknown;
  approvalStatus?: string;
  rejectionReason?: string;
  deletedAt?: Date | null;
  seo?: { pageTitle?: string; metaDescription?: string };
  productCount?: number;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const ADMIN_BRAND_CSV_HEADERS = [
  "id",
  "name",
  "slug",
  "description",
  "logo",
  "website",
  "order",
  "isActive",
  "featured",
  "approvalStatus",
  "rejectionReason",
  "source",
  "archived",
  "productCount",
  "seoPageTitle",
  "seoMetaDescription",
] as const;

export const VENDOR_BRAND_CSV_HEADERS = [
  "id",
  "name",
  "slug",
  "description",
  "logo",
  "website",
  "order",
  "isActive",
  "featured",
  "approvalStatus",
  "rejectionReason",
  "source",
  "yourProducts",
  "seoPageTitle",
  "seoMetaDescription",
] as const;

const BRAND_CSV_PREFIX = "brands";

function csvFile(headers: readonly string[], records: Record<string, string>[]) {
  return csvFileResponse(datedCsvFilename(BRAND_CSV_PREFIX), [
    headers.join(","),
    ...records.map((record) => csvLine(headers.map((header) => record[header]))),
  ]);
}

/**
 * The admin file: every column the admin edits, plus where the brand came from
 * (`source`), whether it is archived and its product count. `source`,
 * `archived` and `productCount` describe the brand and are ignored on import.
 */
export function adminBrandsCsvResponse(brands: readonly StoredBrand[]) {
  return csvFile(
    ADMIN_BRAND_CSV_HEADERS,
    brands.map((brand) => ({
      id: String(brand._id),
      name: brand.name ?? "",
      slug: brand.slug ?? "",
      description: brand.description ?? "",
      logo: brand.logo ?? "",
      website: brand.website ?? "",
      order: String(brand.order ?? 0),
      isActive: String(brand.isActive ?? true),
      featured: String(brand.featured ?? false),
      // A brand from before moderation existed has no status and reads as approved.
      approvalStatus: brand.approvalStatus ?? BRAND_APPROVAL_STATUS.APPROVED,
      rejectionReason: brand.rejectionReason ?? "",
      source: brand.ownerVendorId ? "vendor" : "official",
      archived: String(Boolean(brand.deletedAt)),
      productCount: String(brand.productCount ?? 0),
      seoPageTitle: brand.seo?.pageTitle ?? "",
      seoMetaDescription: brand.seo?.metaDescription ?? "",
    })),
  );
}

/**
 * The vendor file: the rows of the vendor's own table, with no owner ids and no
 * other vendor's data. `source` is `own` for a brand the vendor created and
 * `catalog` for the shared catalog; the vendor can only re-import their own.
 */
export function vendorBrandsCsvResponse(rows: readonly VendorBrandRow[]) {
  return csvFile(
    VENDOR_BRAND_CSV_HEADERS,
    rows.map((row) => ({
      id: row._id,
      name: row.name,
      slug: row.slug,
      description: row.description ?? "",
      logo: row.logo ?? "",
      website: row.website ?? "",
      order: String(row.order ?? 0),
      isActive: String(row.isActive),
      featured: String(row.featured),
      approvalStatus: row.approvalStatus,
      // The reason is addressed to the brand's creator.
      rejectionReason: row.isOwn ? (row.rejectionReason ?? "") : "",
      source: row.isOwn ? "own" : "catalog",
      yourProducts: String(row.productCount),
      seoPageTitle: row.seo?.pageTitle ?? "",
      seoMetaDescription: row.seo?.metaDescription ?? "",
    })),
  );
}

// ---------------------------------------------------------------------------
// Import: reading cells
// ---------------------------------------------------------------------------

// The limits the Brand model enforces; checked here so a row fails with a
// message that names the column instead of a Mongoose validation dump.
const NAME_MAX = 100;
const DESCRIPTION_MAX = 500;
const URL_MAX = 2048;
const SEO_TITLE_MAX = 70;
const SEO_DESCRIPTION_MAX = 320;
const REASON_MAX = 1000;

const TRUE_TOKENS = new Set(["true", "1", "yes", "y", "on"]);
const FALSE_TOKENS = new Set(["false", "0", "no", "n", "off"]);

type Row = Record<string, string>;

/**
 * Header names compared without case, spaces or punctuation, so `Is Active`,
 * `is_active` and `isActive` are one column. The first non-empty cell wins when
 * two headers collapse to the same name.
 */
function normalizeRow(values: Row): Row {
  const row: Row = {};
  for (const [header, value] of Object.entries(values)) {
    const key = header.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!row[key]) row[key] = value;
  }
  return row;
}

function readText(value: string | undefined, label: string, max: number) {
  const text = (value ?? "").trim();
  if (!text) return undefined;
  if (text.length > max) throw new Error(`${label} cannot exceed ${max} characters.`);
  return text;
}

/**
 * A link a storefront page will put in an `href` or `src`. Only http(s) is
 * accepted (and, for images, a path on this site): a CSV is a bulk way to put
 * `javascript:` into a page that every shopper opens.
 */
function readUrl(value: string | undefined, label: string, allowPath: boolean) {
  const text = readText(value, label, URL_MAX);
  if (!text) return undefined;
  if (allowPath && text.startsWith("/") && !text.startsWith("//")) return text;
  try {
    const { protocol } = new URL(text);
    if (protocol === "http:" || protocol === "https:") return text;
  } catch {
    // Falls through to the message below.
  }
  throw new Error(
    `${label} must be a full http(s) URL${allowPath ? " or a path starting with /" : ""}.`,
  );
}

function readFlag(value: string | undefined, label: string) {
  const text = (value ?? "").trim().toLowerCase();
  if (!text) return undefined;
  if (TRUE_TOKENS.has(text)) return true;
  if (FALSE_TOKENS.has(text)) return false;
  throw new Error(`${label} must be true or false.`);
}

function readOrder(value: string | undefined) {
  const text = (value ?? "").trim();
  if (!text) return undefined;
  const order = Number(text);
  if (!Number.isFinite(order)) throw new Error("Order must be a number.");
  return order;
}

function readApprovalStatus(value: string | undefined) {
  const text = (value ?? "").trim().toLowerCase();
  if (!text) return undefined;
  const statuses = Object.values(BRAND_APPROVAL_STATUS) as string[];
  if (!statuses.includes(text)) {
    throw new Error(`Approval status must be one of: ${statuses.join(", ")}.`);
  }
  return text;
}

/** The columns an admin and a vendor are both allowed to set. */
interface CommonFields {
  name?: string;
  description?: string;
  logo?: string;
  website?: string;
  order?: number;
  seoPageTitle?: string;
  seoMetaDescription?: string;
}

function readCommonFields(row: Row): CommonFields {
  return {
    name: readText(row.name || row.brandname, "Name", NAME_MAX),
    description: readText(row.description, "Description", DESCRIPTION_MAX),
    logo: readUrl(row.logo || row.logourl, "Logo", true),
    website: readUrl(row.website || row.websiteurl, "Website", false),
    order: readOrder(row.order || row.displayorder),
    seoPageTitle: readText(row.seopagetitle, "SEO page title", SEO_TITLE_MAX),
    seoMetaDescription: readText(
      row.seometadescription,
      "SEO meta description",
      SEO_DESCRIPTION_MAX,
    ),
  };
}

/**
 * The columns only an admin may set: visibility, featuring and moderation. A
 * vendor's file may carry them (an export does), but they are not read at all.
 */
interface AdminFields {
  isActive?: boolean;
  featured?: boolean;
  approvalStatus?: string;
  rejectionReason?: string;
}

function readAdminFields(row: Row): AdminFields {
  return {
    isActive: readFlag(row.isactive || row.active, "Is active"),
    featured: readFlag(row.featured, "Featured"),
    approvalStatus: readApprovalStatus(row.approvalstatus),
    rejectionReason: readText(row.rejectionreason, "Rejection reason", REASON_MAX),
  };
}

/** Everything a row says, read and validated before it is matched to a brand. */
interface ParsedRow {
  id: string;
  /** The slug column, made URL-safe; empty when the file gives none. */
  slug: string;
  fields: CommonFields;
  admin: AdminFields;
}

function parseRow(values: Row, scope: BrandImportScope): ParsedRow {
  const row = normalizeRow(values);
  const fields = readCommonFields(row);
  // Read for an admin on both paths, so a typo in a column fails the row
  // whether it would have created a brand or updated one.
  const admin = scope.role === "admin" ? readAdminFields(row) : {};

  const rawSlug = row.slug || row.handle || "";
  const slug = slugifyBrand(rawSlug);
  if (rawSlug && !slug) throw new Error("Slug must contain letters or numbers.");

  if (row.id && !mongoose.Types.ObjectId.isValid(row.id)) {
    throw new Error(`"${row.id}" is not a valid brand id.`);
  }

  return { id: row.id ?? "", slug, fields, admin };
}

/** A blank cell on an update means "leave it", so only filled cells are written. */
function patchFromFields(fields: CommonFields): Record<string, unknown> {
  const { seoPageTitle, seoMetaDescription, ...rest } = fields;
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) patch[key] = value;
  }
  if (seoPageTitle !== undefined) patch["seo.pageTitle"] = seoPageTitle;
  if (seoMetaDescription !== undefined) patch["seo.metaDescription"] = seoMetaDescription;
  return patch;
}

function documentFromFields(fields: CommonFields): Record<string, unknown> {
  const { seoPageTitle, seoMetaDescription, order, ...rest } = fields;
  const document: Record<string, unknown> = { order: order ?? 0 };
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) document[key] = value;
  }
  if (seoPageTitle !== undefined || seoMetaDescription !== undefined) {
    document.seo = {
      ...(seoPageTitle !== undefined ? { pageTitle: seoPageTitle } : {}),
      ...(seoMetaDescription !== undefined ? { metaDescription: seoMetaDescription } : {}),
    };
  }
  return document;
}

function valueAt(brand: StoredBrand, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (value, part) =>
        value && typeof value === "object"
          ? (value as Record<string, unknown>)[part]
          : undefined,
      brand,
    );
}

const isBlank = (value: unknown) =>
  value === undefined || value === null || value === "";

function sameValue(a: unknown, b: unknown) {
  return (isBlank(a) && isBlank(b)) || a === b;
}

// ---------------------------------------------------------------------------
// Import: one row
// ---------------------------------------------------------------------------

type RowOutcome = {
  kind: "created" | "updated" | "unchanged";
  id: string;
  /** Slugs whose storefront pages need refreshing; empty when nothing is live. */
  revalidate: string[];
};

/** A brand that already exists under that name, among the brands this caller can see. */
async function assertNameFree(name: string, scope: BrandImportScope, excludeId?: unknown) {
  const filter: Record<string, unknown> = {
    name: { $regex: `^${escapeRegExp(name)}$`, $options: "i" },
    deletedAt: null,
  };
  if (excludeId) filter._id = { $ne: excludeId };
  // A vendor is only told about brands they can see, so another vendor's brand
  // still in review is not revealed by a name that "already exists".
  if (scope.role === "vendor") {
    filter.$or = [
      { approvalStatus: APPROVED_BRAND_CONDITION },
      { ownerVendorId: new mongoose.Types.ObjectId(scope.vendorId) },
    ];
  }
  if (await Brand.exists(filter)) {
    throw new Error(`A brand named "${name}" already exists.`);
  }
}

/** Refuses a row that points at a brand this caller may not change. */
function assertCanChange(existing: StoredBrand, scope: BrandImportScope) {
  if (scope.role === "vendor") {
    const isOwn =
      existing.ownerVendorId != null &&
      String(existing.ownerVendorId) === scope.vendorId;
    if (!isOwn) {
      // The catalog is public to vendors; anything else (another vendor's brand
      // in review, an archived one) is not, so it gets the message an edit form
      // gives for a taken handle, which says nothing about who owns it.
      const visible = !existing.deletedAt && isApprovedBrand(existing);
      throw new Error(
        visible
          ? `"${existing.name}" is already in the catalog. Vendors can only update brands they created.`
          : "Brand URL handle is already in use.",
      );
    }
    if (!scope.canEdit) throw new Error("You do not have permission to edit brands.");
  }
  if (existing.deletedAt) {
    throw new Error(
      `"${existing.name}" is archived. Restore it before importing changes to it.`,
    );
  }
}

async function createBrand(
  { fields, admin, slug: slugInput }: ParsedRow,
  scope: BrandImportScope,
): Promise<RowOutcome> {
  if (scope.role === "vendor" && !scope.canCreate) {
    throw new Error("You do not have permission to create brands.");
  }
  if (!fields.name) throw new Error("Name is required.");
  const slug = slugInput || slugifyBrand(fields.name);
  if (!slug) throw new Error("A URL handle could not be made from the name.");

  await assertNameFree(fields.name, scope);

  const document = documentFromFields(fields);
  if (scope.role === "vendor") {
    // Same as `POST /api/vendor/brands`: owned by the vendor, in the review
    // queue and hidden until an admin approves it. Moderation columns in the
    // file are not the vendor's to set.
    Object.assign(document, {
      slug,
      ownerVendorId: scope.vendorId,
      approvalStatus: BRAND_APPROVAL_STATUS.PENDING,
      isActive: false,
      featured: false,
    });
  } else {
    // Same as `POST /api/brands`: platform-owned and approved. The file's
    // approval status is for brands that already exist; a brand created here
    // has no vendor to be waiting on, so it is never created pending.
    Object.assign(document, {
      slug,
      ownerVendorId: null,
      approvalStatus: BRAND_APPROVAL_STATUS.APPROVED,
      isActive: admin.isActive ?? true,
      featured: admin.featured ?? false,
    });
  }

  const brand = await Brand.create(document);
  // A new vendor brand is pending, so no storefront page shows it yet.
  return {
    kind: "created",
    id: String(brand._id),
    revalidate: scope.role === "admin" ? [brand.slug] : [],
  };
}

async function updateBrand(
  existing: StoredBrand,
  { fields, admin, slug: slugInput }: ParsedRow,
  scope: BrandImportScope,
): Promise<RowOutcome> {
  const patch = patchFromFields(fields);

  if (fields.name && fields.name.toLowerCase() !== (existing.name ?? "").toLowerCase()) {
    await assertNameFree(fields.name, scope, existing._id);
  }

  if (slugInput && slugInput !== existing.slug) {
    const handleFilter: Record<string, unknown> = {
      slug: slugInput,
      _id: { $ne: existing._id },
    };
    if (await Brand.exists(handleFilter)) {
      throw new Error("Brand URL handle is already in use.");
    }
    patch.slug = slugInput;
  }

  if (scope.role === "vendor") {
    // Same re-moderation as `PUT /api/vendor/brands/[id]`.
    if (vendorBrandEditNeedsReview(existing, fields)) {
      patch.approvalStatus = BRAND_APPROVAL_STATUS.PENDING;
      patch.isActive = false;
    }
  } else {
    const { isActive, featured, approvalStatus: status, rejectionReason: reason } = admin;
    const currentStatus = existing.approvalStatus ?? BRAND_APPROVAL_STATUS.APPROVED;

    if (isActive !== undefined) patch.isActive = isActive;
    if (featured !== undefined) patch.featured = featured;
    if (status && status !== currentStatus) {
      patch.approvalStatus = status;
      // Moderation, as in `PUT /api/brands/[id]`: approving publishes the brand
      // and clears the reason; rejecting hides it. Only a *change* of status
      // does this, so re-importing an exported file never switches an approved
      // but inactive brand back on.
      if (status === BRAND_APPROVAL_STATUS.APPROVED) {
        patch.isActive = true;
        patch.rejectionReason = "";
      } else if (status === BRAND_APPROVAL_STATUS.REJECTED) {
        patch.isActive = false;
      }
    }
    if (
      reason !== undefined &&
      (status ?? currentStatus) === BRAND_APPROVAL_STATUS.REJECTED
    ) {
      patch.rejectionReason = reason;
    }
  }

  const changes = Object.fromEntries(
    Object.entries(patch).filter(([key, value]) => !sameValue(valueAt(existing, key), value)),
  );
  const id = String(existing._id);
  if (Object.keys(changes).length === 0) return { kind: "unchanged", id, revalidate: [] };

  const updated = await Brand.findByIdAndUpdate(
    existing._id,
    { $set: changes },
    { returnDocument: "after", runValidators: true },
  ).lean<StoredBrand | null>();
  if (!updated) throw new Error("The brand no longer exists.");

  // A vendor's edit only reaches the storefront if the brand was live (or was
  // just pulled back to review); an admin's always might.
  const wasLive = Boolean(existing.isActive) && !existing.deletedAt;
  const refresh = scope.role === "admin" || wasLive;
  return {
    kind: "updated",
    id,
    revalidate: refresh ? [existing.slug ?? "", updated.slug ?? ""].filter(Boolean) : [],
  };
}

async function importRow(
  values: Row,
  scope: BrandImportScope,
  importedRows: Map<string, number>,
): Promise<RowOutcome> {
  const parsed = parseRow(values, scope);

  let existing: StoredBrand | null = null;
  if (parsed.id) {
    existing = await Brand.findById(parsed.id).lean<StoredBrand | null>();
  }
  // A row without a handle is matched by the one its name would get, so a
  // name-only file cannot create "Nike" twice.
  const lookupSlug =
    parsed.slug ||
    (existing || !parsed.fields.name ? "" : slugifyBrand(parsed.fields.name));
  if (!existing && lookupSlug) {
    // A brand saved before slugs folded accents carries the old form ("r-n"
    // for "Ürün"), so a name-only row looks for that too.
    const slugs = parsed.slug
      ? [lookupSlug]
      : Array.from(
          new Set([lookupSlug, legacySlugify(parsed.fields.name ?? "")].filter(Boolean)),
        );
    existing = await Brand.findOne({ slug: { $in: slugs } }).lean<StoredBrand | null>();
  }

  if (!existing) return createBrand(parsed, scope);

  assertCanChange(existing, scope);

  const earlierRow = importedRows.get(String(existing._id));
  if (earlierRow !== undefined) {
    throw new Error(`Duplicate of row ${earlierRow} in this file.`);
  }

  return updateBrand(existing, parsed, scope);
}

function rowMessage(error: unknown) {
  const { code, name, errors } = (error ?? {}) as {
    code?: number;
    name?: string;
    errors?: Record<string, { message?: string }>;
  };
  // Two imports racing for one handle: the unique index is the last line of defense.
  if (code === 11000) return "Brand URL handle is already in use.";
  if (name === "ValidationError" && errors) {
    const first = Object.values(errors)[0]?.message;
    if (first) return first;
  }
  return error instanceof Error ? error.message : "Import failed.";
}

// ---------------------------------------------------------------------------
// Import: the file
// ---------------------------------------------------------------------------

/**
 * Import a brands CSV. Rows are independent: a bad row is reported with its
 * spreadsheet row number and the rest still import. A file that is not a brands
 * CSV at all (empty, or no header row with a name, slug or id column, or no
 * rows) throws a `ValidationError` instead.
 */
export async function importBrandsCsv(
  csvText: string,
  scope: BrandImportScope,
): Promise<BrandImportResult> {
  const { headers, records } = parseCsv(csvText);
  if (headers.length === 0) {
    throw new ValidationError(
      "The file is empty. Upload a CSV with a header row and one brand per row.",
    );
  }
  const columns = new Set(headers.map((header) => header.toLowerCase().replace(/[^a-z0-9]/g, "")));
  if (!["name", "slug", "id"].some((column) => columns.has(column))) {
    throw new ValidationError(
      'This does not look like a brands file. The first row must be a header row with a "name" column.',
    );
  }
  if (records.length === 0) {
    throw new ValidationError("The file has a header row but no brands under it.");
  }

  const result: BrandImportResult = {
    created: 0,
    updated: 0,
    unchanged: 0,
    failed: 0,
    errors: [],
  };
  if (records.length > MAX_IMPORT_ROWS) {
    return {
      ...result,
      failed: records.length,
      errors: [
        { row: 0, message: `Import supports up to ${MAX_IMPORT_ROWS} rows at a time.` },
      ],
    };
  }

  const importedRows = new Map<string, number>();
  const revalidate = new Set<string>();

  for (const { row: rowNumber, values } of records) {
    try {
      const outcome = await importRow(values, scope, importedRows);
      importedRows.set(outcome.id, rowNumber);
      result[outcome.kind]++;
      for (const slug of outcome.revalidate) revalidate.add(slug);
    } catch (error) {
      result.failed++;
      result.errors.push({ row: rowNumber, message: rowMessage(error) });
    }
  }

  if (revalidate.size > 0) revalidateBrandContent({ slugs: [...revalidate] });
  return result;
}
