import { STATES } from "@/lib/intl/country-options";
import {
  countryCodeForValue,
  countryNameForCode,
} from "@/lib/intl/country-availability";
import { normalizePhoneNumber } from "@/lib/sms/phone";

/**
 * The customer file: which columns it has, what each one means, and what a
 * row of it says once read.
 *
 * Shared by the import dialog, which reads the file in the browser, and by the
 * import route, which reads every row again on its own — so nothing here may
 * reach the database or a server-only module. The route decides; the dialog
 * only uses this to say early what the route will say anyway.
 *
 * Three spellings of the same file are read as they come: the store's own
 * template (and its export), Shopify's customer export, and the billing
 * columns of a WooCommerce customer export. Case, spaces, `_` and `-` never
 * matter, so "First Name", "first_name" and "firstName" are one column.
 */

/** The largest file the dialog reads — Shopify's own limit for this file. */
export const CUSTOMER_IMPORT_MAX_FILE_BYTES = 15 * 1024 * 1024;
export const CUSTOMER_IMPORT_MAX_ROWS = 50_000;
/** Rows per request: small enough to answer well inside a function's time limit. */
export const CUSTOMER_IMPORT_CHUNK_ROWS = 250;
export const CUSTOMER_IMPORT_MAX_COLUMNS = 100;
export const CUSTOMER_IMPORT_MAX_CELL_LENGTH = 5000;

/** The longest name a customer account takes (the User schema's limit). */
const MAX_NAME_LENGTH = 100;
/** The profile's note field, as the admin form and the schema cap it. */
export const MAX_NOTE_LENGTH = 2000;
/** One tag, as the admin form caps it. */
export const MAX_TAG_LENGTH = 50;
/** Tags taken from one row; the run's own tag comes on top. */
export const MAX_ROW_TAGS = 20;

export const CUSTOMER_IMPORT_FIELDS = [
  "firstName",
  "lastName",
  "name",
  "email",
  "phone",
  "acceptsEmailMarketing",
  "acceptsSmsMarketing",
  "address1",
  "address2",
  "city",
  "province",
  "provinceCode",
  "country",
  "countryCode",
  "zip",
  "addressPhone",
  "tags",
  "note",
] as const;

export type CustomerImportField = (typeof CUSTOMER_IMPORT_FIELDS)[number];

/**
 * The template's columns, in the order the sample and the export write them.
 * `name`, `province` and `country` are not here: they only exist to read other
 * platforms' files, which carry a full name or a place name instead of a code.
 */
export const CUSTOMER_TEMPLATE_COLUMNS: ReadonlyArray<{
  field: CustomerImportField;
  header: string;
}> = [
  { field: "firstName", header: "First Name" },
  { field: "lastName", header: "Last Name" },
  { field: "email", header: "Email" },
  { field: "phone", header: "Phone" },
  { field: "acceptsEmailMarketing", header: "Accepts Email Marketing" },
  { field: "acceptsSmsMarketing", header: "Accepts SMS Marketing" },
  { field: "address1", header: "Address 1" },
  { field: "address2", header: "Address 2" },
  { field: "city", header: "City" },
  { field: "provinceCode", header: "Province Code" },
  { field: "countryCode", header: "Country Code" },
  { field: "zip", header: "Zip" },
  { field: "addressPhone", header: "Address Phone" },
  { field: "tags", header: "Tags" },
  { field: "note", header: "Note" },
];

/**
 * Columns the export adds after the template's for whoever reads the file.
 * An import passes over them: the state is the customer's own answer, kept by
 * the consent rules, and the totals are counted from orders placed here.
 */
export const CUSTOMER_EXPORT_ONLY_HEADERS = [
  "Email Marketing Status",
  "Total Orders",
  "Total Spent",
] as const;

export function columnKey(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const FIELD_BY_KEY = new Map<string, CustomerImportField>([
  ...CUSTOMER_IMPORT_FIELDS.map((field): [string, CustomerImportField] => [
    columnKey(field),
    field,
  ]),
  ...CUSTOMER_TEMPLATE_COLUMNS.map(({ field, header }): [string, CustomerImportField] => [
    columnKey(header),
    field,
  ]),
  // Shopify's export: the address columns carry a "Default Address" prefix,
  // and older exports wrote them bare, with "Accepts Marketing" for email.
  ["defaultaddressaddress1", "address1"],
  ["defaultaddressaddress2", "address2"],
  ["defaultaddresscity", "city"],
  ["defaultaddressprovincecode", "provinceCode"],
  ["defaultaddresscountrycode", "countryCode"],
  ["defaultaddresszip", "zip"],
  ["defaultaddressphone", "addressPhone"],
  ["acceptsmarketing", "acceptsEmailMarketing"],
  // WooCommerce's customer export: the billing address is the customer's own.
  ["billingfirstname", "firstName"],
  ["billinglastname", "lastName"],
  ["billingemail", "email"],
  ["billingphone", "phone"],
  ["billingaddress1", "address1"],
  ["billingaddress2", "address2"],
  ["billingcity", "city"],
  ["billingstate", "province"],
  ["billingpostcode", "zip"],
  ["billingcountry", "country"],
  ["useremail", "email"],
  // The names everyone else uses.
  ["fullname", "name"],
  ["customername", "name"],
  ["emailaddress", "email"],
  ["mobile", "phone"],
  ["mobilephone", "phone"],
  ["phonenumber", "phone"],
  ["street", "address1"],
  ["address", "address1"],
  ["addressline1", "address1"],
  ["addressline2", "address2"],
  ["apartment", "address2"],
  ["state", "province"],
  ["region", "province"],
  ["postcode", "zip"],
  ["postalcode", "zip"],
  ["zipcode", "zip"],
  ["notes", "note"],
  ["tag", "tags"],
]);

/**
 * Columns other platforms export that have no place here. Named once, in one
 * warning, so a merchant knows they were seen and left out on purpose.
 */
const NOT_IMPORTED_KEYS = new Set(
  [
    "Customer ID",
    "Company",
    "Default Address Company",
    "billing_company",
    "Accepts WhatsApp Marketing",
    "Total Spent",
    "Total Orders",
    "Tax Exempt",
    ...CUSTOMER_EXPORT_ONLY_HEADERS,
  ].map(columnKey),
);

/** A message the dialog words in the admin's language: a code and its values. */
export interface ImportMessage {
  code: string;
  params?: Record<string, string | number>;
}

export interface CustomerColumnMap {
  /** The field each header column is read into, or null when it is not read. */
  columns: Array<CustomerImportField | null>;
  /** Headers of columns seen and deliberately not imported (Total Spent…). */
  notImported: string[];
  /** Headers nothing here knows. */
  unknown: string[];
}

export function mapCustomerHeaders(headers: readonly string[]): CustomerColumnMap {
  const columns: Array<CustomerImportField | null> = [];
  const notImported: string[] = [];
  const unknown: string[] = [];
  for (const header of headers) {
    const key = columnKey(header);
    const field = key ? FIELD_BY_KEY.get(key) : undefined;
    columns.push(field ?? null);
    if (field || !key) continue;
    if (NOT_IMPORTED_KEYS.has(key)) notImported.push(header.trim());
    else unknown.push(header.trim());
  }
  return { columns, notImported, unknown };
}

/**
 * Whether the file can be imported at all — a customer is found by email or,
 * without one, by phone, so a file with neither column has no key to match a
 * single row by — plus the file-wide warnings.
 */
export function checkCustomerHeaders(headers: readonly string[]):
  | { ok: true; map: CustomerColumnMap; warnings: ImportMessage[] }
  | { ok: false; error: ImportMessage } {
  const map = mapCustomerHeaders(headers);
  if (!map.columns.includes("email") && !map.columns.includes("phone")) {
    return {
      ok: false,
      error: {
        code: "file_no_key_column",
        params: { headers: headers.slice(0, 4).join(", ") },
      },
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
    warnings.push({
      code: "file_columns_unknown",
      params: { columns: map.unknown.join(", ") },
    });
  }
  return { ok: true, map, warnings };
}

export type CustomerCells = Partial<Record<CustomerImportField, string>>;

/**
 * One row's cells by field. Two spellings of one field in a file ("Phone" and
 * "billing_phone"): the first one filled in wins.
 */
export function readCustomerCells(
  map: CustomerColumnMap,
  cells: readonly string[],
): CustomerCells {
  const values: CustomerCells = {};
  map.columns.forEach((field, index) => {
    if (!field) return;
    const value = String(cells[index] ?? "").trim();
    if (value && !values[field]) values[field] = value;
  });
  return values;
}

/** Lower-cased, or null when it is not an address. Shared with the dialog's duplicate check. */
export function normalizeImportEmail(value: string | undefined): string | null {
  const email = String(value ?? "").trim().toLowerCase();
  if (!email || email.length > 254) return null;
  // The User schema's own rule, plus no whitespace or second "@" anywhere.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

const YES = new Set(["yes", "y", "true", "1", "subscribed", "on"]);
const NO = new Set(["no", "n", "false", "0", "unsubscribed", "not_subscribed", "off"]);

/** yes → true, no or blank → false, anything else → null (read as no, with a warning). */
function readYesNo(value: string | undefined): boolean | null {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text || NO.has(text)) return false;
  if (YES.has(text)) return true;
  return null;
}

export interface ImportedAddress {
  firstName?: string;
  lastName?: string;
  street: string;
  apartment?: string;
  city: string;
  state?: string;
  postalCode?: string;
  /** The country's name, as the address forms store it. */
  country: string;
  phone?: string;
}

export interface NormalizedCustomerRow {
  /** Lower-cased; absent on a row keyed by phone. */
  email?: string;
  /** E.164; the customer's own number. */
  phone?: string;
  /** What the account shows: first and last name, or the file's full name. */
  name?: string;
  firstName?: string;
  lastName?: string;
  /** null: the column is not in the file, or its cell is blank. */
  acceptsEmailMarketing: boolean | null;
  acceptsSmsMarketing: boolean | null;
  address?: ImportedAddress;
  tags: string[];
  note?: string;
}

export interface CustomerRowContext {
  /** Whether the file has the consent columns at all — absent ones change nothing. */
  hasEmailConsentColumn: boolean;
  hasSmsConsentColumn: boolean;
  /** The store's country, for a number written the national way. */
  defaultCountry?: string;
  /** The store's country rule (Settings → General). */
  isCountryAllowed: (countryCode: string) => boolean;
  /** Whether a delivery address here must have a postcode. */
  postcodeRequired: boolean;
}

export type CustomerRowReading =
  | { ok: true; value: NormalizedCustomerRow; warnings: ImportMessage[] }
  | { ok: false; error: ImportMessage };

function clip(value: string | undefined, max: number): string | undefined {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : undefined;
}

/**
 * A province by code, as the address forms store it: the region's name when
 * the country has a list ("CA" in the US is "California"), the cell as given
 * otherwise.
 */
function readProvince(countryCode: string | undefined, cells: CustomerCells) {
  const code = cells.provinceCode?.trim();
  if (code && countryCode) {
    const region = (STATES[countryCode] ?? []).find(
      (option) => option.value.toUpperCase() === code.toUpperCase(),
    );
    if (region) return region.label;
  }
  return clip(code || cells.province, 100);
}

function readTags(value: string | undefined, warnings: ImportMessage[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  let tooLong = 0;
  for (const raw of String(value ?? "").split(",")) {
    const tag = raw.trim();
    if (!tag) continue;
    if (tag.length > MAX_TAG_LENGTH) {
      tooLong++;
      continue;
    }
    // Shopify's tags are not case sensitive; "VIP" and "vip" are one tag.
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  if (tooLong > 0) {
    warnings.push({ code: "tags_too_long", params: { count: tooLong, max: MAX_TAG_LENGTH } });
  }
  if (tags.length > MAX_ROW_TAGS) {
    warnings.push({ code: "tags_too_many", params: { max: MAX_ROW_TAGS } });
    return tags.slice(0, MAX_ROW_TAGS);
  }
  return tags;
}

/**
 * The address a row describes, or nothing with the reason it was left out.
 * The customer is imported either way: a bad address loses the address only.
 */
function readAddress(
  cells: CustomerCells,
  context: CustomerRowContext,
  names: { firstName?: string; lastName?: string },
  warnings: ImportMessage[],
): ImportedAddress | undefined {
  const street = clip(cells.address1, 200);
  const apartment = clip(cells.address2, 200);
  const city = clip(cells.city, 100);
  const postalCode = clip(cells.zip, 20);
  const countryValue = cells.countryCode || cells.country;
  // A country on its own is not an address: exports fill it in for customers
  // who never gave one (WooCommerce puts the store's own country there).
  if (!street && !apartment && !city && !postalCode) return undefined;

  const countryCode = countryCodeForValue(countryValue);
  if (!countryValue || !countryCode) {
    warnings.push({
      code: countryValue ? "address_country_unknown" : "address_incomplete",
      params: countryValue ? { country: countryValue } : {},
    });
    return undefined;
  }
  if (!context.isCountryAllowed(countryCode)) {
    warnings.push({
      code: "address_country_not_allowed",
      params: { country: countryNameForCode(countryCode) ?? countryCode },
    });
    return undefined;
  }
  if (!street || !city || (context.postcodeRequired && !postalCode)) {
    warnings.push({ code: "address_incomplete" });
    return undefined;
  }

  let phone: string | undefined;
  if (cells.addressPhone) {
    phone = normalizePhoneNumber(cells.addressPhone, {
      country: countryCode,
      defaultCountry: context.defaultCountry,
    });
    if (!phone) {
      warnings.push({ code: "address_phone_invalid", params: { phone: cells.addressPhone } });
    }
  }

  const state = readProvince(countryCode, cells);
  return {
    ...(names.firstName ? { firstName: names.firstName } : {}),
    ...(names.lastName ? { lastName: names.lastName } : {}),
    street,
    ...(apartment ? { apartment } : {}),
    city,
    ...(state ? { state } : {}),
    ...(postalCode ? { postalCode } : {}),
    country: countryNameForCode(countryCode) ?? countryCode,
    ...(phone ? { phone } : {}),
  };
}

/**
 * Read one row the way the import writes it. A row the import cannot key —
 * no usable email, and no usable phone either — is refused; anything else
 * wrong (a bad number, an address in a country the store does not sell to)
 * loses that one value and says so.
 */
export function normalizeCustomerRow(
  cells: CustomerCells,
  context: CustomerRowContext,
): CustomerRowReading {
  const warnings: ImportMessage[] = [];

  const email = normalizeImportEmail(cells.email);
  if (cells.email && !email) {
    return { ok: false, error: { code: "email_invalid", params: { email: cells.email } } };
  }

  const countryForPhone = countryCodeForValue(cells.countryCode || cells.country);
  let phone: string | undefined;
  if (cells.phone) {
    phone = normalizePhoneNumber(cells.phone, {
      country: countryForPhone,
      defaultCountry: context.defaultCountry,
    });
    if (!phone) {
      if (!email) {
        return { ok: false, error: { code: "phone_invalid_no_email", params: { phone: cells.phone } } };
      }
      warnings.push({ code: "phone_invalid", params: { phone: cells.phone } });
    }
  }
  if (!email && !phone) return { ok: false, error: { code: "no_email_or_phone" } };

  let firstName = clip(cells.firstName, MAX_NAME_LENGTH);
  let lastName = clip(cells.lastName, MAX_NAME_LENGTH);
  if (!firstName && !lastName && cells.name) {
    const [first, ...rest] = cells.name.trim().split(/\s+/);
    firstName = clip(first, MAX_NAME_LENGTH);
    lastName = clip(rest.join(" "), MAX_NAME_LENGTH);
  }
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  if (fullName.length > MAX_NAME_LENGTH) {
    warnings.push({ code: "name_too_long", params: { max: MAX_NAME_LENGTH } });
  }
  const name = clip(fullName, MAX_NAME_LENGTH);

  const acceptsEmail = readYesNo(cells.acceptsEmailMarketing);
  if (acceptsEmail === null) {
    warnings.push({ code: "consent_value_unclear", params: { value: cells.acceptsEmailMarketing ?? "" } });
  }
  const acceptsSms = readYesNo(cells.acceptsSmsMarketing);
  if (acceptsSms === null) {
    warnings.push({ code: "consent_value_unclear", params: { value: cells.acceptsSmsMarketing ?? "" } });
  }
  if (acceptsSms === true && !phone) warnings.push({ code: "sms_consent_no_phone" });

  const note = cells.note?.trim();
  if (note && note.length > MAX_NOTE_LENGTH) {
    warnings.push({ code: "note_too_long", params: { max: MAX_NOTE_LENGTH } });
  }

  const address = readAddress(cells, context, { firstName, lastName }, warnings);
  const tags = readTags(cells.tags, warnings);

  return {
    ok: true,
    value: {
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      ...(name ? { name } : {}),
      ...(firstName ? { firstName } : {}),
      ...(lastName ? { lastName } : {}),
      acceptsEmailMarketing: context.hasEmailConsentColumn ? acceptsEmail === true : null,
      acceptsSmsMarketing:
        context.hasSmsConsentColumn ? acceptsSms === true && Boolean(phone) : null,
      ...(address ? { address } : {}),
      tags,
      ...(note ? { note: note.slice(0, MAX_NOTE_LENGTH) } : {}),
    },
    warnings,
  };
}

/**
 * What identifies a row's customer within one file, for the "last row wins"
 * rule: the email, or for a row without one, the number. Rows that cannot be
 * keyed are left to the route to refuse.
 */
export function customerRowKey(
  cells: CustomerCells,
  defaultCountry?: string,
): string | null {
  const email = normalizeImportEmail(cells.email);
  if (email) return `email:${email}`;
  if (cells.email) return null;
  const phone = normalizePhoneNumber(cells.phone ?? "", {
    country: countryCodeForValue(cells.countryCode || cells.country),
    defaultCountry,
  });
  return phone ? `phone:${phone}` : null;
}

/** `import-2026-10-04`: the tag a run gives every customer it creates or updates. */
export function defaultImportTag(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `import-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** A run tag: one tag, as the admin form takes them, and nothing a list would split. */
export function normalizeImportTag(value: unknown): string | null {
  const tag = String(value ?? "").trim();
  if (!tag || tag.length > MAX_TAG_LENGTH || tag.includes(",")) return null;
  return tag;
}

/**
 * The sample file: the template's header row and three made-up customers —
 * one with everything, one who agreed to texts only, and one known by phone
 * alone. Built in the browser; there is nothing of the store's in it.
 */
export function customerImportSampleRows(): string[][] {
  const header = CUSTOMER_TEMPLATE_COLUMNS.map((column) => column.header);
  const rows: Array<Partial<Record<CustomerImportField, string>>> = [
    {
      firstName: "Jane",
      lastName: "Cooper",
      email: "jane.cooper@example.com",
      phone: "+14155550134",
      acceptsEmailMarketing: "yes",
      acceptsSmsMarketing: "no",
      address1: "742 Market Street",
      address2: "Apt 5",
      city: "San Francisco",
      provinceCode: "CA",
      countryCode: "US",
      zip: "94103",
      tags: "VIP, Newsletter",
      note: "Prefers weekend delivery",
    },
    {
      firstName: "Omar",
      lastName: "Haddad",
      email: "omar.haddad@example.com",
      phone: "+447911123456",
      acceptsEmailMarketing: "no",
      acceptsSmsMarketing: "yes",
      address1: "10 Downing Lane",
      city: "London",
      countryCode: "GB",
      zip: "SW1A 2AA",
      tags: "Wholesale",
    },
    {
      firstName: "Lina",
      lastName: "Park",
      phone: "+14155550199",
      acceptsSmsMarketing: "yes",
    },
  ];
  return [
    header,
    ...rows.map((row) => CUSTOMER_TEMPLATE_COLUMNS.map((column) => row[column.field] ?? "")),
  ];
}
