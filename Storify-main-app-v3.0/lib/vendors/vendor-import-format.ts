import { appConfig } from "@/config/app.config";
import {
  countryCodeForValue,
  countryNameForCode,
} from "@/lib/intl/country-availability";
import { slugify } from "@/lib/strings";

/**
 * The vendor file: its columns, what each one means, and what a row of it
 * says once read.
 *
 * Shared by the import dialog, which reads the file in the browser, and by the
 * import route, which reads every row again on its own — so nothing here may
 * reach the database or a server-only module. Messages are codes the dialog
 * words in the admin's language.
 *
 * Bank details, payout settings and KYC documents are never read from a file:
 * a vendor adds them after signing in, and a spreadsheet of account numbers is
 * not something the store should ask anyone to pass around.
 */

/** Vendors are counted in hundreds, not tens of thousands. */
export const VENDOR_IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const VENDOR_IMPORT_MAX_ROWS = 5000;
/**
 * Rows per request. Each row may download a logo and a banner into the
 * store's media storage, so a request carries few of them.
 */
export const VENDOR_IMPORT_CHUNK_ROWS = 10;

export const VENDOR_IMPORT_FIELDS = [
  "storeName",
  "ownerEmail",
  "ownerName",
  "ownerPhone",
  "slug",
  "description",
  "logoUrl",
  "bannerUrl",
  "storePhone",
  "street",
  "city",
  "state",
  "postalCode",
  "country",
  "plan",
  "commission",
  "verified",
  "notes",
] as const;

export type VendorImportField = (typeof VENDOR_IMPORT_FIELDS)[number];

/** The template's columns, in the order the sample and the export write them. */
export const VENDOR_TEMPLATE_COLUMNS: ReadonlyArray<{
  field: VendorImportField;
  header: string;
  required?: boolean;
}> = [
  { field: "storeName", header: "Store name", required: true },
  { field: "ownerEmail", header: "Owner email", required: true },
  { field: "ownerName", header: "Owner name", required: true },
  { field: "ownerPhone", header: "Owner phone" },
  { field: "slug", header: "Store slug" },
  { field: "description", header: "Description" },
  { field: "logoUrl", header: "Logo URL" },
  { field: "bannerUrl", header: "Banner URL" },
  { field: "storePhone", header: "Store phone" },
  { field: "street", header: "Street" },
  { field: "city", header: "City" },
  { field: "state", header: "State" },
  { field: "postalCode", header: "Postal code" },
  { field: "country", header: "Country" },
  { field: "plan", header: "Plan" },
  { field: "commission", header: "Commission %" },
  { field: "verified", header: "Verified" },
  { field: "notes", header: "Admin notes" },
];

/** What the export adds after the template, for whoever reads the file; the import passes over them. */
export const VENDOR_EXPORT_ONLY_HEADERS = ["Status", "Sales", "Joined"] as const;

/** The model's limits (Vendor and User schemas), refused rather than cut. */
export const VENDOR_IMPORT_LIMITS = {
  storeName: 100,
  ownerName: 100,
  description: 1000,
  notes: 5000,
  phone: 50,
  addressPart: 200,
  url: 2048,
} as const;

export function columnKey(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Header spelling → field. The template's own headers, the export's first
 * format ("Store", "Owner", "Commission (%)"), and the names marketplace
 * plugins commonly export under.
 */
const FIELD_BY_KEY = new Map<string, VendorImportField>([
  ...VENDOR_TEMPLATE_COLUMNS.map(
    (column): [string, VendorImportField] => [columnKey(column.header), column.field],
  ),
  ...VENDOR_IMPORT_FIELDS.map((field): [string, VendorImportField] => [columnKey(field), field]),
  ["store", "storeName"],
  ["shop", "storeName"],
  ["shopname", "storeName"],
  ["email", "ownerEmail"],
  ["vendoremail", "ownerEmail"],
  ["selleremail", "ownerEmail"],
  ["owner", "ownerName"],
  ["name", "ownerName"],
  ["fullname", "ownerName"],
  ["phone", "ownerPhone"],
  ["mobile", "ownerPhone"],
  ["handle", "slug"],
  ["shopslug", "slug"],
  ["storedescription", "description"],
  ["about", "description"],
  ["logo", "logoUrl"],
  ["storelogo", "logoUrl"],
  ["banner", "bannerUrl"],
  ["storebanner", "bannerUrl"],
  ["coverimage", "bannerUrl"],
  ["shopphone", "storePhone"],
  ["address", "street"],
  ["address1", "street"],
  ["streetaddress", "street"],
  ["addressline1", "street"],
  ["town", "city"],
  ["province", "state"],
  ["region", "state"],
  ["postcode", "postalCode"],
  ["zip", "postalCode"],
  ["zipcode", "postalCode"],
  ["countrycode", "country"],
  ["planname", "plan"],
  ["planslug", "plan"],
  ["commissionrate", "commission"],
  ["isverified", "verified"],
  ["notes", "notes"],
  ["internalnotes", "notes"],
]);

/** Columns seen and deliberately left out: the export's extras, and money or identity papers. */
const NOT_IMPORTED_KEYS = new Set(
  [
    ...VENDOR_EXPORT_ONLY_HEADERS,
    "Vendor status",
    "Account",
    "Bank name",
    "Bank account",
    "Account name",
    "Account number",
    "Routing number",
    "SWIFT",
    "SWIFT code",
    "IBAN",
    "Payout schedule",
    "Payout method",
    "Minimum payout",
    "Tax ID",
    "Business license",
    "Tax certificate",
    "Government ID",
    "Documents",
  ].map(columnKey),
);

/** A message the dialog words in the admin's language: a code and its values. */
export interface ImportMessage {
  code: string;
  params?: Record<string, string | number>;
}

export interface VendorColumnMap {
  /** The field each header column is read into, or null when it is not read. */
  columns: Array<VendorImportField | null>;
  /** Headers of columns seen and deliberately not imported (Bank account, Sales…). */
  notImported: string[];
  /** Headers nothing here knows. */
  unknown: string[];
}

export function mapVendorHeaders(headers: readonly string[]): VendorColumnMap {
  const columns: Array<VendorImportField | null> = [];
  const notImported: string[] = [];
  const unknown: string[] = [];
  for (const header of headers) {
    const key = columnKey(header);
    const field = key ? FIELD_BY_KEY.get(key) : undefined;
    // Two columns for one field: the first one wins, the second is reported.
    const repeated = field ? columns.includes(field) : false;
    columns.push(field && !repeated ? field : null);
    if ((field && !repeated) || !key) continue;
    if (NOT_IMPORTED_KEYS.has(key)) notImported.push(header.trim());
    else unknown.push(header.trim());
  }
  return { columns, notImported, unknown };
}

/**
 * Whether the file can be imported at all — every row needs a store name, an
 * owner email and an owner name — plus the file-wide warnings.
 */
export function checkVendorHeaders(headers: readonly string[]):
  | { ok: true; map: VendorColumnMap; warnings: ImportMessage[] }
  | { ok: false; error: ImportMessage } {
  const map = mapVendorHeaders(headers);
  const missing = VENDOR_TEMPLATE_COLUMNS.filter(
    (column) => column.required && !map.columns.includes(column.field),
  ).map((column) => column.header);
  if (missing.length > 0) {
    return {
      ok: false,
      error: { code: "file_missing_columns", params: { columns: missing.join(", ") } },
    };
  }
  const warnings: ImportMessage[] = [];
  if (map.notImported.length > 0) {
    warnings.push({
      code: "file_columns_not_imported",
      params: { columns: map.notImported.join(", ") },
    });
  }
  if (map.unknown.length > 0) {
    warnings.push({ code: "file_columns_unknown", params: { columns: map.unknown.join(", ") } });
  }
  return { ok: true, map, warnings };
}

export type VendorCells = Partial<Record<VendorImportField, string>>;

export function readVendorCells(map: VendorColumnMap, cells: readonly string[]): VendorCells {
  const values: VendorCells = {};
  map.columns.forEach((field, index) => {
    if (!field) return;
    const value = String(cells[index] ?? "").trim();
    if (value) values[field] = value;
  });
  return values;
}

/** Lower-cased, or null when it is not an address. Shared with the dialog's duplicate check. */
export function normalizeVendorEmail(value: string | undefined): string | null {
  const email = String(value ?? "").trim().toLowerCase();
  if (!email || email.length > 254) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/** The slug a row asks for, as the store would write it. */
export function normalizeVendorSlug(value: string | undefined): string {
  return slugify(String(value ?? ""));
}

const YES = new Set(["yes", "y", "true", "1", "verified"]);
const NO = new Set(["no", "n", "false", "0", "unverified"]);

export interface ImportedVendorAddress {
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  /** The country's name, as the address forms store it. */
  country?: string;
  phone?: string;
}

export interface NormalizedVendorRow {
  storeName: string;
  /** Lower-cased. */
  ownerEmail: string;
  ownerName: string;
  ownerPhone?: string;
  /** Already a slug; absent when the row names none. */
  slug?: string;
  description?: string;
  logoUrl?: string;
  bannerUrl?: string;
  /** Only the parts the row fills in; absent when it fills in none. */
  address?: ImportedVendorAddress;
  /** A plan's name or slug, as written. */
  plan?: string;
  commission?: number;
  verified?: boolean;
  notes?: string;
}

export interface VendorRowContext {
  /** The store's country rule (Settings → General), for a name or a code. */
  isCountryAllowed: (country: string) => boolean;
}

export type VendorRowReading =
  | { ok: true; value: NormalizedVendorRow; warnings: ImportMessage[] }
  | { ok: false; error: ImportMessage };

const FIELD_HEADERS = Object.fromEntries(
  VENDOR_TEMPLATE_COLUMNS.map((column) => [column.field, column.header]),
) as Record<VendorImportField, string>;

class RowError extends Error {
  constructor(readonly error: ImportMessage) {
    super(error.code);
  }
}

function limited(cells: VendorCells, field: VendorImportField, max: number): string | undefined {
  const value = cells[field]?.trim();
  if (!value) return undefined;
  if (value.length > max) {
    throw new RowError({ code: "row_too_long", params: { column: FIELD_HEADERS[field], max } });
  }
  return value;
}

/**
 * A web link, checked for shape only. The route downloads it later and
 * refuses plain http there — unless the link is the store's own storage (an
 * exported file), which it keeps as it is.
 */
function imageUrl(cells: VendorCells, field: "logoUrl" | "bannerUrl"): string | undefined {
  const value = limited(cells, field, VENDOR_IMPORT_LIMITS.url);
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RowError({ code: "row_image_invalid", params: { column: FIELD_HEADERS[field] } });
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new RowError({ code: "row_image_not_https", params: { column: FIELD_HEADERS[field] } });
  }
  return url.toString();
}

function commission(cells: VendorCells): number | undefined {
  const raw = cells.commission?.trim();
  if (!raw) return undefined;
  // "12", "12%", "12.5" and a spreadsheet's "12,5" all mean twelve and a bit.
  const text = raw.replace(/%$/, "").trim();
  const value = Number(text.includes(".") ? text : text.replace(",", "."));
  if (!/^\d+([.,]\d+)?$/.test(text) || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new RowError({ code: "row_commission_invalid", params: { value: raw } });
  }
  return Math.round(value * 100) / 100;
}

function verified(cells: VendorCells): boolean | undefined {
  const raw = cells.verified?.trim();
  if (!raw) return undefined;
  const text = raw.toLowerCase();
  if (YES.has(text)) return true;
  if (NO.has(text)) return false;
  throw new RowError({ code: "row_verified_invalid", params: { value: raw } });
}

function address(
  cells: VendorCells,
  context: VendorRowContext,
  warnings: ImportMessage[],
): ImportedVendorAddress | undefined {
  const parts: ImportedVendorAddress = {
    street: limited(cells, "street", VENDOR_IMPORT_LIMITS.addressPart),
    city: limited(cells, "city", VENDOR_IMPORT_LIMITS.addressPart),
    state: limited(cells, "state", VENDOR_IMPORT_LIMITS.addressPart),
    postalCode: limited(cells, "postalCode", VENDOR_IMPORT_LIMITS.addressPart),
    phone: limited(cells, "storePhone", VENDOR_IMPORT_LIMITS.phone),
  };
  const country = limited(cells, "country", VENDOR_IMPORT_LIMITS.addressPart);
  if (country) {
    if (context.isCountryAllowed(country)) {
      // A code becomes the name the address forms store; an unknown name the
      // store's "all countries" rule lets through stays as written.
      parts.country = countryNameForCode(countryCodeForValue(country)) ?? country;
    } else {
      warnings.push({ code: "row_country_not_available", params: { country } });
    }
  }
  const filled = Object.fromEntries(
    Object.entries(parts).filter(([, value]) => value !== undefined),
  ) as ImportedVendorAddress;
  return Object.keys(filled).length > 0 ? filled : undefined;
}

export function readVendorRow(cells: VendorCells, context: VendorRowContext): VendorRowReading {
  const warnings: ImportMessage[] = [];
  try {
    const storeName = limited(cells, "storeName", VENDOR_IMPORT_LIMITS.storeName);
    if (!storeName) throw new RowError({ code: "row_missing", params: { column: FIELD_HEADERS.storeName } });
    const rawEmail = cells.ownerEmail?.trim();
    if (!rawEmail) throw new RowError({ code: "row_missing", params: { column: FIELD_HEADERS.ownerEmail } });
    const ownerEmail = normalizeVendorEmail(rawEmail);
    if (!ownerEmail) throw new RowError({ code: "row_email_invalid", params: { value: rawEmail } });
    const ownerName = limited(cells, "ownerName", VENDOR_IMPORT_LIMITS.ownerName);
    if (!ownerName) throw new RowError({ code: "row_missing", params: { column: FIELD_HEADERS.ownerName } });

    let slug: string | undefined;
    if (cells.slug?.trim()) {
      slug = normalizeVendorSlug(cells.slug);
      if (!slug) throw new RowError({ code: "row_slug_invalid", params: { value: cells.slug.trim() } });
      if (slug === appConfig.defaultVendorSlug) {
        throw new RowError({ code: "row_slug_reserved", params: { value: slug } });
      }
    }

    const value: NormalizedVendorRow = {
      storeName,
      ownerEmail,
      ownerName,
      ownerPhone: limited(cells, "ownerPhone", VENDOR_IMPORT_LIMITS.phone),
      slug,
      description: limited(cells, "description", VENDOR_IMPORT_LIMITS.description),
      logoUrl: imageUrl(cells, "logoUrl"),
      bannerUrl: imageUrl(cells, "bannerUrl"),
      address: address(cells, context, warnings),
      plan: limited(cells, "plan", VENDOR_IMPORT_LIMITS.addressPart),
      commission: commission(cells),
      verified: verified(cells),
      notes: limited(cells, "notes", VENDOR_IMPORT_LIMITS.notes),
    };
    for (const key of Object.keys(value) as Array<keyof NormalizedVendorRow>) {
      if (value[key] === undefined) delete value[key];
    }
    return { ok: true, value, warnings };
  } catch (error) {
    if (error instanceof RowError) return { ok: false, error: error.error };
    throw error;
  }
}

/** The sample file's rows: one approved-looking store with everything, one with the minimum. */
export const VENDOR_SAMPLE_ROWS: ReadonlyArray<Partial<Record<VendorImportField, string>>> = [
  {
    storeName: "Green Leaf Organics",
    ownerEmail: "rahima@example.com",
    ownerName: "Rahima Akter",
    ownerPhone: "+8801711000000",
    slug: "green-leaf-organics",
    description: "Organic tea, honey and spices from Sylhet.",
    logoUrl: "https://example.com/images/green-leaf-logo.png",
    bannerUrl: "https://example.com/images/green-leaf-banner.jpg",
    storePhone: "+8801711000001",
    street: "12 Zindabazar Road",
    city: "Sylhet",
    state: "Sylhet Division",
    postalCode: "3100",
    country: "Bangladesh",
    plan: "",
    commission: "",
    verified: "no",
    notes: "Moved from the old marketplace",
  },
  {
    storeName: "Urban Threads",
    ownerEmail: "owner@urbanthreads.example",
    ownerName: "Tanvir Hasan",
  },
];
